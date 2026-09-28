import * as MediaLibrary from "expo-media-library/legacy";
import { File } from "expo-file-system";
import TdLib from "react-native-tdlib";
import {
  JunkCategory,
  JunkFindingWithMedia,
  NewJunkFindingInput,
  SweepCandidateRow,
  clearLocalUri,
  getMeta,
  pageSweepCandidates,
  setMeta,
  setPendingFindingsForMedia,
  upsertFindings,
  updateRemoteMessageIdById,
} from "../db/queries";
import { hasRemoteCopy } from "./restorer";
import {
  decodeThumbToGray,
  hamming64,
  meanLuminanceAndNoise,
  pHash64,
  varianceOfLaplacian,
} from "./imageAnalysis";
import { useSettingsStore } from "../store/settingsStore";

// F2 Junk Sweeper engine (docs/PLAN-FEATURES-v0.11-plus.md §F2). Analyzes the
// existing 320px thumbnails on-device and writes junk_findings; the review
// screen decides what actually happens to any file.

// --- Tunable detection thresholds (documented; tune on real libraries) -------
// Blur: variance of Laplacian below this = likely blurry. Sharp 320px thumbs
// usually score 100+; mild motion blur lands 5–30. Conservative on purpose.
export const BLUR_VARIANCE_THRESHOLD = 40;
// Pocket: mean luminance below this (near-black "lens covered" frame)…
export const POCKET_LUMINANCE_MAX = 28;
// …AND mean absolute Laplacian (high-frequency energy) above this — a dark
// but real night scene has structure; a lens-under-fabric frame is noisy mush.
export const POCKET_NOISE_MIN = 2.5;
// Near-duplicate: pHash Hamming distance at or below this within the same day.
export const DUP_HAMMING_MAX = 8;
// Stale screenshot: tagged 'screenshot' by the scanner and older than this.
export const STALE_SCREENSHOT_DAYS = 90;

// Chunking: thumbnails processed per resumable run chunk (13k-item libraries
// take a while; the cursor in meta survives app kills between chunks).
export const SWEEP_CHUNK = 500;

const RESUME_KEY = "junk_last_media_id";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SweepProgress {
  scanned: number;
  findings: number;
  done: boolean;
}

export interface CategorySummary {
  count: number;
  bytes: number;
}

export interface SweepSummary {
  scanned: number;
  findings: number;
  findingsByCategory: Record<JunkCategory, CategorySummary>;
  done: boolean;
}

function emptySummary(): SweepSummary {
  return {
    scanned: 0,
    findings: 0,
    done: false,
    findingsByCategory: {
      blurry: { count: 0, bytes: 0 },
      pocket: { count: 0, bytes: 0 },
      near_duplicate: { count: 0, bytes: 0 },
      stale_screenshot: { count: 0, bytes: 0 },
    },
  };
}

function isImage(row: SweepCandidateRow): boolean {
  return row.mime_type.startsWith("image/");
}

function isStaleScreenshot(row: SweepCandidateRow): boolean {
  return (
    row.tags.split(" ").includes("screenshot") &&
    Date.now() - row.taken_at > STALE_SCREENSHOT_DAYS * DAY_MS
  );
}

interface HashEntry {
  mediaId: number;
  byteSize: number;
  hash: bigint;
}

// Same-day near-dup clustering (union-find over pairwise Hamming distances).
function nearDuplicateFindings(
  dayBuckets: Map<number, HashEntry[]>,
  byCategory: Record<JunkCategory, CategorySummary>
): NewJunkFindingInput[] {
  const findings: NewJunkFindingInput[] = [];
  for (const entries of dayBuckets.values()) {
    if (entries.length < 2) continue;
    const parent = entries.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (hamming64(entries[i].hash, entries[j].hash) <= DUP_HAMMING_MAX) union(i, j);
      }
    }
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const root = find(i);
      const list = clusters.get(root) ?? [];
      list.push(i);
      clusters.set(root, list);
    }
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      // Keep the largest file as the leader; the rest reference it.
      let leader = members[0];
      for (const m of members) {
        if (entries[m].byteSize > entries[leader].byteSize) leader = m;
      }
      const leaderId = entries[leader].mediaId;
      const groupKey = `dup:${leaderId}`;
      for (const m of members) {
        if (m === leader) continue;
        const entry = entries[m];
        findings.push({
          media_id: entry.mediaId,
          category: "near_duplicate",
          score: null,
          detail: `leader:${leaderId}`,
          group_key: groupKey,
        });
        byCategory.near_duplicate.count++;
        byCategory.near_duplicate.bytes += entry.byteSize;
      }
    }
  }
  return findings;
}

