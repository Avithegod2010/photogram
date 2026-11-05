import { getDb } from "../db";
import { getMeta, setMeta } from "../db/queries";

// v0.55 weekly SQLite maintenance.
//
// The gallery is a WAL database that grows and shrinks constantly (scans,
// trashes, edits, uploads). Without maintenance the WAL file can stay large and
// the planner keeps statistics from months ago. Once a week we:
//   1. checkpoint the WAL into the main file (TRUNCATE keeps it small),
//   2. run PRAGMA optimize so the query planner refreshes its stats,
//   3. VACUUM only when a meaningful share of the file is free pages.
// Everything is best-effort: a busy database simply skips until next week.

export const MAINTENANCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAINTENANCE_KEY = "db_maintenance_at";
// VACUUM rewrites the whole file; only worth it when >= 20% is reclaimable.
export const VACUUM_FREE_RATIO = 0.2;

export function shouldRunMaintenance(
  lastAt: number,
  now: number,
  interval = MAINTENANCE_INTERVAL_MS
): boolean {
  if (!Number.isFinite(lastAt) || lastAt <= 0) return true;
  return now - lastAt >= interval;
}

export async function maybeRunDbMaintenance(now = Date.now()): Promise<boolean> {
  try {
    const raw = Number((await getMeta(MAINTENANCE_KEY)) ?? 0);
    if (!shouldRunMaintenance(Number.isFinite(raw) ? raw : 0, now)) return false;

    const db = await getDb();
    try {
      await db.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {}
    try {
      await db.execAsync("PRAGMA optimize");
    } catch {}

    // Free-page ratio decides whether VACUUM is worth the rewrite.
    try {
      const pageCount = await db.getFirstAsync<{ n: number }>("PRAGMA page_count");
      const freePages = await db.getFirstAsync<{ n: number }>("PRAGMA freelist_count");
      const total = pageCount?.n ?? 0;
      const free = freePages?.n ?? 0;
      if (total > 0 && free / total >= VACUUM_FREE_RATIO) {
        await db.execAsync("VACUUM");
      }
    } catch {}

    await setMeta(MAINTENANCE_KEY, String(now));
    return true;
  } catch {
    return false; // maintenance must never break boot
  }
}
