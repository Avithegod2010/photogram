import { File, Paths } from "expo-file-system";
import { formatBytes, getBackupHeartbeat, getStorageTotals } from "./stats";

// v0.46 Android home-screen widget handoff. The probe can run this module un-
// changed: the widget itself (Kotlin, android/) only READS files/widget_state.json
// from the app's sandbox — same UID, no extra permissions. JS writes numbers
// only, matching composeBackupCard's privacy hard rule: aggregate counts/bytes,
// last-upload recency, queued count — never file names, paths, album or
// contact names.
//
// The quick-settings tile (PhotogramTileService) writes/removes files/tile_pause
// ("pause new queuing from the shade"). tilePauseActive() reports it; the
// auto-backup loop gates its enqueueing on it. Active uploads are NOT touched
// by the tile (uploader.ts stays protected).

const STATE_FILE = "widget_state.json";
const TILE_PAUSE_FILE = "tile_pause";

let loopStarted = false;

function stateFile(): File {
  return new File(Paths.document, STATE_FILE);
}

export function tilePauseActive(): boolean {
  try {
    return new File(Paths.document, TILE_PAUSE_FILE).exists;
  } catch {
    return false;
  }
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export async function buildWidgetState(): Promise<{
  line1: string;
  line2: string;
  pending: number;
  synced: number;
  total: number;
  updatedAt: number;
} | null> {
  const heartbeat = await getBackupHeartbeat();
  if (!heartbeat) return null;
  const totals = await getStorageTotals();
  const { total, synced, lastSyncedAt } = heartbeat;
  // Same truth rule as composeBackupCard: the live queue wins, else the
  // remainder — a partial backup can never claim "0 pending".
  let pending = totals.pendingCount;
  if (pending === 0 && synced < total) pending = total - synced;
  const last = lastSyncedAt !== null ? ` · last ${timeAgo(lastSyncedAt)}` : "";
  const line1 = `${formatBytes(totals.syncedBytes)} safe`;
  const line2 = `${synced.toLocaleString()} of ${total.toLocaleString()} backed up${last}${
    tilePauseActive() ? " · queuing paused" : ""
  }`;
  return { line1, line2, pending, synced, total, updatedAt: Date.now() };
}

// Never throws; returns whether a state file is now on disk.
export async function syncWidgetState(): Promise<boolean> {
  try {
    const state = await buildWidgetState();
    const file = stateFile();
    if (file.exists) file.delete();
    if (!state) return false;
    file.create();
    file.write(new TextEncoder().encode(JSON.stringify(state)));
    return true;
  } catch {
    return false;
  }
}

export function startWidgetStateLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  void syncWidgetState();
  setInterval(() => void syncWidgetState(), 15 * 60 * 1000);
}
