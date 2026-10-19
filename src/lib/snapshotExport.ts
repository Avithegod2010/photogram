import { File, Directory, Paths } from "expo-file-system";
import { buildManifestJson } from "./exportManifest";
import { listAllMediaForExport, listPeopleForExport, listFacesForExport } from "../db/queries";
import { mmkv, useSettingsStore } from "../store/settingsStore";

// v0.40 Weekly snapshot export — an in-app loop (no native background task),
// mirroring the junk auto-sweep pattern. While the app is foregrounded it reads
// a MMKV determine-last-run key; once a week has passed it writes a FRESH JSON
// manifest of the whole index into documents/export/snapshots/ under the app
// sandbox. If the phone is lost, the latest snapshot is a true, out-of-app
// (via any file share) addressable copy of the index. Files never leave the
// device by themselves — Telegram-safety rule.
//
// Retention: only the newest SNAP_KEEP_COUNT snapshots are kept.

const LAST_SNAPSHOT_KEY = "weekly_snapshot_last_at";
const SNAPSHOT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SNAP_KEEP_COUNT = 8;

export interface SnapshotResult {
  fileName: string;
  byteCount: number;
  kept: number;
}

export function snapshotDir(): Directory {
  const dir = new Directory(Paths.document, "export/snapshots");
  if (!dir.exists) dir.create();
  return dir;
}

export function lastSnapshotAt(): number {
  const v = Number(mmkv.getString(LAST_SNAPSHOT_KEY) ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export interface SnapshotInfo {
  fileName: string;
  byteCount: number;
  modified: number;
}

export function listSnapshots(): SnapshotInfo[] {
  try {
    const dir = snapshotDir();
    const out: SnapshotInfo[] = [];
    for (const item of dir.list()) {
      if (!(item instanceof File)) continue;
      if (!item.name.startsWith("photogram-snapshot-") || !item.name.endsWith(".json")) continue;
      out.push({
        fileName: item.name,
        byteCount: item.size,
        modified: item.lastModified ?? item.modificationTime ?? 0,
      });
    }
    return out.sort((a, b) => a.modified - b.modified);
  } catch {
    return [];
  }
}

async function pruneOldSnapshots(): Promise<number> {
  const all = listSnapshots();
  let removed = 0;
  while (all.length > SNAP_KEEP_COUNT) {
    const oldest = all.shift();
    if (!oldest) break;
    try {
      new File(snapshotDir(), oldest.fileName).delete();
      removed++;
    } catch {
      break;
    }
  }
  return removed;
}

async function writeSnapshot(): Promise<SnapshotResult> {
  const [media, people, faces] = await Promise.all([
    listAllMediaForExport(),
    listPeopleForExport(),
    listFacesForExport(),
  ]);
  const text = buildManifestJson(media, people, faces, Date.now(), true);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 10);
  const fileName = `photogram-snapshot-${stamp}.json`;
  const file = new File(snapshotDir(), fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(new TextEncoder().encode(text));
  mmkv.set(LAST_SNAPSHOT_KEY, String(Date.now()));
  const kept = await pruneOldSnapshots();
  return { fileName, byteCount: file.size, kept };
}

export interface SnapshotCheck {
  ran: boolean;
  reason: string;
  result?: SnapshotResult;
}

// Called by the App loop (foreground) — never throws.
export async function checkAndSnapshot(): Promise<SnapshotCheck> {
  try {
    const enabled = useSettingsStore.getState().snapshotExport;
    if (!enabled) return { ran: false, reason: "disabled" };
    const last = lastSnapshotAt();
    if (Date.now() - last < SNAPSHOT_INTERVAL_MS) return { ran: false, reason: "not-due" };
    const result = await writeSnapshot();
    return { ran: true, reason: "ok", result };
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message : "error" };
  }
}

export function startSnapshotLoop(): void {
  void checkAndSnapshot();
  const t: unknown = setInterval(() => void checkAndSnapshot(), CHECK_INTERVAL_MS);
  if (t && typeof t === "object" && "unref" in t) (t as { unref: () => void }).unref();
}

// Manual run from Export screen (skips the gate) — returns the result or
// rethrows nothing.
export async function runSnapshotNow(): Promise<SnapshotCheck> {
  try {
    const enabled = useSettingsStore.getState().snapshotExport;
    if (!enabled) return { ran: false, reason: "disabled" };
    const result = await writeSnapshot();
    return { ran: true, reason: "manual", result };
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message : "error" };
  }
}
