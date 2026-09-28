import { getDb } from "../db";

// v0.18 Year-in-review "2026 Wrapped": read-only aggregations over the owner's
// own visible library (excludes trashed + shared-album claims, matching every
// other stats surface). stats.ts is untouched — the Settings dashboard stays
// byte-identical.

export interface WrappedTopDay {
  label: string;
  count: number;
  thumbs: string[];
}

export interface WrappedStats {
  year: number;
  photos: number;
  videos: number;
  syncedBytes: number;
  busiestMonth: { label: string; count: number } | null;
  topDays: WrappedTopDay[];
  daysCaptured: number;
  favorites: number;
}

const OWN_MEDIA = `visibility != 'trashed'
  AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)`;

// Years that actually have media, newest first.
export async function getWrappedYears(): Promise<number[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ y: string }>(
    `SELECT DISTINCT CAST(strftime('%Y', taken_at / 1000, 'unixepoch') AS TEXT) AS y
     FROM media
     WHERE ${OWN_MEDIA} AND taken_at > 0
     ORDER BY y DESC`
  );
  return rows.map((r) => Number(r.y)).filter((y) => Number.isFinite(y));
}

export async function getWrapped(year: number): Promise<WrappedStats> {
  const db = await getDb();
  const yWhere = `CAST(strftime('%Y', taken_at / 1000, 'unixepoch') AS INTEGER) = ${Number(year)}`;

  const totals = await db.getFirstAsync<{ photos: number; videos: number; synced: number; days: number; favorites: number }>(`
    SELECT
      COALESCE(SUM(CASE WHEN mime_type LIKE 'image/%' THEN 1 ELSE 0 END), 0) AS photos,
      COALESCE(SUM(CASE WHEN mime_type LIKE 'video/%' THEN 1 ELSE 0 END), 0) AS videos,
      COALESCE(SUM(CASE WHEN state = 'synced' THEN byte_size ELSE 0 END), 0) AS synced,
      COUNT(DISTINCT CAST(strftime('%Y-%m-%d', taken_at / 1000, 'unixepoch') AS TEXT)) AS days,
      COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) AS favorites
    FROM media
    WHERE ${OWN_MEDIA} AND ${yWhere}
  `);

  const month = await db.getFirstAsync<{ m: string; count: number }>(`
    SELECT CAST(strftime('%m', taken_at / 1000, 'unixepoch') AS TEXT) AS m, COUNT(*) AS count
    FROM media
    WHERE ${OWN_MEDIA} AND ${yWhere}
    GROUP BY m
    ORDER BY count DESC
    LIMIT 1
  `);

  const dayRows = await db.getAllAsync<{ d: string; count: number; thumbs: string }>(`
    SELECT CAST(strftime('%Y-%m-%d', taken_at / 1000, 'unixepoch') AS TEXT) AS d,
           COUNT(*) AS count,
           GROUP_CONCAT(thumb_uri) AS thumbs
    FROM media
    WHERE ${OWN_MEDIA} AND ${yWhere}
    GROUP BY d
    ORDER BY count DESC
    LIMIT 3
  `);

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  return {
    year,
    photos: totals?.photos ?? 0,
    videos: totals?.videos ?? 0,
    syncedBytes: totals?.synced ?? 0,
    busiestMonth: month ? { label: monthNames[Number(month.m) - 1] ?? month.m, count: month.count } : null,
    topDays: dayRows.map((r) => ({
      label: r.d,
      count: r.count,
      thumbs: (r.thumbs ?? "").split(",").slice(0, 3).filter(Boolean),
    })),
    daysCaptured: totals?.days ?? 0,
    favorites: totals?.favorites ?? 0,
  };
}