let sweepRunning = false;

// Chunked, resumable sweep. Returns null when the feature is disabled or a
// sweep is already running. Cancel via cancelRef (checked between items).
export async function runSweep(
  onProgress?: (progress: SweepProgress) => void,
  cancelRef?: { cancelled: boolean }
): Promise<SweepSummary | null> {
  if (!useSettingsStore.getState().junkSweeperEnabled || sweepRunning) return null;
  sweepRunning = true;
  const summary = emptySummary();
  const dayBuckets = new Map<number, HashEntry[]>();
  try {
    let lastId = Number((await getMeta(RESUME_KEY)) ?? 0);
    if (!Number.isFinite(lastId) || lastId < 0) lastId = 0;

    for (;;) {
      const candidates = await pageSweepCandidates(lastId, SWEEP_CHUNK);
      if (candidates.length === 0) {
        // A completed pass starts from the top on the next sweep.
        await setMeta(RESUME_KEY, "0");
        summary.done = true;
        break;
      }
      const pending: NewJunkFindingInput[] = [];

      for (const row of candidates) {
        if (cancelRef?.cancelled) break;
        lastId = row.id;
        summary.scanned++;

        if (isStaleScreenshot(row)) {
          pending.push({
            media_id: row.id,
            category: "stale_screenshot",
            score: Math.floor((Date.now() - row.taken_at) / DAY_MS),
            detail: `${STALE_SCREENSHOT_DAYS}+ day old screenshot`,
            group_key: null,
          });
          summary.findingsByCategory.stale_screenshot.count++;
          summary.findingsByCategory.stale_screenshot.bytes += row.byte_size;
        }

        // v0.12 scope: blur / pocket / near-dup run on photos only (videos
        // are only checked for staleness tags above).
        if (isImage(row)) {
          try {
            const img = await decodeThumbToGray(row.thumb_uri);
            const variance = varianceOfLaplacian(img);
            if (variance < BLUR_VARIANCE_THRESHOLD) {
              pending.push({
                media_id: row.id,
                category: "blurry",
                score: variance,
                detail: `variance ${variance.toFixed(1)} < ${BLUR_VARIANCE_THRESHOLD}`,
                group_key: null,
              });
              summary.findingsByCategory.blurry.count++;
              summary.findingsByCategory.blurry.bytes += row.byte_size;
            }
            const { mean, noise } = meanLuminanceAndNoise(img);
            if (mean < POCKET_LUMINANCE_MAX && noise > POCKET_NOISE_MIN) {
              pending.push({
                media_id: row.id,
                category: "pocket",
                score: mean,
                detail: `luminance ${mean.toFixed(1)}, noise ${noise.toFixed(2)}`,
                group_key: null,
              });
              summary.findingsByCategory.pocket.count++;
              summary.findingsByCategory.pocket.bytes += row.byte_size;
            }
            const hash = pHash64(img);
            const day = Math.floor(row.taken_at / DAY_MS);
            const bucket = dayBuckets.get(day) ?? [];
            bucket.push({ mediaId: row.id, byteSize: row.byte_size, hash });
            dayBuckets.set(day, bucket);
          } catch {
            // Undecodable thumbnail: skip this pass, revisit on the next sweep.
          }
        }
        onProgress?.({
          scanned: summary.scanned,
          findings: totalFindings(summary),
          done: false,
        });
      }

      if (pending.length > 0) await upsertFindings(pending);
      await setMeta(RESUME_KEY, String(lastId));

      onProgress?.({ scanned: summary.scanned, findings: totalFindings(summary), done: false });
      if (cancelRef?.cancelled) break;
    }

    // Near-dup clustering runs ONCE over every hash accumulated this run (all
    // chunks), so bursts spanning chunk boundaries still group and nothing is
    // counted twice. Cancelled runs cluster what they collected so far.
    const dupFindings = nearDuplicateFindings(dayBuckets, summary.findingsByCategory);
    if (dupFindings.length > 0) await upsertFindings(dupFindings);
    return summary;
  } finally {
    sweepRunning = false;
  }
}

