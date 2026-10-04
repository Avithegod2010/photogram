import { getDb } from "../db";

export interface StorageTotals {
  photos: number;
  videos: number;
  cloudPhotos: number;
  cloudVideos: number;
  syncedBytes: number;
  pendingCount: number;
  failedCount: number;
  archived: number;
  trashed: number;
  hidden: number;
}

export interface MonthBucket {
  label: string;
  ym: string; // "YYYY-MM" — lets screens disambiguate months across years
  count: number;
  bytes: number;
}

export async function getStorageTotals(): Promise<StorageTotals> {
  const db = await getDb();
  const mediaRow = await db.getFirstAsync<{
    photos: number;
    videos: number;
    cloud_photos: number;
    cloud_videos: number;
    synced_bytes: number;
    archived: number;
    trashed: number;
    hidden: number;
  }>(`
    SELECT
      COALESCE(SUM(CASE WHEN visibility != 'trashed' AND mime_type LIKE 'image/%' THEN 1 ELSE 0 END), 0) AS photos,
      COALESCE(SUM(CASE WHEN visibility != 'trashed' AND mime_type LIKE 'video/%' THEN 1 ELSE 0 END), 0) AS videos,
      COALESCE(SUM(CASE WHEN state = 'synced' AND visibility != 'trashed' AND mime_type LIKE 'image/%' THEN 1 ELSE 0 END), 0) AS cloud_photos,
      COALESCE(SUM(CASE WHEN state = 'synced' AND visibility != 'trashed' AND mime_type LIKE 'video/%' THEN 1 ELSE 0 END), 0) AS cloud_videos,
      COALESCE(SUM(CASE WHEN state = 'synced' THEN byte_size ELSE 0 END), 0) AS synced_bytes,
      COALESCE(SUM(CASE WHEN visibility = 'archived' THEN 1 ELSE 0 END), 0) AS archived,
      COALESCE(SUM(CASE WHEN visibility = 'trashed' THEN 1 ELSE 0 END), 0) AS trashed,
      COALESCE(SUM(CASE WHEN visibility = 'hidden' THEN 1 ELSE 0 END), 0) AS hidden
    FROM media
    WHERE edited_from IS NULL
      AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)
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
    cloudPhotos: mediaRow?.cloud_photos ?? 0,
    cloudVideos: mediaRow?.cloud_videos ?? 0,
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
    WHERE taken_at >= ? AND visibility != 'trashed' AND edited_from IS NULL
      AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)
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
      ym: key,
      count: row?.count ?? 0,
      bytes: row?.bytes ?? 0,
    });
  }
  return buckets;
}

// --- v0.29 Storage deep-dive ---------------------------------------------------
// Same "my library" universe as the dashboard: nothing in the Trash, no edited
// copies, no shared-album claims.

export interface LargeItem {
  id: number;
  thumb_uri: string;
  file_name: string | null;
  mime_type: string | null;
  byte_size: number;
}

export async function getLargestItems(limit = 12): Promise<LargeItem[]> {
  const db = await getDb();
  return db.getAllAsync<LargeItem>(
    `SELECT id, thumb_uri, file_name, mime_type, byte_size FROM media
     WHERE visibility != 'trashed' AND edited_from IS NULL
       AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)
     ORDER BY byte_size DESC, id DESC
     LIMIT ?`,
    [limit]
  );
}

export interface CategoryUsage {
  key: "everything" | "screenshots" | "whatsapp" | "downloads" | "videos";
  label: string;
  count: number;
  bytes: number;
}

// One aggregate pass. Categories overlap by design (a WhatsApp video counts
// as both WhatsApp media and a video) — the screen presents them as
// independent insights, not a partition.
export async function getCategoryUsage(): Promise<CategoryUsage[]> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    all_bytes: number;
    all_count: number;
    screenshot_bytes: number;
    screenshot_count: number;
    whatsapp_bytes: number;
    whatsapp_count: number;
    download_bytes: number;
    download_count: number;
    video_bytes: number;
    video_count: number;
  }>(`
    SELECT
      COALESCE(SUM(byte_size), 0) AS all_bytes,
      COUNT(*) AS all_count,
      COALESCE(SUM(CASE WHEN tags LIKE '%screenshot%' THEN byte_size ELSE 0 END), 0) AS screenshot_bytes,
      COALESCE(SUM(CASE WHEN tags LIKE '%screenshot%' THEN 1 ELSE 0 END), 0) AS screenshot_count,
      COALESCE(SUM(CASE WHEN tags LIKE '%whatsapp%' THEN byte_size ELSE 0 END), 0) AS whatsapp_bytes,
      COALESCE(SUM(CASE WHEN tags LIKE '%whatsapp%' THEN 1 ELSE 0 END), 0) AS whatsapp_count,
      COALESCE(SUM(CASE WHEN tags LIKE '%download%' THEN byte_size ELSE 0 END), 0) AS download_bytes,
      COALESCE(SUM(CASE WHEN tags LIKE '%download%' THEN 1 ELSE 0 END), 0) AS download_count,
      COALESCE(SUM(CASE WHEN mime_type LIKE 'video/%' THEN byte_size ELSE 0 END), 0) AS video_bytes,
      COALESCE(SUM(CASE WHEN mime_type LIKE 'video/%' THEN 1 ELSE 0 END), 0) AS video_count
    FROM media
    WHERE visibility != 'trashed' AND edited_from IS NULL
      AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)
  `);
  return [
    { key: "everything", label: "Everything", count: row?.all_count ?? 0, bytes: row?.all_bytes ?? 0 },
    { key: "screenshots", label: "Screenshots", count: row?.screenshot_count ?? 0, bytes: row?.screenshot_bytes ?? 0 },
    { key: "whatsapp", label: "WhatsApp media", count: row?.whatsapp_count ?? 0, bytes: row?.whatsapp_bytes ?? 0 },
    { key: "downloads", label: "Downloads", count: row?.download_count ?? 0, bytes: row?.download_bytes ?? 0 },
    { key: "videos", label: "Videos", count: row?.video_count ?? 0, bytes: row?.video_bytes ?? 0 },
  ];
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

export interface BackupHeartbeat {
  total: number;
  synced: number;
  lastSyncedAt: number | null;
}

// Gallery header heartbeat: how much of the owner's own library is safely in
// Telegram, and when the last upload finished. Excludes shared-album claims
// (family media is never this library's backup responsibility).
export async function getBackupHeartbeat(): Promise<BackupHeartbeat | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number; synced: number; last: number | null }>(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN state = 'synced' THEN 1 ELSE 0 END), 0) AS synced,
      MAX(uploaded_at) AS last
    FROM media
    WHERE visibility != 'trashed' AND edited_from IS NULL
      AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)
  `);
  if (!row || row.total === 0) return null;
  return { total: row.total, synced: row.synced, lastSyncedAt: row.last };
}
