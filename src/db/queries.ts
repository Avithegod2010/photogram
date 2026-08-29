import { getDb } from "./index";

export type MediaState = "local" | "queued" | "uploading" | "synced" | "failed";
export type MediaVisibility = "visible" | "archived" | "trashed" | "hidden";

export interface MediaRow {
  id: number;
  local_uri: string | null;
  thumb_uri: string;
  remote_chat_id: string | null;
  remote_message_id: string | null;
  file_name: string | null;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  taken_at: number;
  uploaded_at: number | null;
  fingerprint: string;
  content_hash: string | null;
  exif_kept: number;
  state: MediaState;
  visibility: MediaVisibility;
  trashed_at: number | null;
  media_library_id: string | null;
}

export interface NewMediaInput {
  local_uri: string;
  thumb_uri: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  taken_at: number;
  fingerprint: string;
  state?: MediaState;
  tags?: string;
  media_library_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface QueueRow {
  id: number;
  media_id: number;
  local_uri: string;
  byte_size: number;
  attempts: number;
  status: "pending" | "active" | "paused" | "done" | "failed";
  error: string | null;
}

export async function insertMedia(input: NewMediaInput): Promise<number | null> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO media
      (local_uri, thumb_uri, file_name, mime_type, byte_size, width, height, duration_ms,
       taken_at, fingerprint, state, visibility, tags, latitude, longitude, media_library_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?, ?, ?, ?, ?)`,
    [
      input.local_uri,
      input.thumb_uri,
      input.file_name,
      input.mime_type,
      input.byte_size,
      input.width ?? null,
      input.height ?? null,
      input.duration_ms ?? null,
      input.taken_at,
      input.fingerprint,
      input.state ?? "local",
      input.tags ?? "",
      input.latitude ?? null,
      input.longitude ?? null,
      input.media_library_id ?? null,
      now,
      now,
    ]
  );
  return result.changes > 0 ? result.lastInsertRowId : null;
}

export async function updateMediaLibraryId(id: number, libraryId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET media_library_id = ? WHERE id = ?", [libraryId, id]);
}

// Repairs rows whose taken_at is epoch-1970 (missing capture metadata) with a real date.
export async function backfillTakenAt(id: number, takenAtMs: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE media SET taken_at = ?, updated_at = ? WHERE id = ? AND taken_at <= 86400000",
    [takenAtMs, Date.now(), id]
  );
}

// One-shot unit repair: a scan pass stored taken_at in ms*1000 (the MediaLibrary
// timestamp fields are milliseconds on this stack). Values beyond year 2100 are
// exactly 1000x too large, so dividing recovers the true ms timestamp.
export async function repairTakenAtUnits(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE media SET taken_at = CAST(taken_at / 1000 AS INTEGER), updated_at = ? WHERE taken_at > 4102444800000",
    [Date.now()]
  );
}

export async function pageVisibleMedia(beforeTakenAt: number | null, limit = 120): Promise<MediaRow[]> {
  const db = await getDb();
  if (beforeTakenAt === null) {
    return db.getAllAsync<MediaRow>(
      "SELECT * FROM media WHERE visibility = 'visible' ORDER BY taken_at DESC, id DESC LIMIT ?",
      [limit]
    );
  }
  return db.getAllAsync<MediaRow>(
    "SELECT * FROM media WHERE visibility = 'visible' AND (taken_at < ? OR (taken_at = ?)) ORDER BY taken_at DESC, id DESC LIMIT ?",
    [beforeTakenAt, beforeTakenAt, limit]
  );
}

export async function getMediaByIds(ids: number[]): Promise<MediaRow[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.getAllAsync<MediaRow>(
    `SELECT * FROM media WHERE id IN (${placeholders})`,
    [...ids]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is MediaRow => r !== undefined);
}

export async function setMediaState(id: number, state: MediaState): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET state = ?, updated_at = ? WHERE id = ?", [
    state,
    Date.now(),
    id,
  ]);
}

// `state` lets the uploader record remote ids while the bytes are still flying
// ("uploading") and flip to "synced" only once TDLib confirms completion.
export async function setMediaRemote(
  id: number,
  chatId: string,
  messageId: string,
  state: MediaState = "synced"
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE media SET state = ?, remote_chat_id = ?, remote_message_id = ?, uploaded_at = ?, updated_at = ? WHERE id = ?",
    [state, chatId, messageId, Date.now(), Date.now(), id]
  );
}

export async function setMediaVisibility(id: number, visibility: MediaVisibility): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET visibility = ?, trashed_at = ?, updated_at = ? WHERE id = ?", [
    visibility,
    visibility === "trashed" ? Date.now() : null,
    Date.now(),
    id,
  ]);
}

export async function enqueueUpload(mediaId: number, localUri: string, byteSize: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO upload_queue (media_id, local_uri, byte_size, status, enqueued_at) VALUES (?, ?, ?, 'pending', ?)",
    [mediaId, localUri, byteSize, Date.now()]
  );
  await setMediaState(mediaId, "queued");
}

export async function nextQueued(): Promise<QueueRow | null> {
  const db = await getDb();
  return (
    db.getFirstAsync<QueueRow>(
      "SELECT * FROM upload_queue WHERE status = 'pending' ORDER BY enqueued_at ASC LIMIT 1"
    ) ?? null
  );
}

export async function updateQueueStatus(
  queueId: number,
  status: QueueRow["status"],
  error: string | null = null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE upload_queue SET status = ?, error = ?, started_at = COALESCE(started_at, CASE WHEN 'active' = ? THEN ? END), finished_at = CASE WHEN ? IN ('done','failed') THEN ? ELSE finished_at END WHERE id = ?",
    [status, error, status, Date.now(), status, Date.now(), queueId]
  );
}

export async function bumpQueueAttempt(queueId: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ attempts: number }>(
    "SELECT attempts FROM upload_queue WHERE id = ?",
    [queueId]
  );
  const attempts = (row?.attempts ?? 0) + 1;
  await db.runAsync("UPDATE upload_queue SET attempts = ? WHERE id = ?", [attempts, queueId]);
  return attempts;
}

export async function resetActiveToPending(): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE upload_queue SET status = 'pending' WHERE status = 'active'");
}

// Removes surplus pending rows for the same media (the Back-up pill can be
// pressed repeatedly). Keeps the oldest pending row; never touches active/done.
export async function dedupeUploadQueue(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM upload_queue
     WHERE status = 'pending'
       AND media_id IN (
         SELECT media_id FROM upload_queue
         WHERE status IN ('pending','active')
         GROUP BY media_id HAVING COUNT(*) > 1
       )
       AND id NOT IN (
         SELECT MIN(id) FROM upload_queue WHERE status = 'pending' GROUP BY media_id
       )`
  );
}

