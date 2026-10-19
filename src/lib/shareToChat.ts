import { enqueueUpload, dedupeUploadQueue, MediaRow } from "../db/queries";
import { refreshCounts, startWorker } from "./uploader";

// v0.39 "Share album": send every locally-available copy in this album to a
// picked Telegram group through the NORMAL upload queue (chat_id target —
// the FLOOD_WAIT ladder, budgets and inter-message gap govern every send).
// The v0.20 remote-link guard keeps these sends from ever touching each
// media row's Saved Messages link, so sharing is side-effect-free.
export interface ShareToChatResult {
  queued: number;
  skipped: number;
}

export async function shareAlbumToChat(
  rows: MediaRow[],
  chatId: string
): Promise<ShareToChatResult> {
  let queued = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.local_uri || !row.byte_size) {
      skipped++;
      continue;
    }
    await enqueueUpload(row.id, row.local_uri, row.byte_size, chatId);
    queued++;
  }
  if (queued > 0) {
    await dedupeUploadQueue();
    void refreshCounts();
    startWorker();
  }
  return { queued, skipped };
}
