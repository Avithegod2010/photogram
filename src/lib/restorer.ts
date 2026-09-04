import TdLib from "react-native-tdlib";
import * as MediaLibrary from "expo-media-library/legacy";
import { getMediaByIds, setLocalUri, updateRemoteMessageIdById } from "../db/queries";
import { onUpdate } from "./tdlib";
import { isPreviewCaption } from "./uploadFormat";

export interface RestoreProgress {
  phase: "fetching" | "downloading" | "saving" | "done";
  receivedBytes: number;
  totalBytes: number;
}

type TdAny = Record<string, any>;

let historyLengthCache = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function hasRemoteCopy(row: { remote_message_id?: string | null } | undefined | null): boolean {
  return !!row && !!row.remote_message_id && row.remote_message_id !== "0";
}

// TDLib gson output uses JAVA field names (fileName, isDownloadingCompleted…)
// while some paths may carry the wire-format snake_case — check both everywhere.
function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

function extractRemoteFile(message: TdAny): { remoteId: string; expected: number } | null {
  const content: TdAny = message?.content ?? {};
  const byType = typeof content["@type"] === "string" ? content["@type"] : "";

  if (byType === "messageDocument" || content.document) {
    const doc: TdAny = content.document;
    const file: TdAny = doc?.document;
    const remoteId = file?.remote?.id;
    if (typeof remoteId === "string" && remoteId) {
      return {
        remoteId,
        expected: Number(firstDefined(file.expectedSize, file.expected_size, file.size, 0)),
      };
    }
  }

  if (byType === "messageAnimation" || content.animation) {
    const file: TdAny = content.animation?.animation;
    const remoteId = file?.remote?.id;
    if (typeof remoteId === "string" && remoteId) {
      return {
        remoteId,
        expected: Number(firstDefined(file.expectedSize, file.expected_size, file.size, 0)),
      };
    }
  }

  if (byType === "messagePhoto" || Array.isArray(content.photo?.sizes)) {
    const sizes: TdAny[] = content.photo?.sizes ?? [];
    let best: TdAny | null = null;
    for (const size of sizes) {
      const remoteId = size?.photo?.remote?.id;
      if (typeof remoteId !== "string" || !remoteId) continue;
      if (!best || (size.width ?? 0) * (size.height ?? 0) > (best.width ?? 0) * (best.height ?? 0)) {
        best = size;
      }
    }
    if (best) {
      return {
        remoteId: best.photo.remote.id,
        expected: Number(
          firstDefined(best.photo.expectedSize, best.photo.expected_size, best.photo.size, 0)
        ),
      };
    }
  }

  return null;
}

function messageContentFileName(message: TdAny): string {
  const content: TdAny = message?.content ?? {};
  return String(
    firstDefined(
      content.document?.fileName,
      content.document?.file_name,
      content.animation?.fileName,
      content.animation?.file_name,
      content.video?.fileName,
      content.video?.file_name,
      content.caption?.text,
      ""
    )
  );
}

