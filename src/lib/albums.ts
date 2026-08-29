import { getDb } from "../db";
import type { MediaRow } from "../db/queries";

export interface AutoAlbum {
  key: string;
  label: string;
  count: number;
  coverThumb: string | null;
}

export interface AlbumDef {
  key: string;
  label: string;
  sub: string;
  // SQL fragment over the media table; must not reference an alias.
  cond: string;
}

// Auto-albums group scanned media by the tags/mime the scanner records.
// "Camera" = everything that is NOT one of the app/derived sources below.
export const ALBUM_DEFS: AlbumDef[] = [
  {
    key: "camera",
    label: "Camera",
    sub: "Photos and videos taken with your camera",
    cond:
      "tags NOT LIKE '%screenshot%' AND tags NOT LIKE '%whatsapp%' AND tags NOT LIKE '%download%'",
  },
  {
    key: "screenshots",
    label: "Screenshots",
    sub: "Screenshot files from any app",
    cond: "tags LIKE '%screenshot%'",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    sub: "Media received or saved from WhatsApp",
    cond: "tags LIKE '%whatsapp%'",
  },
  {
    key: "downloads",
    label: "Downloads",
    sub: "Images and videos you downloaded",
    cond: "tags LIKE '%download%'",
  },
  {
    key: "videos",
    label: "Videos",
    sub: "Every video in your library",
    cond: "mime_type LIKE 'video/%'",
  },
];

export function albumDef(key: string): AlbumDef | null {
  return ALBUM_DEFS.find((a) => a.key === key) ?? null;
}

export async function getAutoAlbums(): Promise<AutoAlbum[]> {
  const db = await getDb();
  const albums: AutoAlbum[] = [];
  for (const def of ALBUM_DEFS) {
    const row = await db.getFirstAsync<{ count: number; cover: string | null }>(
      `SELECT
         COUNT(*) AS count,
         (SELECT m2.thumb_uri FROM media m2
           WHERE m2.visibility = 'visible' AND ${def.cond}
           ORDER BY m2.taken_at DESC, m2.id DESC LIMIT 1) AS cover
       FROM media m
       WHERE m.visibility = 'visible' AND ${def.cond}`
    );
    const count = row?.count ?? 0;
    if (count > 0) {
      albums.push({
        key: def.key,
        label: def.label,
        count,
        coverThumb: row?.cover ?? null,
      });
    }
  }
  return albums;
}

export async function getAlbumMedia(key: string, limit = 600): Promise<MediaRow[]> {
  const def = albumDef(key);
  if (!def) return [];
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    `SELECT * FROM media WHERE visibility = 'visible' AND ${def.cond}
     ORDER BY taken_at DESC, id DESC LIMIT ?`,
    [limit]
  );
}
