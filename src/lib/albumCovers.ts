import { mmkv } from "../store/settingsStore";
import { getMediaByIds } from "../db/queries";

// v0.47 album cover picker: per auto-album key this stores a media id the
// owner hand-picked in the album screen. getAutoAlbums consults this before
// falling back to "newest item" — if the row has since been deleted/trashed
// the stored id no longer resolves and the newest-item cover comes back.

const KEY_PREFIX = "album_cover_";

export function albumCoverKey(albumKey: string): string {
  return KEY_PREFIX + albumKey;
}

export function getAlbumCoverId(albumKey: string): number | null {
  const raw = mmkv.getString(albumCoverKey(albumKey));
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function getAlbumCoverThumb(albumKey: string): Promise<string | null> {
  const id = getAlbumCoverId(albumKey);
  if (id === null) return null;
  try {
    const rows = await getMediaByIds([id]);
    const row = rows.find((r) => r.id === id);
    if (row && row.visibility !== "trashed" && row.thumb_uri) return row.thumb_uri;
  } catch {}
  return null;
}

export async function setAlbumCover(albumKey: string, mediaId: number): Promise<void> {
  const rows = await getMediaByIds([mediaId]);
  const row = rows.find((r) => r.id === mediaId);
  if (!row) throw new Error("Row not found — cannot set cover.");
  mmkv.set(albumCoverKey(albumKey), String(mediaId));
}

export function clearAlbumCover(albumKey: string): void {
  mmkv.remove(albumCoverKey(albumKey));
}
