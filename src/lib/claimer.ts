import TdLib from "react-native-tdlib";
import { Directory, File, Paths } from "expo-file-system";
import {
  findClaimedMessage,
  findMediaIdByFingerprint,
  getSharedAlbum,
  insertMedia,
  linkMediaToAlbum,
  listAlbumMediaWithoutTopic,
  replaceForumTopics,
  setAlbumClaimCursor,
  setAlbumMediaTopic,
  setMediaRemote,
  SharedAlbumRow,
} from "../db/queries";
import { quickFingerprint } from "./dedupe";
import { fetchThreadMessages, isForumChat, listForumTopics, ForumTopicRef } from "./forum";
import { makeThumbnail } from "./scanner";

// S9 Phase 1 claim engine (docs/S9-DESIGN.md): pulls media messages from a
// shared album's Telegram group into the library. One group = one album.
// Family members' media is linked to the album (album-only by default); the
// owner's own messages are inserted WITHOUT an album link so they stay in the
// main timeline permanently.

type TdAny = Record<string, any>;

export interface ClaimProgress {
  claimed: number;
  duplicates: number;
  failed: number;
  lastError?: string;
  done: boolean;
}

export interface ClaimBatch {
  claimed: number;
  duplicates: number;
  failed: number;
  newestMessageId: string | null;
}

function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

// TDLib wire sends seconds; some gson paths deliver ms. Values > 1e11 are ms.
function toMs(secondsOrMs: unknown): number {
  const n = Number(secondsOrMs);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? Math.round(n) : Math.round(n * 1000);
}

function messageDateMs(message: TdAny): number {
  const ms = toMs(firstDefined(message?.date, message?.editDate, message?.edit_date));
  return ms > 86400000 ? ms : Date.now();
}

interface RemoteMediaInfo {
  remoteId: string;
  byteSize: number;
  fileName: string | null;
  isVideo: boolean;
  width: number | null;
  height: number | null;
}

// Exported for the F1 migration engine (src/lib/rehydrate.ts) — same
// extraction, do not change behavior.
export function extractMedia(message: TdAny): RemoteMediaInfo | null {
  const content: TdAny = message?.content ?? {};
  const type: string = content["@type"] ?? "";

  if (type === "messageDocument" || content.document) {
    const doc = content.document;
    const file = doc?.document;
    const remoteId = file?.remote?.id;
    if (typeof remoteId !== "string" || !remoteId) return null;
    return {
      remoteId,
      byteSize: Number(firstDefined(file.expectedSize, file.expected_size, file.size, 0)) || 0,
      fileName: String(firstDefined(doc.fileName, doc.file_name, "shared-file")) || null,
      isVideo: String(firstDefined(doc.mimeType, doc.mime_type, "")).startsWith("video/"),
      width: null,
      height: null,
    };
  }

  if (type === "messageAnimation" || content.animation) {
    const anim = content.animation;
    const file = anim?.animation;
    const remoteId = file?.remote?.id;
    if (typeof remoteId !== "string" || !remoteId) return null;
    return {
      remoteId,
      byteSize: Number(firstDefined(file.expectedSize, file.expected_size, file.size, 0)) || 0,
      fileName: String(firstDefined(anim.fileName, anim.file_name, "shared-video")) || null,
      isVideo: true,
      width: Number(firstDefined(anim.width, 0)) || null,
      height: Number(firstDefined(anim.height, 0)) || null,
    };
  }

  if (type === "messageVideo" || content.video) {
    const video = content.video;
    const file = video?.video;
    const remoteId = file?.remote?.id;
    if (typeof remoteId !== "string" || !remoteId) return null;
    return {
      remoteId,
      byteSize: Number(firstDefined(file.expectedSize, file.expected_size, file.size, 0)) || 0,
      fileName: String(firstDefined(video.fileName, video.file_name, "shared-video")) || null,
      isVideo: true,
      width: Number(firstDefined(video.width, 0)) || null,
      height: Number(firstDefined(video.height, 0)) || null,
    };
  }

  if (type === "messagePhoto" || Array.isArray(content.photo?.sizes)) {
    const sizes: TdAny[] = content.photo?.sizes ?? [];
    let best: TdAny | null = null;
    for (const size of sizes) {
      const remoteId = size?.photo?.remote?.id;
      if (typeof remoteId !== "string" || !remoteId) continue;
      if (!best || (size.width ?? 0) * (size.height ?? 0) > (best.width ?? 0) * (best.height ?? 0)) {
        best = size;
      }
    }
    if (!best) return null;
    return {
      remoteId: best.photo.remote.id,
      byteSize:
        Number(firstDefined(best.photo.expectedSize, best.photo.expected_size, best.photo.size, 0)) ||
        0,
      fileName: `photo-${message.id}.jpg`,
      isVideo: false,
      width: Number(best.width) || null,
      height: Number(best.height) || null,
    };
  }

  return null;
}

