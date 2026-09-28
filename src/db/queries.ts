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
  is_favorite: number;
  // F3 journaling (schema v9): optional so pre-migration consumers compile.
  note_text?: string | null;
  note_synced?: number | null;
  // v0.19 editor (schema v10): set on edited copies, points at the ROOT original.
  edited_from?: number | null;
}

export interface NewMediaInput {
  // Null for cloud-only rows built by the F1 migration (src/lib/rehydrate.ts):
  // the Telegram message exists but nothing is on this device yet.
  local_uri: string | null;
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
  // v0.19 editor: set on edited copies → the ROOT original's id.
  edited_from?: number | null;
}

export interface QueueRow {
  id: number;
  media_id: number;
  local_uri: string;
  byte_size: number;
  attempts: number;
  status: "pending" | "active" | "paused" | "done" | "failed";
  error: string | null;
  chat_id: string | null;
  // v0.19 (schema v10): when set, the worker sends this upload as a REPLY to
  // that Telegram message instead of the preview-first dance.
  reply_to_message_id: string | null;
}

export async function insertMedia(input: NewMediaInput): Promise<number | null> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO media
      (local_uri, thumb_uri, file_name, mime_type, byte_size, width, height, duration_ms,
       taken_at, fingerprint, state, visibility, tags, latitude, longitude, media_library_id, edited_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?, ?, ?, ?, ?, ?)`,
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
      input.edited_from ?? null,
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

export async function updateOcrText(id: number, text: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET ocr_text = ?, updated_at = ? WHERE id = ?", [
    text,
    Date.now(),
    id,
  ]);
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

// --- S9 shared albums -------------------------------------------------------
// Claimed family media lives in the existing albums/album_media tables. Rules
// (docs/S9-DESIGN.md): album-only by default, per-album timeline toggle.

// Excludes every album-linked row (Memories, search, map, stats, Free-Up-Space).
const EXCLUDE_ALL_SHARED = `AND NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id = media.id)`;

// Excludes album-linked rows unless their album opted into the timeline.
const EXCLUDE_UNLESS_TIMELINED = `AND NOT EXISTS (
  SELECT 1 FROM album_media am JOIN albums a ON a.id = am.album_id
  WHERE am.media_id = media.id AND a.show_in_timeline = 0
)`;

export interface SharedAlbumRow {
  id: number;
  title: string;
  chat_id: string;
  last_claimed_message_id: string | null;
  show_in_timeline: number;
  count: number;
  cover: string | null;
}

export async function createSharedAlbum(title: string, chatId: string): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.runAsync(
    "INSERT INTO albums (title, chat_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [title, chatId, now, now]
  );
  return result.lastInsertRowId;
}

export async function listSharedAlbums(): Promise<SharedAlbumRow[]> {
  const db = await getDb();
  return db.getAllAsync<SharedAlbumRow>(
    `SELECT a.id, a.title, a.chat_id, a.last_claimed_message_id, a.show_in_timeline,
       (SELECT COUNT(*) FROM album_media am WHERE am.album_id = a.id) AS count,
       (SELECT m.thumb_uri FROM album_media am JOIN media m ON m.id = am.media_id
         WHERE am.album_id = a.id ORDER BY m.taken_at DESC LIMIT 1) AS cover
     FROM albums a
     WHERE a.chat_id IS NOT NULL
     ORDER BY a.created_at DESC`
  );
}

export async function getSharedAlbum(id: number): Promise<SharedAlbumRow | null> {
  const db = await getDb();
  return (
    (await db.getFirstAsync<SharedAlbumRow>(
      `SELECT a.id, a.title, a.chat_id, a.last_claimed_message_id, a.show_in_timeline,
         (SELECT COUNT(*) FROM album_media am WHERE am.album_id = a.id) AS count,
         (SELECT m.thumb_uri FROM album_media am JOIN media m ON m.id = am.media_id
           WHERE am.album_id = a.id ORDER BY m.taken_at DESC LIMIT 1) AS cover
       FROM albums a WHERE a.id = ?`,
      [id]
    )) ?? null
  );
}

export async function setAlbumShowInTimeline(id: number, show: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE albums SET show_in_timeline = ?, updated_at = ? WHERE id = ?", [
    show ? 1 : 0,
    Date.now(),
    id,
  ]);
}

export async function setAlbumClaimCursor(id: number, messageId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE albums SET last_claimed_message_id = ?, updated_at = ? WHERE id = ?", [
    messageId,
    Date.now(),
    id,
  ]);
}

export async function findClaimedMessage(
  albumId: number,
  messageId: string
): Promise<{ media_id: number } | null> {
  const db = await getDb();
  return (
    (await db.getFirstAsync<{ media_id: number }>(
      "SELECT media_id FROM album_media WHERE album_id = ? AND message_id = ?",
      [albumId, messageId]
    )) ?? null
  );
}

export async function linkMediaToAlbum(
  albumId: number,
  mediaId: number,
  senderId: string | null,
  messageId: string,
  forumTopicId: string | null = null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO album_media (album_id, media_id, sender_id, message_id, forum_topic_id, added_at) VALUES (?, ?, ?, ?, ?, ?)",
    [albumId, mediaId, senderId, messageId, forumTopicId, Date.now()]
  );
}

// --- S9 fast-follow: forum topic sub-albums (docs/PLAN-S9-TOPICS.md) ---------

// Rebuilds an album's cached topic list from the live TDLib list (D7): DELETE +
// INSERT in one transaction, so renames propagate after the next claim run.
export async function replaceForumTopics(
  albumId: number,
  topics: Array<{ threadId: string; title: string; isHidden: boolean }>
): Promise<void> {
  const db = await getDb();
  const base = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM forum_topics WHERE album_id = ?", [albumId]);
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      // updated_at carries the insertion index so listAlbumTopics' ASC tiebreak
      // keeps the live Telegram order (General is ordered first by the query).
      await db.runAsync(
        "INSERT OR REPLACE INTO forum_topics (album_id, thread_id, title, is_hidden, updated_at) VALUES (?, ?, ?, ?, ?)",
        [albumId, topic.threadId, topic.title, topic.isHidden ? 1 : 0, base + i]
      );
    }
  });
}

export interface AlbumTopicRow {
  thread_id: string;
  title: string;
  is_hidden: number;
  count: number;
}

export async function listAlbumTopics(albumId: number): Promise<AlbumTopicRow[]> {
  const db = await getDb();
  return db.getAllAsync<AlbumTopicRow>(
    `SELECT ft.thread_id, ft.title, ft.is_hidden,
       (SELECT COUNT(*) FROM album_media am
         WHERE am.album_id = ft.album_id AND am.forum_topic_id = ft.thread_id) AS count
     FROM forum_topics ft WHERE ft.album_id = ?
     ORDER BY (ft.thread_id = '1') DESC, ft.updated_at ASC`,
    [albumId]
  );
}

export async function listAlbumMedia(
  albumId: number,
  topicId?: string | null,
  limit = 800
): Promise<MediaRow[]> {
  const db = await getDb();
  const topicFilter = topicId ? "AND am.forum_topic_id = ?" : "";
  return db.getAllAsync<MediaRow>(
    `SELECT m.* FROM media m
     JOIN album_media am ON am.media_id = m.id
     WHERE am.album_id = ?
     ${topicFilter}
     ORDER BY m.taken_at DESC, m.id DESC LIMIT ?`,
    topicId ? [albumId, topicId, limit] : [albumId, limit]
  );
}

// Pre-topic rows (forum_topic_id IS NULL) for the claimer's opportunistic
// backfill; message_id is the TDLib lookup key.
export async function listAlbumMediaWithoutTopic(
  albumId: number,
  limit = 200
): Promise<Array<{ message_id: string }>> {
  const db = await getDb();
  return db.getAllAsync<{ message_id: string }>(
    `SELECT message_id FROM album_media
     WHERE album_id = ? AND message_id IS NOT NULL AND forum_topic_id IS NULL
     ORDER BY CAST(message_id AS INTEGER) ASC LIMIT ?`,
    [albumId, limit]
  );
}

export async function setAlbumMediaTopic(
  albumId: number,
  messageId: string,
  threadId: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE album_media SET forum_topic_id = ? WHERE album_id = ? AND message_id = ? AND forum_topic_id IS NULL",
    [threadId, albumId, messageId]
  );
}

export async function deleteSharedAlbum(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM albums WHERE id = ?", [id]);
}

// F1 migration idempotency: has this Saved Messages message already been
// indexed by a previous inventory run? chat_id = the own user id (Saved
// Messages); matching both columns keeps album-claimed rows (group chat ids)
// out of the lookup.
export async function findMediaIdByRemoteMessage(
  chatId: string,
  messageId: string
): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM media WHERE remote_chat_id = ? AND remote_message_id = ? LIMIT 1",
    [chatId, messageId]
  );
  return row?.id ?? null;
}

// F1 migration: recognizes a device asset the restorer already saved (the
// restorer's setLocalUri stores the media-library id on the cloud-only row).
// The scanner checks this BEFORE its fingerprint gate: a restored file's
// MediaStore fingerprint (mtime·1000 + real filename) can never match the
// Telegram-side fingerprint recorded at migration time, so without this
// lookup every restored item would come back from a scan as a second row.
export async function findMediaIdByMediaLibraryId(
  libraryId: string
): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM media WHERE media_library_id = ? LIMIT 1",
    [libraryId]
  );
  return row?.id ?? null;
}

// F1 migration UI guard: how many rows this phone's library already has, so
// the Migrate screen can warn before rebuilding on a non-empty device.
export async function countMediaRows(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM media"
  );
  return row?.n ?? 0;
}

// F1 self-heal (review fix): a crash between insertMedia (state 'synced') and
// setMediaRemote leaves a permanent zombie — synced, no remote ids, no local
// file. Restore can never serve it (no remote copy) and every re-run skips it
// (its fingerprint already exists). Such rows can carry no album_media link
// (the claimer always inserts rows with a local file) and no upload_queue row
// (enqueue requires a local file), so a plain DELETE is complete.
export async function repairSyncedRowsWithoutRemote(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM media WHERE state = 'synced'
       AND (remote_message_id IS NULL OR remote_message_id = '0')
       AND local_uri IS NULL`,
    []
  );
}