function totalFindings(summary: SweepSummary): number {
  return (
    summary.findingsByCategory.blurry.count +
    summary.findingsByCategory.pocket.count +
    summary.findingsByCategory.near_duplicate.count +
    summary.findingsByCategory.stale_screenshot.count
  );
}

// --- Deletion (three scopes) -------------------------------------------------

export type JunkScope = "local" | "telegram" | "both";

export interface JunkDeleteOutcome {
  deleted: number;
  failed: number;
  freedBytes: number;
}

// Non-negotiable gates, per OWNER ADDITION:
// - every scope requires state === 'synced' AND hasRemoteCopy(row);
// - 'local'/'both' additionally require a local file to exist;
// - 'telegram'/'both' additionally require a valid remote_message_id (covered
//   by hasRemoteCopy) — hasRemoteCopy already rejects "0"/null.
export function isDeletable(
  row: Pick<JunkFindingWithMedia, "state" | "local_uri" | "remote_message_id">,
  scope: JunkScope
): boolean {
  if (row.state !== "synced" || !hasRemoteCopy(row)) return false;
  if (scope !== "telegram" && !row.local_uri) return false;
  return true;
}

// Deletes a batch of findings under one scope. Local deletes follow the VERIFIED
// space.ts pattern (system batch delete for media-library assets → file delete →
// verify gone → clear local_uri); Telegram deletes use the proven
// TdLib.deleteMessages call and clear remote_message_id so restore never points
// at a message that no longer exists. Findings flip to 'deleted' on success.
export async function deleteJunkFindings(
  items: JunkFindingWithMedia[],
  scope: JunkScope,
  onProgress?: (deleted: number) => void
): Promise<JunkDeleteOutcome> {
  const outcome: JunkDeleteOutcome = { deleted: 0, failed: 0, freedBytes: 0 };
  const deletable = items.filter((item) => isDeletable(item, scope));

  // One system confirm-dialog round for every locally-owned asset, like
  // Free-Up-Space. A denied dialog just means the file delete below fails its
  // verification and the item is reported as failed — nothing else changes.
  if (scope !== "telegram") {
    const libraryIds = deletable
      .map((item) => item.media_library_id)
      .filter((id): id is string => !!id);
    if (libraryIds.length > 0) {
      try {
        await MediaLibrary.deleteAssetsAsync(libraryIds);
      } catch {}
    }
  }

  for (const item of deletable) {
    let ok = true;
    let freedThis = 0;
    if (scope !== "local") {
      // Telegram side (scope 'telegram' or 'both').
      try {
        await TdLib.deleteMessages(
          Number(item.remote_chat_id),
          [Number(item.remote_message_id)],
          false
        );
        // The remote message is gone; restore must no longer point at it.
        await updateRemoteMessageIdById(item.media_id, "0");
      } catch {
        ok = false;
      }
    }
    if (ok && scope !== "telegram") {
      // Local side (scope 'local' or 'both') — verified delete.
      try {
        let file = new File(item.local_uri as string);
        if (file.exists) {
          try {
            file.delete();
          } catch {}
          file = new File(item.local_uri as string);
        }
        if (file.exists) {
          ok = false; // scoped-storage denial or in-use file — leave the row intact
        } else {
          await clearLocalUri(item.media_id);
          freedThis = item.byte_size;
        }
      } catch {
        ok = false;
      }
    }
    if (ok) {
      await setPendingFindingsForMedia(item.media_id, "deleted");
      outcome.deleted++;
      outcome.freedBytes += freedThis;
    } else {
      outcome.failed++;
    }
    onProgress?.(outcome.deleted);
  }

  // Findings for items that were NOT deletable under this scope stay pending —
  // they were pre-filtered, so this only guards against races (state flipped
  // between review and confirm).
  return outcome;
}