async function fetchMessage(
  chatId: string,
  messageId: string,
  fileName: string | null
): Promise<{ message: TdAny; actualId: string } | null> {
  // getMessage() 404s and a freshly created chat may return empty history until
  // TDLib finishes loading it — so open the chat and retry the lookup briefly.
  try {
    await TdLib.openChat(Number(chatId));
  } catch {}
  for (let attempt = 0; attempt < 5; attempt++) {
    const history = await TdLib.getChatHistory(Number(chatId), 0, 50, 0);
    historyLengthCache = history.length;
    let byName: TdAny | null = null;
    for (const entry of history) {
      try {
        const message = JSON.parse(entry.raw_json);
        if (!message) continue;
        if (String(message.id) === String(messageId)) {
          return { message, actualId: String(message.id) };
        }
        // The uploader recorded PENDING message ids that TDLib later replaced with
        // final ones (low bits differ) — fall back to matching by filename.
        // Preview captions ("name.jpg · preview") are skipped: restoring a
        // preview would fetch the tiny preview file instead of the original.
        if (
          !byName &&
          fileName &&
          !isPreviewCaption(messageContentFileName(message)) &&
          messageContentFileName(message) === fileName
        ) {
          byName = message;
        }
      } catch {}
    }
    if (byName) return { message: byName, actualId: String(byName.id) };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

function trackDownload(
  remoteId: string,
  onProgress?: (p: RestoreProgress) => void
): () => void {
  if (!onProgress) return () => {};
  return onUpdate((update) => {
    if (update.type !== "updateFile") return;
    const file = (update.payload as TdAny)?.file as TdAny | undefined;
    if (!file || file?.remote?.id !== remoteId) return;
    onProgress({
      phase: "downloading",
      receivedBytes: Number(
        firstDefined(file.local?.downloadedSize, file.local?.downloaded_size, 0)
      ),
      totalBytes: Number(firstDefined(file.expectedSize, file.expected_size, file.size, 0)),
    });
  });
}

export type RestoreOutcome = "restored" | "no-remote" | "failed";

export async function restoreMediaToDevice(
  mediaId: number,
  onProgress?: (p: RestoreProgress) => void
): Promise<{ outcome: RestoreOutcome; message?: string }> {
  const rows = await getMediaByIds([mediaId]);
  const media = rows[0];
  if (!media || !hasRemoteCopy(media)) {
    return { outcome: "no-remote", message: "No Telegram copy recorded for this item." };
  }

  onProgress?.({ phase: "fetching", receivedBytes: 0, totalBytes: 0 });
  // TDLib only knows chats it has created/fetched in this session — after an app
  // restart the Saved Messages chat must be (re)created before GetMessage works.
  try {
    await TdLib.createPrivateChat(Number(media.remote_chat_id));
  } catch {}
  let remoteFile: { remoteId: string; expected: number } | null = null;
  try {
    const found = await withTimeout(
      fetchMessage(
        media.remote_chat_id as string,
        media.remote_message_id as string,
        media.file_name
      ),
      60_000,
      "Fetching message from Telegram"
    );
    if (!found) {
      const ids: string[] = [];
      try {
        const history = await TdLib.getChatHistory(Number(media.remote_chat_id), 0, 10, 0);
        for (const entry of history) {
          try {
            ids.push(String(JSON.parse(entry.raw_json).id));
          } catch {}
        }
      } catch (err) {
        return { outcome: "failed", message: `History fetch failed: ${err instanceof Error ? err.message : String(err)}` };
      }
      return {
        outcome: "failed",
        message: `Wanted ${media.remote_message_id}, history has ${historyLengthCache}: [${ids.join(",")}]`,
      };
    }
    // Self-heal stale pending ids recorded by the uploader.
    if (found.actualId !== media.remote_message_id) {
      await updateRemoteMessageIdById(mediaId, found.actualId);
    }
    remoteFile = extractRemoteFile(found.message);
    if (!remoteFile) {
      const shape = JSON.stringify(found.message).slice(0, 260);
      return { outcome: "failed", message: `No file in message. Raw: ${shape}` };
    }
  } catch (err) {
    return { outcome: "failed", message: err instanceof Error ? err.message : String(err) };
  }

  const stopTracking = trackDownload(remoteFile.remoteId, onProgress);
  try {
    const download = await withTimeout(
      TdLib.downloadFileByRemoteId(remoteFile.remoteId),
      30 * 60 * 1000,
      "Downloading from Telegram"
    );
    const file = JSON.parse(download.raw) as TdAny;
    const localPath: string | undefined = file?.local?.path;
    const completed = firstDefined(
      file?.local?.isDownloadingCompleted,
      file?.local?.is_downloading_completed
    );
    if (completed !== true || !localPath) {
      return { outcome: "failed", message: "Download did not complete." };
    }

    onProgress?.({ phase: "saving", receivedBytes: remoteFile.expected, totalBytes: remoteFile.expected });
    const asset = await MediaLibrary.createAssetAsync(localPath);
    if (!asset?.uri) return { outcome: "failed", message: "Could not save to the device gallery." };

    await setLocalUri(mediaId, asset.uri, asset.id ?? null);
    onProgress?.({ phase: "done", receivedBytes: remoteFile.expected, totalBytes: remoteFile.expected });
    return { outcome: "restored" };
  } catch (err) {
    return { outcome: "failed", message: err instanceof Error ? err.message : String(err) };
  } finally {
    stopTracking();
  }
}
