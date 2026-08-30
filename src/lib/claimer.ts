import TdLib from "react-native-tdlib";
import { Directory, File, Paths } from "expo-file-system";
import {
  findClaimedMessage,
  findMediaIdByFingerprint,
  getSharedAlbum,
  insertMedia,
  linkMediaToAlbum,
  setAlbumClaimCursor,
  setMediaRemote,
} from "../db/queries";
import { quickFingerprint } from "./dedupe";
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

function extractMedia(message: TdAny): RemoteMediaInfo | null {
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
  ownUserId: string | null
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
    await new File(localPath).copy(dest);
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
      messageId
    );
  }
  return outcome;
}

// Pulls new media from the group into the album. Processes oldest-first so the
// cursor only ever moves forward; returns a progress snapshot.
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

  // Fresh chats can return empty history for a few seconds — retry briefly.
  let history: Array<{ raw_json: string }> = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      history = await TdLib.getChatHistory(Number(album.chat_id), 0, 100, 0);
      if (history.length > 0) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const cursor = album.last_claimed_message_id
    ? Number(album.last_claimed_message_id)
    : 0;
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
      const outcome = await claimOne(album.id, album.chat_id, message, ownUserId);
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
    await setAlbumClaimCursor(albumId, batch.newestMessageId);
  }

  progress.done = true;
  report();
  return progress;
}
