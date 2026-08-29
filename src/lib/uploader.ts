import TdLib from "react-native-tdlib";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { useSettingsStore } from "../store/settingsStore";
import {
  bumpQueueAttempt,
  countQueueByStatus,
  enqueueUpload,
  getMediaByIds,
  nextQueued,
  resetActiveToPending,
  replaceRemoteMessageId,
  setMediaRemote,
  updateQueueStatus,
} from "../db/queries";
import { TdError, onUpdate } from "./tdlib";
import {
  THROTTLE_LIMIT_BYTES,
  THROTTLE_PAUSE_MS,
  useUploadStore,
} from "../store/uploadStore";

const MAX_ATTEMPTS = 5;

let workerStarted = false;
let savedMessagesChatId: string | null = null;

function parseRetryAfterSeconds(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const msg = err.message ?? "";
  const floodMatch = msg.match(/FLOOD(?:_WAIT)?[_ ]?(?:WAIT)?[ _]?(\d+)/i);
  if (floodMatch) return parseInt(floodMatch[1], 10);
  const retryMatch = msg.match(/retry after (\d+)/i);
  if (retryMatch) return parseInt(retryMatch[1], 10);
  if (err instanceof TdError && err.code === 429) return 10;
  return null;
}

async function resolveSavedMessagesChat(): Promise<string> {
  if (savedMessagesChatId) return savedMessagesChatId;
  const profileRaw = await TdLib.getProfile();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(profileRaw);
    if (parsed && typeof (parsed as Record<string, unknown>).raw === "string") {
      parsed = JSON.parse((parsed as Record<string, unknown>).raw as string);
    }
  } catch {}
  const userId = parsed?.id;
  if (typeof userId !== "string" && typeof userId !== "number") {
    throw new Error("Cannot determine Telegram user id for Saved Messages.");
  }
  await TdLib.createPrivateChat(typeof userId === "number" ? userId : Number(userId));
  savedMessagesChatId = String(userId);
  return savedMessagesChatId;
}

export function enqueueForUpload(mediaId: number): Promise<void> {
  return (async () => {
    const rows = await getMediaByIds([mediaId]);
    const media = rows[0];
    if (!media || !media.local_uri) throw new Error("Media not found or already removed locally.");
    await enqueueUpload(media.id, media.local_uri, media.byte_size);
    void refreshCounts();
    startWorker();
  })();
}

export async function refreshCounts(): Promise<void> {
  try {
    const counts = await countQueueByStatus();
    useUploadStore.getState().setCounts({
      pending: counts.pending + counts.active,
      done: counts.done,
      failed: counts.failed,
    });
  } catch {}
}

export async function pauseUploads(): Promise<void> {
  useUploadStore.getState().setPaused(true);
  await resetActiveToPending();
  await refreshCounts();
}

export async function resumeUploads(): Promise<void> {
  useUploadStore.getState().setPaused(false);
  startWorker();
}

export function startWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  // TDLib initially assigns a pending id to an outgoing message and replaces it
  // once the send succeeds — keep the stored remote_message_id in sync.
  onUpdate((update) => {
    if (update.type !== "updateMessageSendSucceeded") return;
    try {
      const message = update.payload.message as Record<string, unknown> | undefined;
      const oldId = update.payload.old_message_id;
      if (!message || typeof message.id === "undefined" || typeof oldId === "undefined") return;
      void replaceRemoteMessageId(String(oldId), String(message.id));
    } catch {}
  });

  onUpdate((update) => {
    if (update.type !== "updateFile") return;
    const store = useUploadStore.getState();
    if (!store.active) return;
    const file = update.payload.file as Record<string, unknown> | undefined;
    if (!file) return;
    const remote = file.remote as Record<string, unknown> | undefined;
    if (
      remote &&
      remote.is_uploading_active === true &&
      typeof remote.uploaded_size === "number"
    ) {
      store.setActiveProgress(remote.uploaded_size as number);
    }
  });

  void workerLoop();
}

async function workerLoop(): Promise<void> {
  const store = useUploadStore.getState();

  while (true) {
    const state = useUploadStore.getState();

    if (state.paused) {
      await sleep(1000);
      continue;
    }

    const throttleUntil = state.throttledUntil;
    if (throttleUntil && Date.now() < throttleUntil) {
      await sleep(Math.min(500, throttleUntil - Date.now()));
      continue;
    }
    if (throttleUntil && Date.now() >= throttleUntil) {
      state.setThrottledUntil(null);
    }

    const item = await nextQueued();
    if (!item) {
      await refreshCounts();
      useUploadStore.setState({ active: null, running: false });
      await sleep(2500);
      continue;
    }

    useUploadStore.setState({ running: true });
    await runOne(item);
  }
}

