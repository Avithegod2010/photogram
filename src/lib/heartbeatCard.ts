import { formatBytes, getBackupHeartbeat, getStorageTotals } from "./stats";

// F4 (v0.12.1): one tap in Settings → Storage composes a numbers-only status
// line for the family group chat, matching the gallery heartbeat figures.
// Privacy hard rule: aggregate numbers only — no file names, paths, album or
// contact names. No TDLib calls, no DB writes.

const STALE_MS = 48 * 60 * 60 * 1000;

// Mirrors GalleryScreen's timeAgo() phrasing (reimplemented privately —
// GalleryScreen is another agent's territory; ~8 lines of duplication accepted).
function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function absoluteDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Returns null when there is nothing to report (fresh/empty library) — the
// Settings row hides itself in that case.
export async function composeBackupCard(): Promise<string | null> {
  const heartbeat = await getBackupHeartbeat();
  if (!heartbeat) return null;
  const totals = await getStorageTotals();

  const { total, synced, lastSyncedAt } = heartbeat;
  // Live queue truth first; if the queue has drained while items are still
  // missing (failed/cleared), fall back to the remainder so a partial backup
  // can never claim "0 pending".
  let pending = totals.pendingCount;
  if (pending === 0 && synced < total) pending = total - synced;

  const head = `Photogram: ${formatBytes(totals.syncedBytes)} safe — ${synced.toLocaleString()} of ${total.toLocaleString()} backed up.`;

  let lastUpload = "";
  if (lastSyncedAt !== null) {
    const age = Date.now() - lastSyncedAt;
    const when = age >= 0 && age < STALE_MS ? relativeTime(lastSyncedAt) : absoluteDate(lastSyncedAt);
    lastUpload = ` Last upload ${when}.`;
  }

  return `${head}${lastUpload} ${pending.toLocaleString()} pending.`;
}