function mimeFor(fileName: string, isVideo: boolean): string {
  if (isVideo) return "video/mp4";
  const name = fileName.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

let sharedDirReady = false;
function sharedDir(): Directory {
  const dir = new Directory(Paths.document, "shared");
  if (!sharedDirReady) {
    if (!dir.exists) {
      try {
        dir.create();
      } catch {}
    }
    sharedDirReady = true;
  }
  return dir;
}

async function currentUserId(): Promise<string | null> {
  try {
    const raw = await TdLib.getProfile();
    let parsed: TdAny | null = null;
    try {
      parsed = JSON.parse(raw);
      if (parsed && typeof parsed.raw === "string") parsed = JSON.parse(parsed.raw as string);
    } catch {}
    const id = parsed?.id;
    return id === undefined || id === null ? null : String(id);
  } catch {
    return null;
  }
}

async function claimOne(
  albumId: number,
  chatId: string,
  message: TdAny,
  ownUserId: string | null,
  threadId: string | null
): Promise<"claimed" | "duplicate" | "failed"> {
  const messageId = String(message.id);
  const info = extractMedia(message);
  if (!info) return "failed";

  // Already claimed into this album?
  if (await findClaimedMessage(albumId, messageId)) return "duplicate";

  // Download the original (TDLib caches it), then copy into app storage so the
  // device gallery stays untouched.
  const download = await TdLib.downloadFileByRemoteId(info.remoteId);
  const downloaded = JSON.parse(download.raw) as TdAny;
  const localPath: string | undefined = firstDefined(
    downloaded?.local?.path,
    downloaded?.local?.Path
  ) as string | undefined;
  if (!localPath) return "failed";

  const fileName = info.fileName ?? `shared-${messageId}`;
  const dest = new File(sharedDir(), `${messageId}-${fileName}`);
  if (!dest.exists) {
    // TDLib's local.path is a plain filesystem path; the expo-file-system
    // File API rejects non-absolute URIs ("URI is not absolute").
    const srcUri = localPath.startsWith("file://") ? localPath : `file://${localPath}`;
    await new File(srcUri).copy(dest);
  }
  const byteSize = new File(dest.uri).size ?? info.byteSize;

  const thumbUri = await makeThumbnail(dest.uri, info.isVideo);
  const fingerprint = quickFingerprint({
    byteSize,
    modifiedAtMs: messageDateMs(message),
    fileName,
  });

  const isOwn = ownUserId !== null && String(firstDefined(message.senderId, message.sender_id, "")) === ownUserId;
  const takenAt = messageDateMs(message);

  let mediaId: number | null = null;
  let outcome: "claimed" | "duplicate";
  const inserted = await insertMedia({
    local_uri: dest.uri,
    thumb_uri: thumbUri,
    file_name: fileName,
    mime_type: mimeFor(fileName, info.isVideo),
    byte_size: byteSize,
    width: info.width,
    height: info.height,
    taken_at: takenAt,
    fingerprint,
    state: "local",
    tags: isOwn ? "shared own" : "shared",
  });

  if (inserted !== null) {
    mediaId = inserted;
    outcome = "claimed";
    // New row: the group message IS its cloud copy — record it so restore works.
    await setMediaRemote(mediaId, chatId, messageId, "synced");
  } else {
    // Same file already exists (e.g. a forward of something we have). Link the
    // existing row into the album instead of storing a second copy — but never
    // overwrite an existing Saved Messages remote link, and never link the
    // owner's own photos (they belong in the main timeline).
    mediaId = await findMediaIdByFingerprint(fingerprint);
    if (mediaId === null) return "failed";
    outcome = "duplicate";
  }

  if (!isOwn) {
    await linkMediaToAlbum(
      albumId,
      mediaId,
      String(firstDefined(message.senderId, message.sender_id, "")) || null,
      messageId,
      threadId
    );
  }
  return outcome;
}

// The original (non-forum) claim path (D5): groups without topics behave
// exactly as before this feature — getChatHistory → oldest-first → max-id
// cursor. The forum path below is fully additive behind isForumChat.
async function claimAlbumFlat(
  album: SharedAlbumRow,
  progress: ClaimProgress,
  report: () => void,
  cancelRef?: { cancelled: boolean }
): Promise<void> {
  const cursor = album.last_claimed_message_id
    ? Number(album.last_claimed_message_id)
    : 0;

  // Fresh chats can return empty history for a few seconds — retry briefly.
  let history: Array<{ raw_json: string }> = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      history = await TdLib.getChatHistory(Number(album.chat_id), 0, 100, 0);
      if (history.length > 0) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const messages: TdAny[] = [];
  let newestSeenId = cursor;
  for (const entry of history) {
    try {
      const message = JSON.parse(entry.raw_json);
      if (!message || typeof message.id !== "number") continue;
      if (message.id <= cursor) continue; // older than the claim cursor
      if (message.id > newestSeenId) newestSeenId = message.id;
      if (extractMedia(message)) messages.push(message);
    } catch {}
  }
  // Oldest first so the library order matches the chat order.
  messages.sort((a, b) => a.id - b.id);

  const ownUserId = await currentUserId();
  const batch: ClaimBatch = { claimed: 0, duplicates: 0, failed: 0, newestMessageId: null };
  for (const message of messages) {
    if (cancelRef?.cancelled) break;
    try {
      const outcome = await claimOne(album.id, album.chat_id, message, ownUserId, null);
      if (outcome === "claimed") progress.claimed++;
      else if (outcome === "duplicate") progress.duplicates++;
      else {
        progress.failed++;
        if (!progress.lastError) progress.lastError = "Unsupported or unreadable media in group";
      }
      batch.newestMessageId = String(Math.max(Number(batch.newestMessageId ?? 0), message.id));
    } catch (err) {
      progress.failed++;
      if (!progress.lastError && err instanceof Error) progress.lastError = err.message;
    }
    report();
  }

  if (batch.newestMessageId && Number(batch.newestMessageId) > cursor && !cancelRef?.cancelled) {
    await setAlbumClaimCursor(album.id, batch.newestMessageId);
  }
}

// Pulls new media from the group into the album; returns a progress snapshot.
// Forum-enabled groups are claimed per topic (D3/D4); groups without topics
// take claimAlbumFlat above, byte-identical to before this feature.
export async function claimAlbumMedia(
  albumId: number,
  onProgress?: (p: ClaimProgress) => void,
  cancelRef?: { cancelled: boolean }
): Promise<ClaimProgress> {
  const album = await getSharedAlbum(albumId);
  if (!album) throw new Error("Shared album not found.");

  const progress: ClaimProgress = { claimed: 0, duplicates: 0, failed: 0, done: false };
  const report = () => onProgress?.({ ...progress });

  try {
    await TdLib.openChat(Number(album.chat_id));
  } catch {}

  const isForum = await isForumChat(album.chat_id);
  if (!isForum) {
    await claimAlbumFlat(album, progress, report, cancelRef);
    progress.done = true;
    report();
    return progress;
  }

  const topics = await listForumTopics(album.chat_id);
  if (topics === null || topics.length === 0) {
    // null = TDLib could not be read (error / no reply after retries) — a
    // transient failure, not an empty forum: claim flat rather than failing
    // the whole run, note it, and the next claim retries the topic split
    // (D2b mitigation). [] = a genuinely topic-less forum: flat is simply
    // correct, no note.
    if (topics === null) {
      progress.lastError = "Could not read topics; claimed without topic split";
    }
    await claimAlbumFlat(album, progress, report, cancelRef);
    progress.done = true;
    report();
    return progress;
  }

  await replaceForumTopics(albumId, topics);
  const cursor = album.last_claimed_message_id
    ? Number(album.last_claimed_message_id)
    : 0;
  const ownUserId = await currentUserId();

  // Snapshot phase (D3): metadata-only history per topic BEFORE the slow
  // downloads run. Message ids are globally sequential inside one chat (topics
  // are reply-threads of one channel), so the single per-album cursor can
  // safely advance to the MINIMUM newest id across the read, non-empty topics
  // — a message posted into any topic mid-run always lands above that, so it
  // can never be skipped. (Max would let a mid-run message in a slower topic
  // fall below the cursor. The cursor only advances when EVERY topic was read
  // this run — see the cursor update below; empty topics read fine but have
  // no newest id.) newestId counts every message regardless of media type.
  const snapshots: Array<{
    topic: ForumTopicRef;
    pending: TdAny[];
    // READ = the fetch returned a non-null array (possibly empty). A failed
    // fetch is NOT read and blocks the cursor; an empty topic IS read.
    wasRead: boolean;
    // Newest message id, or null when the topic is empty (or never read).
    newestId: number | null;
  }> = [];
  for (const topic of topics) {
    if (cancelRef?.cancelled) break;
    const history = await fetchThreadMessages(album.chat_id, topic.threadId);
    // null = fetch failed: this topic was NOT read, which blocks the cursor
    // from advancing this run (see below). [] = genuinely empty topic: READ,
    // and it contributes nothing to the min — nothing in it can be skipped.
    const wasRead = history !== null;
    let newestId: number | null = null;
    const pending: TdAny[] = [];
    for (const message of history ?? []) {
      if (typeof message.id !== "number") continue;
      if (newestId === null || message.id > newestId) newestId = message.id;
      if (message.id > cursor && extractMedia(message)) pending.push(message);
    }
    // Oldest first per topic, as the flat path, so the library order matches.
    pending.sort((a, b) => a.id - b.id);
    snapshots.push({ topic, pending, wasRead, newestId });
  }

  // Claim phase: per topic, oldest-first, attributing each message to its
  // thread. findClaimedMessage duplicate guard and progress reporting unchanged.
  for (const snapshot of snapshots) {
    for (const message of snapshot.pending) {
      if (cancelRef?.cancelled) break;
      try {
        const outcome = await claimOne(
          album.id,
          album.chat_id,
          message,
          ownUserId,
          snapshot.topic.threadId
        );
        if (outcome === "claimed") progress.claimed++;
        else if (outcome === "duplicate") progress.duplicates++;
        else {
          progress.failed++;
          if (!progress.lastError) progress.lastError = "Unsupported or unreadable media in group";
        }
      } catch (err) {
        progress.failed++;
        if (!progress.lastError && err instanceof Error) progress.lastError = err.message;
      }
      report();
    }
  }

  if (!cancelRef?.cancelled) {
    // Invariant: the cursor advances only when every topic was read this run,
    // and never backward — otherwise a topic missed this run would be skipped
    // permanently (its new messages would land below the advanced cursor and
    // never be rescanned). A partial run keeps whatever it claimed above but
    // leaves the cursor untouched so missed topics are retried next claim. An
    // empty topic counts as read and contributes nothing to the min — it has
    // no messages to skip, and any future message in it lands above the cursor.
    const nonEmptyNewestIds = snapshots
      .filter((s) => s.wasRead && s.newestId !== null)
      .map((s) => s.newestId)
      .filter((id): id is number => id !== null);
    const readCount = snapshots.filter((s) => s.wasRead).length;
    const everyTopicRead = snapshots.length === topics.length && readCount === topics.length;
    if (everyTopicRead && nonEmptyNewestIds.length > 0) {
      const computed = Math.min(...nonEmptyNewestIds);
      // Missing/invalid stored cursor = no constraint (previous stays 0; real
      // message ids are always positive, so the computed min still wins).
      const existing = Number(album.last_claimed_message_id);
      const previous = Number.isFinite(existing) && existing > 0 ? existing : 0;
      if (computed > previous) {
        await setAlbumClaimCursor(albumId, String(computed));
      }
    } else if (!everyTopicRead && !progress.lastError) {
      const unread = topics.length - readCount;
      progress.lastError = `${unread} topic(s) unread this run; will retry next claim`;
    }
  }

  // Opportunistic backfill (Task 4b): pre-feature rows have no topic recorded.
  // Own-sender messages get no album_media row, so only family media is here.
  if (!cancelRef?.cancelled) {
    const untopicRows = await listAlbumMediaWithoutTopic(albumId);
    const chatIdNumber = Number(album.chat_id);
    for (const row of untopicRows) {
      if (cancelRef?.cancelled) break;
      const messageId = Number(row.message_id);
      if (!Number.isFinite(messageId)) continue;
      try {
        // getMessage returns a bare gson error object on 404 (never throws for
        // those) — parse and check @type before trusting the payload.
        const result = await TdLib.getMessage(chatIdNumber, messageId);
        const m = JSON.parse(result.raw) as TdAny;
        if (!m || m["@type"] === "error") continue;
        const threadId = firstDefined(
          m.messageThreadId,
          m.message_thread_id,
          m.replyTo?.messageReplyToMessage?.replyToMessageId,
          m.replyTo?.messageReplyToMessage?.reply_to_message_id
        );
        if (typeof threadId === "number" || typeof threadId === "string") {
          await setAlbumMediaTopic(albumId, row.message_id, String(threadId));
        }
      } catch {}
    }
  }

  progress.done = true;
  report();
  return progress;
}