export async function countQueueByStatus(): Promise<{
  pending: number;
  active: number;
  done: number;
  failed: number;
}> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ pending: number; active: number; done: number; failed: number }>(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM upload_queue
  `);
  return {
    pending: row?.pending ?? 0,
    active: row?.active ?? 0,
    done: row?.done ?? 0,
    failed: row?.failed ?? 0,
  };
}

export interface SyncedWithLocal {
  id: number;
  local_uri: string;
  byte_size: number;
  file_name: string | null;
  media_library_id: string | null;
}

export async function getSyncedWithLocal(): Promise<SyncedWithLocal[]> {
  const db = await getDb();
  return db.getAllAsync<SyncedWithLocal>(
    "SELECT id, local_uri, byte_size, file_name, media_library_id FROM media WHERE state = 'synced' AND local_uri IS NOT NULL"
  );
}

export async function clearLocalUri(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET local_uri = NULL, updated_at = ? WHERE id = ?", [
    Date.now(),
    id,
  ]);
}

export async function setLocalUri(id: number, uri: string, libraryId?: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE media SET local_uri = ?, media_library_id = COALESCE(?, media_library_id), updated_at = ? WHERE id = ?",
    [uri, libraryId ?? null, Date.now(), id]
  );
}

export interface RestorableRow {
  id: number;
  byte_size: number;
  file_name: string | null;
  remote_chat_id: string;
  remote_message_id: string;
}

export async function getSyncedWithoutLocal(): Promise<RestorableRow[]> {
  const db = await getDb();
  return db.getAllAsync<RestorableRow>(
    "SELECT id, byte_size, file_name, remote_chat_id, remote_message_id FROM media WHERE state = 'synced' AND local_uri IS NULL AND remote_message_id IS NOT NULL AND remote_message_id != '0' ORDER BY byte_size ASC"
  );
}

export async function replaceRemoteMessageId(oldId: string, newId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE media SET remote_message_id = ?, updated_at = ? WHERE remote_message_id = ?",
    [newId, Date.now(), oldId]
  );
}

export async function updateRemoteMessageIdById(id: number, newId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET remote_message_id = ?, updated_at = ? WHERE id = ?", [
    newId,
    Date.now(),
    id,
  ]);
}

export async function listTrashed(limit = 500): Promise<MediaRow[]> {
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    "SELECT * FROM media WHERE visibility = 'trashed' ORDER BY trashed_at DESC LIMIT ?",
    [limit]
  );
}

export async function findExpiredTrash(maxAgeDays: number): Promise<MediaRow[]> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    "SELECT * FROM media WHERE visibility = 'trashed' AND trashed_at IS NOT NULL AND trashed_at < ?",
    [cutoff]
  );
}

export async function deleteMediaRow(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM upload_queue WHERE media_id = ?; DELETE FROM album_media WHERE media_id = ?; DELETE FROM media WHERE id = ?;",
    [id, id, id]
  );
}

export interface GeoItem {
  id: number;
  thumb_uri: string;
  latitude: number;
  longitude: number;
}

export async function listGeoTagged(limit = 800): Promise<GeoItem[]> {
  const db = await getDb();
  return db.getAllAsync<GeoItem>(
    "SELECT id, thumb_uri, latitude, longitude FROM media WHERE visibility != 'trashed' AND latitude IS NOT NULL AND longitude IS NOT NULL LIMIT ?",
    [limit]
  );
}

export async function searchMediaRaw(query: string, limit = 300): Promise<MediaRow[]> {
  const db = await getDb();
  const like = `%${query.replace(/[%_]/g, "")}%`;
  return db.getAllAsync<MediaRow>(
    `SELECT * FROM media
     WHERE visibility = 'visible'
       AND (file_name LIKE ? OR tags LIKE ?)
     ORDER BY taken_at DESC LIMIT ?`,
    [like, like, limit]
  );
}

export async function searchByDateRange(fromMs: number, toMs: number): Promise<MediaRow[]> {
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    `SELECT * FROM media
     WHERE visibility = 'visible' AND taken_at >= ? AND taken_at < ?
     ORDER BY taken_at DESC`,
    [fromMs, toMs]
  );
}