interface QueueItem {
  id: number;
  media_id: number;
  local_uri: string;
  byte_size: number;
  attempts: number;
}

async function runOne(item: QueueItem): Promise<void> {
  const store = useUploadStore.getState();
  const rows = await getMediaByIds([item.media_id]);
  const media = rows[0];
  if (!media || !media.local_uri) {
    await updateQueueStatus(item.id, "failed", "Media row missing or local file gone");
    await refreshCounts();
    return;
  }
  const localUri = media.local_uri;

  const fileName = media.file_name ?? `media-${media.id}`;
  store.setActive({
    queueId: item.id,
    mediaId: media.id,
    fileName,
    byteSize: item.byte_size,
    uploadedBytes: 0,
  });
  await updateQueueStatus(item.id, "active");
  const chatId = await resolveSavedMessagesChat();

  try {
    let path = localUri.replace(/^file:\/\//, "");
    const isVideo = media.mime_type.startsWith("video/");
    const quality = useSettingsStore.getState().uploadQuality;

    if (
      !isVideo &&
      quality === "storage_saver" &&
      item.byte_size > 300_000
    ) {
      try {
        const context = ImageManipulator.manipulate(localUri).resize({ width: 2048 });
        const rendered = await context.renderAsync();
        const saved = await rendered.saveAsync({
          compress: 0.85,
          format: SaveFormat.JPEG,
        });
        const candidate = saved.uri.replace(/^file:\/\//, "");
        const size = new File(candidate).size ?? 0;
        if (size > 0 && size < item.byte_size) {
          path = candidate;
        }
      } catch {}
    }

    const content = isVideo
      ? {
          "@type": "inputMessageDocument",
          document: { "@type": "inputFileLocal", path },
          caption: { "@type": "formattedText", text: fileName },
        }
      : {
          "@type": "inputMessagePhoto",
          photo: { "@type": "inputFileLocal", path },
          caption: { "@type": "formattedText", text: fileName },
        };

    const response = await withTimeout(
      TdLib.td_json_client_send({
        "@type": "sendMessage",
        chat_id: Number(chatId),
        input_message_content: content,
      }),
      15 * 60 * 1000
    );

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(response);
    } catch {}

    if (parsed && parsed["@type"] === "error") {
      throw new TdError(
        Number(parsed.code ?? -1),
        String(parsed.message ?? "sendMessage failed")
      );
    }

    const messageId = await fetchLatestMessageId(Number(chatId), fileName);
    if (messageId) {
      await setMediaRemote(media.id, chatId, messageId);
    } else {
      await setMediaRemote(media.id, chatId, "0");
    }

    await updateQueueStatus(item.id, "done");
    store.addSessionBytes(item.byte_size);
    if (
      store.sessionBytes >= THROTTLE_LIMIT_BYTES &&
      !store.throttledUntil
    ) {
      store.setThrottledUntil(Date.now() + THROTTLE_PAUSE_MS);
    }
  } catch (err) {
    const retryAfter = parseRetryAfterSeconds(err);
    const attempts = await bumpQueueAttempt(item.id);

    if (retryAfter !== null && attempts < MAX_ATTEMPTS) {
      useUploadStore.getState().setThrottledUntil(Date.now() + (retryAfter + 1) * 1000);
      useUploadStore.getState().setError(
        `Telegram asked us to slow down. Pausing ${retryAfter}s then resuming automatically.`
      );
      await updateQueueStatus(item.id, "pending");
    } else if (attempts < MAX_ATTEMPTS && !(err instanceof TdError && err.code === 404)) {
      await updateQueueStatus(item.id, "pending");
    } else {
      await updateQueueStatus(item.id, "failed", err instanceof Error ? err.message : String(err));
      useUploadStore.getState().setError(err instanceof Error ? err.message : String(err));
    }
  } finally {
    useUploadStore.getState().setActive(null);
    await refreshCounts();
  }
}

async function fetchLatestMessageId(
  chatIdNumber: number,
  fileName: string
): Promise<string | null> {
  try {
    const history = await TdLib.getChatHistory(chatIdNumber, 0, 5, 0);
    for (const entry of history) {
      try {
        const message = JSON.parse(entry.raw_json);
        const caption =
          message?.content?.caption?.text ?? message?.content?.document?.file_name ?? "";
        if (caption.includes(fileName)) {
          return String(message.id);
        }
      } catch {}
    }
    if (history.length > 0) {
      const latest = JSON.parse(history[0].raw_json);
      if (latest?.id) return String(latest.id);
    }
  } catch {}
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Upload timed out")), ms);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
