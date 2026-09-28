import { getDb } from "../db";

export interface MemoryGroup {
  key: string;
  yearsAgo: number;
  count: number;
  coverThumb: string;
  mediaIds: number[];
}

// Groups every prior-year day (even single items) so the carousel shows more
// unique memories, not just days that happen to share a date with today.
export async function getMemories(limit = 12): Promise<MemoryGroup[]> {
  const db = await getDb();
  const thisYear = new Date().getFullYear();

  const rows = await db.getAllAsync<{
    y: number;
    m: number;
    d: number;
    count: number;
    cover: string;
    ids: string;
  }>(`
    SELECT
      CAST(strftime('%Y', taken_at / 1000, 'unixepoch') AS INTEGER) AS y,
      CAST(strftime('%m', taken_at / 1000, 'unixepoch') AS INTEGER) AS m,
      CAST(strftime('%d', taken_at / 1000, 'unixepoch') AS INTEGER) AS d,
      COUNT(*) AS count,
      MIN(thumb_uri) AS cover,
      GROUP_CONCAT(id) AS ids
    FROM media
    WHERE visibility = 'visible' AND edited_from IS NULL
      AND CAST(strftime('%Y', taken_at / 1000, 'unixepoch') AS INTEGER) < ?
      AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)
    GROUP BY y, m, d
    HAVING count >= 1
    ORDER BY (m * 100 + d) = (CAST(strftime('%m','now') AS INTEGER) * 100 + CAST(strftime('%d','now') AS INTEGER)) DESC,
             ABS(m * 100 + d - (CAST(strftime('%m','now') AS INTEGER) * 100 + CAST(strftime('%d','now') AS INTEGER))) ASC,
             count DESC
    LIMIT ?`,
    [thisYear, limit]
  );

  return rows.map((r) => {
    const now = new Date();
    let yearsAgo = thisYear - r.y;
    const thisMd = now.getMonth() * 100 + now.getDate();
    if (thisMd < r.m * 100 + r.d) yearsAgo -= 1;
    return {
      key: `${r.y}-${String(r.m).padStart(2, "0")}-${String(r.d).padStart(2, "0")}`,
      yearsAgo: Math.max(1, yearsAgo),
      count: r.count,
      coverThumb: r.cover,
      mediaIds: r.ids.split(",").map(Number),
    };
  });
}
