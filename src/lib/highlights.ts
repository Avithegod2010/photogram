import { getDb } from "../db";
import { MediaRow } from "../db/queries";
import { BLUR_VARIANCE_THRESHOLD } from "./junk";

// v0.33 "Highlights": the sharpest few photos of each month — the Junk
// Sweeper's blur metric flipped around (same analyzer, opposite intent).
// Photos only (the analyzer reads thumbnails), the same "my library" universe
// as the dashboard, and the blur threshold keeps genuinely soft shots out.
// The per-month window function is plain SQLite (ROW_NUMBER, 3.25+).

export interface HighlightMonth {
  ym: string; // "YYYY-MM" (UTC, matching the SQL partition)
  label: string; // "October 2026"
  items: MediaRow[]; // sharpest first
}

export async function getHighlights(perMonth = 6): Promise<HighlightMonth[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MediaRow & { rn: number }>(
    `SELECT * FROM (
       SELECT m.*, ROW_NUMBER() OVER (
         PARTITION BY strftime('%Y-%m', m.taken_at / 1000, 'unixepoch')
         ORDER BY m.sharpness DESC, m.taken_at DESC, m.id DESC
       ) AS rn
       FROM media m
       WHERE m.sharpness IS NOT NULL AND m.sharpness >= ?
         AND m.mime_type LIKE 'image/%' AND m.visibility = 'visible'
         AND m.edited_from IS NULL
         AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = m.id)
     ) AS ranked
     WHERE ranked.rn <= ?
     ORDER BY ranked.taken_at DESC, ranked.sharpness DESC`,
    [BLUR_VARIANCE_THRESHOLD, perMonth]
  );

  const months: HighlightMonth[] = [];
  const byYm = new Map<string, HighlightMonth>();
  for (const row of rows) {
    // strftime('%Y-%m', taken_at/1000, 'unixepoch') is UTC — toISOString
    // slices the same value, so grouping always matches the partition.
    const ym = new Date(row.taken_at).toISOString().slice(0, 7);
    let month = byYm.get(ym);
    if (!month) {
      const [y, m] = ym.split("-").map(Number);
      month = {
        ym,
        label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        items: [],
      };
      byYm.set(ym, month);
      months.push(month);
    }
    month.items.push(row);
  }
  return months;
}
