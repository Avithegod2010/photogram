import TdLib from "react-native-tdlib";
import { File } from "expo-file-system";
import { listDrillCandidates, type DrillCandidate } from "../db/queries";
import { extractRemoteFile, fetchMessage, withTimeout } from "./restorer";
import { useSettingsStore } from "../store/settingsStore";
import { hashLocalFile, verifyChecksum, type ChecksumVerdict } from "./checksum";

// v0.55 restore drill: "prove you can actually get your photos back".
//
// Downloads a handful of random synced originals straight from Telegram,
// confirms each download really completes and has a plausible size, then
// deletes the temporary copy again (nothing lands in the phone gallery).
//
// The orchestration is pure/dependency-injected (pick + summarize) so the
// probe can exercise it without a network, while `verifyCandidate` is the only
// part that talks to TDLib.

export type DrillOutcome = "ok" | "missing" | "failed";

export interface DrillResult {
  id: number;
  fileName: string;
  outcome: DrillOutcome;
  bytes: number;
  sizeDiffers: boolean; // remote size != indexed size (expected for storage-saver uploads)
  checksum: ChecksumVerdict; // v0.55: bytes compared against the scan-time SHA-256
  detail?: string;
}

export interface DrillReport {
  startedAt: number;
  finishedAt: number;
  checked: number;
  ok: number;
  problems: DrillResult[];
  sizeDiffs: number;
  bytes: number;
  verified: number; // v0.55: SHA-256 matched the scan-time hash
  checksumMismatches: number;
}

export const DEFAULT_DRILL_COUNT = 8;

// Deterministic sample for tests; dedupes by id and never mutates the input.
export function pickDrillSample<T extends { id: number }>(
  rows: T[],
  count: number,
  rand: () => number = Math.random
): T[] {
  const target = Math.max(0, Math.min(count, rows.length));
  const pool = [...rows];
  const out: T[] = [];
  const seen = new Set<number>();
  while (out.length < target && pool.length > 0) {
    const idx = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
    const [row] = pool.splice(idx, 1);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function summarizeDrill(
  results: DrillResult[],
  startedAt: number,
  finishedAt: number
): DrillReport {
  let ok = 0;
  let sizeDiffs = 0;
  let bytes = 0;
  let verified = 0;
  let checksumMismatches = 0;
  const problems: DrillResult[] = [];
  for (const r of results) {
    bytes += r.bytes;
    if (r.sizeDiffers) sizeDiffs++;
    if (r.checksum === "match") verified++;
    if (r.checksum === "mismatch") checksumMismatches++;
    if (r.outcome === "ok") ok++;
    else problems.push(r);
  }
  return {
    startedAt,
    finishedAt,
    checked: results.length,
    ok,
    problems,
    sizeDiffs,
    bytes,
    verified,
    checksumMismatches,
  };
}

// One real download. TDLib caches the file on disk; we remove it afterwards so
// a drill never eats storage.
export async function verifyCandidate(c: DrillCandidate): Promise<DrillResult> {
  const base: DrillResult = {
    id: c.id,
    fileName: c.file_name ?? `#${c.id}`,
    outcome: "failed",
    bytes: 0,
    sizeDiffers: false,
    checksum: "unchecked",
  };
  try {
    try {
      await TdLib.createPrivateChat(Number(c.remote_chat_id));
    } catch {}
    const found = await withTimeout(
      fetchMessage(c.remote_chat_id as string, c.remote_message_id as string, c.file_name),
      60_000,
      "Fetching message"
    );
    if (!found) return { ...base, outcome: "missing", detail: "Message not found in Telegram" };
    const remote = extractRemoteFile(found.message);
    if (!remote) return { ...base, outcome: "missing", detail: "Message has no file" };

    const download = await withTimeout(
      TdLib.downloadFileByRemoteId(remote.remoteId),
      10 * 60 * 1000,
      "Downloading"
    );
    const file = JSON.parse(download.raw) as Record<string, any>;
    const localPath: string | undefined = file?.local?.path;
    const completed =
      file?.local?.isDownloadingCompleted ?? file?.local?.is_downloading_completed;
    const size = Number(file?.size ?? remote.expected ?? 0);
    if (completed !== true || !localPath || size <= 0) {
      return { ...base, outcome: "failed", detail: "Download did not complete" };
    }

    // Storage-saver uploads are recompressed, so a size difference is expected
    // there; with "Original" quality it is a genuine warning.
    const quality = useSettingsStore.getState().uploadQuality;
    const sizeDiffers = quality === "original" && c.byte_size > 0 && Math.abs(size - c.byte_size) > 1024;

    // v0.55 checksum proof: hash the downloaded copy BEFORE deleting it, so a
    // "restored" item is byte-compared with what was scanned on the phone.
    const actual = await hashLocalFile(localPath);
    const checksum = verifyChecksum(c.content_sha256 ?? null, actual);

    // Best-effort cleanup of the temporary download.
    try {
      new File(localPath).delete();
    } catch {}

    if (checksum === "mismatch") {
      return {
        ...base,
        outcome: "failed",
        bytes: size,
        sizeDiffers,
        checksum,
        detail: "Checksum mismatch — the Telegram copy differs from the original",
      };
    }

    return { ...base, outcome: "ok", bytes: size, sizeDiffers, checksum };
  } catch (err) {
    return {
      ...base,
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface DrillDeps {
  list?: (count: number) => Promise<DrillCandidate[]>;
  verify?: (c: DrillCandidate) => Promise<DrillResult>;
  rand?: () => number;
}

export async function runRestoreDrill(
  count = DEFAULT_DRILL_COUNT,
  deps: DrillDeps = {}
): Promise<DrillReport> {
  const startedAt = Date.now();
  const list = deps.list ?? ((n: number) => listDrillCandidates(n));
  const verify = deps.verify ?? verifyCandidate;
  const rand = deps.rand ?? Math.random;

  let candidates: DrillCandidate[] = [];
  try {
    candidates = await list(Math.max(count * 4, 24));
  } catch {
    candidates = [];
  }
  const sample = pickDrillSample(candidates, count, rand);
  const results: DrillResult[] = [];
  for (const c of sample) {
    results.push(await verify(c));
  }
  return summarizeDrill(results, startedAt, Date.now());
}
