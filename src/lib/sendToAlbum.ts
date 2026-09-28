import { onUpdate } from "./tdlib";
import {
  dedupeUploadQueue,
  enqueueUpload,
  getMediaByIds,
  getSharedAlbum,
  linkMediaToAlbum,
} from "../db/queries";
import { refreshCounts, startWorker } from "./uploader";

// v0.20: send an existing photo into a linked shared-album Telegram group
// through the NORMAL queue — the FLOOD_WAIT ladder, budgets and inter-message
// gap govern the send like every other upload. Best-effort album link: when
// the send succeeds we try to record the group message into the album grid;
// if matching misses, the next "Claim new" treats the group post as a clean
// own-duplicate (fingerprint match) — degraded, never broken.

export interface SendToAlbumResult {
  ok: boolean;
  message: string;
}

export async function sendToAlbum(mediaId: number, albumId: number): Promise<SendToAlbumResult> {
  const rows = await getMediaByIds([mediaId]);
  const media = rows[0];
  if (!media?.local_uri) {
    return { ok: false, message: "This photo has no local copy to send." };
  }
  const album = await getSharedAlbum(albumId);
  if (!album?.chat_id) {
    return { ok: false, message: "This album has no linked Telegram group." };
  }

  await enqueueUpload(media.id, media.local_uri, media.byte_size, album.chat_id);
  await dedupeUploadQueue();
  void refreshCounts();
  startWorker();

  // Self-expiring one-shot listener for the album link (the message id only
  // exists after the send completes). One send → one link attempt per minute.
  const unsubscribe = onUpdate((update) => {
    if (update.type !== "updateMessageSendSucceeded") return;
    try {
      const message = update.payload.message as
        | { id?: number; chat_id?: number; content?: { caption?: { text?: string } } }
        | undefined;
      if (!message || typeof message.id === "undefined") return;
      if (Number(message.chat_id) !== Number(album.chat_id)) return;
      const caption = message.content?.caption?.text ?? "";
      if (!media.file_name || !caption.includes(media.file_name)) return;
      void linkMediaToAlbum(albumId, media.id, null, String(message.id), null);
      unsubscribe();
    } catch {}
  });
  setTimeout(() => unsubscribe(), 60_000);

  return { ok: true, message: `Sent to ${album.title}. It lands in the album grid after the upload.` };
}
