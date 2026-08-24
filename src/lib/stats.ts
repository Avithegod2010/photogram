import { getDb } from "../db";

export interface StorageTotals {
  photos: number;
  videos: number;
  syncedBytes: number;
  pendingCount: number;
  failedCount: number;
  archived: number;
  trashed: number;
  hidden: number;
}

export interface MonthBucket {
  label: string;
  count: number;
  bytes: number;
}

export async function getStorageTotals(): Promise<StorageTotals> {
  const db = await getDb();
  const mediaRow = await db.getFirstAsync<{
    photos: number;
    videos: number;
    synced_bytes: number;
    archived: number;
    trashed: number;
    hidden: number;
  }>(`
    SELECT
      COALESCE(SUM(CASE WHEN visibility != 'trashed' AND mime_type LIKE 'image/%' THEN 1 ELSE 0 END), 0) AS photos,
      COALESCE(SUM(CASE WHEN visibility != 'trashed' AND mime_type LIKE 'video/%' THEN 1 ELSE 0 END), 0) AS videos,
      COALESCE(SUM(CASE WHEN state = 'synced' THEN byte_size ELSE 0 END), 0) AS synced_bytes,
      COALESCE(SUM(CASE WHEN visibility = 'archived' THEN 1 ELSE 0 END), 0) AS archived,
      COALESCE(SUM(CASE WHEN visibility = 'trashed' THEN 1 ELSE 0 END), 0) AS trashed,
      COALESCE(SUM(CASE WHEN visibility = 'hidden' THEN 1 ELSE 0 END), 0) AS hidden
    FROM media
  `);
  const queueRow = await db.getFirstAsync<{ pending: number; failed: number }>(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('pending','active','paused') THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM upload_queue
  `);
  return {
    photos: mediaRow?.photos ?? 0,
    videos: mediaRow?.videos ?? 0,
    syncedBytes: mediaRow?.synced_bytes ?? 0,
    archived: mediaRow?.archived ?? 0,
    trashed: mediaRow?.trashed ?? 0,
    hidden: mediaRow?.hidden ?? 0,
    pendingCount: queueRow?.pending ?? 0,
    failedCount: queueRow?.failed ?? 0,
  };
}

export async function getMonthlyBuckets(monthsBack = 6): Promise<MonthBucket[]> {
  const db = await getDb();
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
  const rows = await db.getAllAsync<{ ym: string; count: number; bytes: number }>(
    `
    SELECT
      strftime('%Y-%m', taken_at / 1000, 'unixepoch') AS ym,
      COUNT(*) AS count,
      COALESCE(SUM(byte_size), 0) AS bytes
    FROM media
    WHERE taken_at >= ? AND visibility != 'trashed'
    GROUP BY ym
  `,
    [since.getTime()]
  );
  const byKey = new Map(rows.map((r) => [r.ym, r]));
  const buckets: MonthBucket[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1) + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = byKey.get(key);
    buckets.push({
      label: d.toLocaleString(undefined, { month: "short" }),
      count: row?.count ?? 0,
      bytes: row?.bytes ?? 0,
    });
  }
  return buckets;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