export async function findMediaIdByFingerprint(fingerprint: string): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM media WHERE fingerprint = ? LIMIT 1",
    [fingerprint]
  );
  return row?.id ?? null;
}

// --- Delight features --------------------------------------------------------

// "Surprise me": one random photo from the owner's own library.
export async function getRandomMedia(): Promise<MediaRow | null> {
  const db = await getDb();
  return (
    (await db.getFirstAsync<MediaRow>(
      `SELECT * FROM media WHERE visibility = 'visible' AND edited_from IS NULL
       ${EXCLUDE_ALL_SHARED}
       ORDER BY RANDOM() LIMIT 1`
    )) ?? null
  );
}

export interface AlbumActivityItem {
  albumId: number;
  albumTitle: string;
  senderId: string | null;
  thumbUri: string;
  mediaId: number;
  addedAt: number;
}

// Shared-album activity feed: latest claimed photos across all albums.
export async function listRecentAlbumActivity(limit = 20): Promise<AlbumActivityItem[]> {
  const db = await getDb();
  return db.getAllAsync<AlbumActivityItem>(
    `SELECT am.album_id AS albumId, a.title AS albumTitle, am.sender_id AS senderId,
            m.thumb_uri AS thumbUri, m.id AS mediaId, am.added_at AS addedAt
     FROM album_media am
     JOIN albums a ON a.id = am.album_id
     JOIN media m ON m.id = am.media_id
     ORDER BY am.added_at DESC
     LIMIT ?`,
    [limit]
  );
}

// --- Idea 7: Safety check ----------------------------------------------------
// "If I drop my phone in a river tomorrow, what do I lose?" — counts + the
// attention list for the owner's OWN media (family claims are always both-safe
// by design and never locally deleted).
export interface SafetyReport {
  total: number;
  safeCount: number;
  cloudOnlyCount: number;
  pendingCount: number;
  failedCount: number;
  bytesWaiting: number;
  attention: Array<{
    id: number;
    file_name: string | null;
    state: MediaState;
    byte_size: number;
    thumb_uri: string;
  }>;
}

export async function getSafetyReport(): Promise<SafetyReport> {
  const db = await getDb();
  const filter = `visibility != 'trashed' AND edited_from IS NULL ${EXCLUDE_ALL_SHARED}`;
  const counts = await db.getFirstAsync<{
    total: number;
    safe: number;
    cloud_only: number;
    pending: number;
    failed: number;
    waiting_bytes: number;
  }>(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN state = 'synced' AND local_uri IS NOT NULL THEN 1 ELSE 0 END), 0) AS safe,
      COALESCE(SUM(CASE WHEN state = 'synced' AND local_uri IS NULL THEN 1 ELSE 0 END), 0) AS cloud_only,
      COALESCE(SUM(CASE WHEN state IN ('local','queued','uploading') THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN state IN ('local','queued','uploading','failed') THEN byte_size ELSE 0 END), 0) AS waiting_bytes
    FROM media
    WHERE ${filter}
  `);
  const attention = await db.getAllAsync<SafetyReport["attention"][number]>(
    `SELECT id, file_name, state, byte_size, thumb_uri FROM media
     WHERE ${filter} AND state IN ('local','queued','uploading','failed')
     ORDER BY CASE state WHEN 'failed' THEN 0 WHEN 'uploading' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,
              byte_size DESC
     LIMIT 100`,
    []
  );
  return {
    total: counts?.total ?? 0,
    safeCount: counts?.safe ?? 0,
    cloudOnlyCount: counts?.cloud_only ?? 0,
    pendingCount: counts?.pending ?? 0,
    failedCount: counts?.failed ?? 0,
    bytesWaiting: counts?.waiting_bytes ?? 0,
    attention,
  };
}

export async function pageVisibleMedia(
  beforeTakenAt: number | null,
  limit = 120,
  includeTimelinedShared = false
): Promise<MediaRow[]> {
  const db = await getDb();
  const sharedFilter = includeTimelinedShared ? EXCLUDE_UNLESS_TIMELINED : EXCLUDE_ALL_SHARED;
  if (beforeTakenAt === null) {
    return db.getAllAsync<MediaRow>(
      `SELECT * FROM media WHERE visibility = 'visible' AND edited_from IS NULL ${sharedFilter}
       ORDER BY taken_at DESC, id DESC LIMIT ?`,
      [limit]
    );
  }
  return db.getAllAsync<MediaRow>(
    `SELECT * FROM media WHERE visibility = 'visible' AND edited_from IS NULL ${sharedFilter}
     AND (taken_at < ? OR (taken_at = ?)) ORDER BY taken_at DESC, id DESC LIMIT ?`,
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

export async function enqueueUpload(
  mediaId: number,
  localUri: string,
  byteSize: number,
  chatId: string | null = null
): Promise<void> {
  const db = await getDb();
  // chatId NULL = Saved Messages (the default); shared-album uploads set the group.
  await db.runAsync(
    "INSERT INTO upload_queue (media_id, local_uri, byte_size, chat_id, status, enqueued_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    [mediaId, localUri, byteSize, chatId, Date.now()]
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

// Reads one queue row's status (null when the row is gone). Used by the upload
// safety ladder's parking logic so a late updateMessageSendFailed can never
// re-queue a row that already finished ("done").
export async function getQueueStatus(queueId: number): Promise<QueueRow["status"] | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ status: QueueRow["status"] }>(
    "SELECT status FROM upload_queue WHERE id = ?",
    [queueId]
  );
  return row?.status ?? null;
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

// Removes surplus pending rows for the same media AND the same target chat
// (the Back-up pill can be pressed repeatedly). Grouping includes chat_id so a
// Saved-Messages row and a send-to-album row for one photo coexist (v0.20).
// Keeps the oldest pending row per group; never touches active/done.
export async function dedupeUploadQueue(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM upload_queue
     WHERE status = 'pending'
       AND (media_id, COALESCE(chat_id, ''))
           IN (
             SELECT media_id, COALESCE(chat_id, '') FROM upload_queue
             WHERE status IN ('pending','active')
             GROUP BY media_id, COALESCE(chat_id, '') HAVING COUNT(*) > 1
           )
       AND id NOT IN (
         SELECT MIN(id) FROM upload_queue WHERE status = 'pending'
         GROUP BY media_id, COALESCE(chat_id, '')
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
  // Family media claimed into shared albums is never eligible for Free-Up-Space
  // (docs/S9-DESIGN.md rule 3) — only the owner's own media is.
  return db.getAllAsync<SyncedWithLocal>(
    `SELECT id, local_uri, byte_size, file_name, media_library_id FROM media
     WHERE state = 'synced' AND local_uri IS NOT NULL ${EXCLUDE_ALL_SHARED}`
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
  // Restore-to-device is for the owner's own media; claimed family media is
  // never locally deleted in the first place (rule 3).
  return db.getAllAsync<RestorableRow>(
    `SELECT id, byte_size, file_name, remote_chat_id, remote_message_id FROM media
     WHERE state = 'synced' AND local_uri IS NULL AND remote_message_id IS NOT NULL AND remote_message_id != '0'
     ${EXCLUDE_ALL_SHARED}
     ORDER BY byte_size ASC`
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

export async function listArchived(limit = 500): Promise<MediaRow[]> {
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    "SELECT * FROM media WHERE visibility = 'archived' ORDER BY taken_at DESC LIMIT ?",
    [limit]
  );
}

export async function listHidden(limit = 500): Promise<MediaRow[]> {
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    "SELECT * FROM media WHERE visibility = 'hidden' ORDER BY taken_at DESC LIMIT ?",
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
    `SELECT id, thumb_uri, latitude, longitude FROM media
     WHERE visibility != 'trashed' AND latitude IS NOT NULL AND longitude IS NOT NULL
       AND edited_from IS NULL
     ${EXCLUDE_ALL_SHARED}
     LIMIT ?`,
    [limit]
  );
}

export async function searchMediaRaw(query: string, limit = 300): Promise<MediaRow[]> {
  const db = await getDb();
  const like = `%${query.replace(/[%_]/g, "")}%`;
  return db.getAllAsync<MediaRow>(
    `SELECT * FROM media
     WHERE visibility = 'visible'
       AND (file_name LIKE ? OR tags LIKE ? OR ocr_text LIKE ?)
       AND edited_from IS NULL
     ${EXCLUDE_ALL_SHARED}
     ORDER BY taken_at DESC LIMIT ?`,
    [like, like, like, limit]
  );
}

export async function searchByDateRange(fromMs: number, toMs: number): Promise<MediaRow[]> {
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    `SELECT * FROM media
     WHERE visibility = 'visible' AND taken_at >= ? AND taken_at < ?
       AND edited_from IS NULL
     ${EXCLUDE_ALL_SHARED}
     ORDER BY taken_at DESC`,
    [fromMs, toMs]
  );
}

// --- F2 Junk Sweeper ---------------------------------------------------------

export type JunkCategory = "blurry" | "pocket" | "near_duplicate" | "stale_screenshot";
export type JunkFindingStatus = "pending" | "kept" | "deleted";

export interface NewJunkFindingInput {
  media_id: number;
  category: JunkCategory;
  score: number | null;
  detail: string | null;
  group_key: string | null;
}

export interface JunkFindingWithMedia {
  id: number;
  media_id: number;
  category: JunkCategory;
  score: number | null;
  detail: string | null;
  group_key: string | null;
  created_at: number;
  // Joined media columns (the review screen renders these directly).
  local_uri: string | null;
  thumb_uri: string;
  file_name: string | null;
  mime_type: string;
  byte_size: number;
  taken_at: number;
  state: MediaState;
  remote_chat_id: string | null;
  remote_message_id: string | null;
  media_library_id: string | null;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    [key]
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [key, value]);
}

// Idempotent write: a fresh suggestion replaces an old PENDING one for the same
// media+category, but a KEPT or DELETED verdict is final and is never
// overwritten — that is what makes "keep" permanent across sweeps.
export async function upsertFindings(rows: NewJunkFindingInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await getDb();
  const now = Date.now();
  let written = 0;
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      const settled = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM junk_findings WHERE media_id = ? AND category = ? AND status IN ('kept','deleted') LIMIT 1",
        [row.media_id, row.category]
      );
      if (settled) continue;
      await db.runAsync(
        "DELETE FROM junk_findings WHERE media_id = ? AND category = ? AND status = 'pending'",
        [row.media_id, row.category]
      );
      await db.runAsync(
        "INSERT INTO junk_findings (media_id, category, score, detail, group_key, created_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
        [row.media_id, row.category, row.score, row.detail, row.group_key, now]
      );
      written++;
    }
  });
  return written;
}

export async function listFindingsByStatus(status: JunkFindingStatus): Promise<JunkFindingWithMedia[]> {
  const db = await getDb();
  return db.getAllAsync<JunkFindingWithMedia>(
    `SELECT jf.id, jf.media_id, jf.category, jf.score, jf.detail, jf.group_key, jf.created_at,
            m.local_uri, m.thumb_uri, m.file_name, m.mime_type, m.byte_size, m.taken_at,
            m.state, m.remote_chat_id, m.remote_message_id, m.media_library_id
     FROM junk_findings jf
     JOIN media m ON m.id = jf.media_id
     WHERE jf.status = ?
     ORDER BY jf.category, m.taken_at DESC`,
    [status]
  );
}

export async function setFindingStatus(id: number, status: JunkFindingStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE junk_findings SET status = ? WHERE id = ?", [status, id]);
}

// One media row can carry several pending findings (e.g. blurry AND part of a
// near-dup group). When the item itself is deleted/kept, move them all.
export async function setPendingFindingsForMedia(
  mediaId: number,
  status: JunkFindingStatus
): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE junk_findings SET status = ? WHERE media_id = ? AND status = 'pending'", [
    status,
    mediaId,
  ]);
}

export async function hasKeptFinding(mediaId: number): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM junk_findings WHERE media_id = ? AND status = 'kept' LIMIT 1",
    [mediaId]
  );
  return row !== undefined;
}

// Sweep candidates for one resumable chunk: the owner's own photos+videos
// (shared-album media is claimed family property and is never swept), with a
// thumbnail to analyze and without a settled (kept/deleted) verdict yet.
// Keyset paging on id (id > afterId, ordered by id) doubles as the resume
// cursor stored in meta ('junk_last_media_id').
export interface SweepCandidateRow {
  id: number;
  thumb_uri: string;
  mime_type: string;
  tags: string;
  byte_size: number;
  taken_at: number;
}

export async function pageSweepCandidates(afterId: number, limit: number): Promise<SweepCandidateRow[]> {
  const db = await getDb();
  return db.getAllAsync<SweepCandidateRow>(
    `SELECT id, thumb_uri, mime_type, tags, byte_size, taken_at FROM media
     WHERE visibility != 'trashed'
       AND thumb_uri != ''
       AND id > ?
       ${EXCLUDE_ALL_SHARED}
       AND NOT EXISTS (
         SELECT 1 FROM junk_findings jf
         WHERE jf.media_id = media.id AND jf.status IN ('kept','deleted')
       )
     ORDER BY id
     LIMIT ?`,
    [afterId, limit]
  );
}

// --- Favorites (v0.13) -------------------------------------------------------

// Per-device heart state (schema v8); never synced to Telegram.
export async function setMediaFavorite(id: number, fav: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET is_favorite = ?, updated_at = ? WHERE id = ?", [
    fav ? 1 : 0,
    Date.now(),
    id,
  ]);
}

// Favorites show the owner's own media only, matching the Memories rule.
export async function listFavorites(limit = 600): Promise<MediaRow[]> {
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    `SELECT * FROM media WHERE is_favorite = 1 AND visibility = 'visible' ${EXCLUDE_ALL_SHARED} ORDER BY taken_at DESC LIMIT ?`,
    [limit]
  );
}

// --- Timeline scrubber (v0.15) ------------------------------------------------

// Newest and oldest timestamps of the owner's visible timeline — the rail maps
// this range linearly from top (newest) to bottom (oldest).
export async function getTimelineRange(): Promise<{ min: number; max: number } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ min: number | null; max: number | null }>(
    `SELECT MIN(taken_at) AS min, MAX(taken_at) AS max FROM media WHERE visibility = 'visible' ${EXCLUDE_ALL_SHARED}`
  );
  if (!row || row.min === null || row.max === null || row.max <= row.min) return null;
  return { min: row.min, max: row.max };
}

// --- F3 photo journaling (docs/PLAN-F3-JOURNALING.md) --------------------------

// Local-first note write. text = null means "note removed" — the pending
// note_synced=0 row then drives a caption restore to file_name (A1).
export async function setMediaNote(id: number, text: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET note_text = ?, note_synced = 0, updated_at = ? WHERE id = ?", [
    text,
    Date.now(),
    id,
  ]);
}

export async function setNoteSynced(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE media SET note_synced = 1 WHERE id = ?", [id]);
}

export interface PendingNoteRow {
  id: number;
  remote_chat_id: string;
  remote_message_id: string;
  note_text: string | null;
  file_name: string | null;
  mime_type: string | null;
}

// Rows whose caption Telegram has not confirmed yet: synced, with remote ids,
// own library only (shared-album claims are never caption-edited by us).
export async function getPendingNoteSync(limit = 50): Promise<PendingNoteRow[]> {
  const db = await getDb();
  return db.getAllAsync<PendingNoteRow>(
    `SELECT id, remote_chat_id, remote_message_id, note_text, file_name, mime_type
     FROM media
     WHERE note_synced = 0 AND state = 'synced'
       AND remote_chat_id IS NOT NULL AND remote_message_id IS NOT NULL
       AND visibility != 'trashed'
       ${EXCLUDE_ALL_SHARED}
     LIMIT ?`,
    [limit]
  );
}

export async function isSharedAlbumMedia(id: number): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ one: number }>(
    "SELECT 1 AS one FROM album_media WHERE media_id = ? LIMIT 1",
    [id]
  );
  return !!row;
}

// --- v0.19 photo editor + versioned archive -----------------------------------

// Flat version list: every edited copy of a ROOT original (edit-of-edit rows
// always point at the root, per docs/PLAN-V0.13-EIGHT.md).
export async function listVersionsFor(originalId: number): Promise<MediaRow[]> {
  const db = await getDb();
  return db.getAllAsync<MediaRow>(
    "SELECT * FROM media WHERE edited_from = ? ORDER BY taken_at ASC, id ASC",
    [originalId]
  );
}

// Queue an upload whose Telegram message becomes a REPLY to an existing
// message (the original's) instead of the preview-first dance. Everything
// else — ladder, budgets, gap, confirmation — is the normal worker path.
export async function enqueueUploadWithReply(
  mediaId: number,
  localUri: string,
  byteSize: number,
  replyToMessageId: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO upload_queue (media_id, local_uri, byte_size, reply_to_message_id, status, enqueued_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    [mediaId, localUri, byteSize, replyToMessageId, Date.now()]
  );
  await setMediaState(mediaId, "queued");
}
