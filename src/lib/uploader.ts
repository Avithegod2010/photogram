import TdLib from "react-native-tdlib";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import * as Network from "expo-network";
import type * as BatteryModule from "expo-battery";
import { useSettingsStore } from "../store/settingsStore";
import {
  bumpQueueAttempt,
  countQueueByStatus,
  dedupeUploadQueue,
  enqueueUpload,
  getMediaByIds,
  nextQueued,
  resetActiveToPending,
  replaceRemoteMessageId,
  setMediaRemote,
  setMediaState,
  updateQueueStatus,
} from "../db/queries";
import { TdError, onUpdate } from "./tdlib";
import {
  THROTTLE_LIMIT_BYTES,
  THROTTLE_PAUSE_MS,
  useUploadStore,
} from "../store/uploadStore";

const MAX_ATTEMPTS = 5;
const UPLOAD_CONFIRM_TIMEOUT_MS = 2 * 60 * 60 * 1000;

type TdAny = Record<string, any>;

let workerStarted = false;
let savedMessagesChatId: string | null = null;

// TDLib gson output uses JAVA field names (fileName, isUploadingCompleted…)
// while some paths carry the wire-format snake_case — check both everywhere.
function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

interface UploadFileInfo {
  fileId: number | null;
  uploadComplete: boolean;
}

// Locate the outgoing media's TDLib file id (for updateFile tracking) and
// whether its remote copy is already fully uploaded.
function extractUploadFile(message: TdAny): UploadFileInfo {
  const content: TdAny = message?.content ?? {};
  const fileOf = (f: TdAny | undefined): UploadFileInfo | null => {
    if (!f) return null;
    return {
      fileId: Number(firstDefined(f.id, f.fileId)) || null,
      uploadComplete:
        firstDefined(f.remote?.isUploadingCompleted, f.remote?.is_uploading_completed) === true,
    };
  };
  const doc = fileOf(content.document?.document ?? content.animation?.animation);
  if (doc) return doc;
  const sizes: TdAny[] = Array.isArray(content.photo?.sizes) ? content.photo.sizes : [];
  let best: (UploadFileInfo & { area: number }) | null = null;
  for (const size of sizes) {
    const info = fileOf(size?.photo);
    if (!info || info.fileId === null) continue;
    const area = (Number(size.width) || 0) * (Number(size.height) || 0);
    if (!best || area > best.area) best = { ...info, area };
  }
  if (best) return { fileId: best.fileId, uploadComplete: best.uploadComplete };
  return { fileId: null, uploadComplete: false };
}

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
    await dedupeUploadQueue();
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

  // Clean up double-queued items from repeated "Back up" presses before the loop starts.
  void dedupeUploadQueue().then(() => refreshCounts());

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
    const uploadingActive = firstDefined(
      remote?.isUploadingActive,
      remote?.is_uploading_active
    );
    const uploadedSize = Number(
      firstDefined(remote?.uploadedSize, remote?.uploaded_size, 0)
    );
    if (uploadingActive === true && uploadedSize > 0) {
      store.setActiveProgress(uploadedSize);
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

    const hold = await uploadHoldReason();
    if (hold) {
      state.setHoldReason(hold);
      await sleep(4000);
      continue;
    }
    if (state.holdReason) {
      state.setHoldReason(null);
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

    // The message exists in the chat immediately (possibly with a pending id),
    // but its bytes may still be uploading — record the remote ids as
    // "uploading" and flip to "synced" only after confirmation below.
    const sent = await findSentMessage(Number(chatId), fileName);
    await setMediaRemote(media.id, chatId, sent.messageId ?? "0", "uploading");

    const confirmed =
      sent.uploadComplete ||
      !sent.messageId ||
      (await waitForUploadConfirmed(
        Number(chatId),
        sent.messageId,
        sent.fileId,
        UPLOAD_CONFIRM_TIMEOUT_MS
      ));

    if (!confirmed) {
      await updateQueueStatus(
        item.id,
        "failed",
        "Telegram has the message but upload completion was not confirmed (timeout). Restore can still find it once it finishes."
      );
      useUploadStore
        .getState()
        .setError("Upload not confirmed complete — check Telegram before retrying to avoid duplicates.");
      return;
    }

    await setMediaState(media.id, "synced");
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

// Freshly created chats return empty history for a few seconds — retry briefly,
// like restorer.ts does.
async function findSentMessage(
  chatIdNumber: number,
  fileName: string
): Promise<{ messageId: string | null; fileId: number | null; uploadComplete: boolean }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const history = await TdLib.getChatHistory(chatIdNumber, 0, 5, 0);
      for (const entry of history) {
        try {
          const message = JSON.parse(entry.raw_json);
          const caption =
            message?.content?.caption?.text ??
            firstDefined(
              message?.content?.document?.fileName,
              message?.content?.document?.file_name
            ) ??
            "";
          if (typeof caption === "string" && caption.includes(fileName)) {
            const info = extractUploadFile(message);
            return { messageId: String(message.id), fileId: info.fileId, uploadComplete: info.uploadComplete };
          }
        } catch {}
      }
      if (history.length > 0) {
        const latest = JSON.parse(history[0].raw_json);
        if (latest?.id) {
          const info = extractUploadFile(latest);
          return { messageId: String(latest.id), fileId: info.fileId, uploadComplete: info.uploadComplete };
        }
      }
    } catch {}
    await sleep(1500);
  }
  return { messageId: null, fileId: null, uploadComplete: false };
}

// Wait until TDLib confirms the file's bytes fully reached Telegram, via
// updateMessageSendSucceeded / updateFile events plus a history poll fallback.
// The message is already in the chat by the time this is called, so a timeout
// does NOT mean the upload is lost — only that it was not confirmed here.
async function waitForUploadConfirmed(
  chatIdNumber: number,
  messageId: string,
  fileId: number | null,
  timeoutMs: number
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      unsubscribe();
      resolve(value);
    };

    const unsubscribe = onUpdate((update) => {
      if (settled) return;
      if (update.type === "updateMessageSendSucceeded") {
        const oldId = firstDefined(
          (update.payload as TdAny)?.oldMessageId,
          (update.payload as TdAny)?.old_message_id
        );
        const newId = (update.payload?.message as TdAny | undefined)?.id;
        if (String(oldId ?? "") === messageId || String(newId ?? "") === messageId) {
          finish(true);
        }
        return;
      }
      if (update.type === "updateFile" && fileId !== null) {
        const file = (update.payload as TdAny)?.file as TdAny | undefined;
        if (!file || Number(firstDefined(file.id, file.fileId)) !== fileId) return;
        const uploaded = Number(
          firstDefined(file.remote?.uploadedSize, file.remote?.uploaded_size, 0)
        );
        if (uploaded > 0) {
          useUploadStore.getState().setActiveProgress(uploaded);
        }
        if (
          firstDefined(file.remote?.isUploadingCompleted, file.remote?.is_uploading_completed) ===
          true
        ) {
          finish(true);
        }
      }
    });

    // Events can be missed (e.g. send succeeded before we started listening) —
    // re-check the message's remote state in history every 5 s.
    pollTimer = setInterval(() => {
      if (settled || !messageId) return;
      void (async () => {
        try {
          const history = await TdLib.getChatHistory(chatIdNumber, 0, 5, 0);
          for (const entry of history) {
            try {
              const message = JSON.parse(entry.raw_json);
              if (!message || String(message.id) !== messageId) continue;
              if (extractUploadFile(message).uploadComplete) finish(true);
              break;
            } catch {}
          }
        } catch {}
      })();
    }, 5000);

    timeoutTimer = setTimeout(() => finish(false), timeoutMs);
  });
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

// expo-battery's native module only exists after the next gradle rebuild — the
// installed APK predates it. Soft-require so a missing module means "not charging"
// instead of crashing the worker.
// expo-battery's native module only exists after the next gradle rebuild — the
// installed APK predates it. Soft-require so a missing module means "not charging"
// instead of crashing the worker.
function requireBattery(): typeof BatteryModule | null {
  try {
    const resolved = require("expo-battery") as typeof BatteryModule;
    return typeof resolved?.getBatteryStateAsync === "function" ? resolved : null;
  } catch {
    return null;
  }
}

// Respects the Settings toggles: "Wi-Fi only" and "Only while charging".
// Returns a user-facing hold reason, or null when uploads may proceed.
async function uploadHoldReason(): Promise<string | null> {
  const { wifiOnlyUpload, chargeOnlyUpload } = useSettingsStore.getState();
  if (!wifiOnlyUpload && !chargeOnlyUpload) return null;

  try {
    if (wifiOnlyUpload) {
      const net = await Network.getNetworkStateAsync();
      // The interface enum drifted across SDKs — accept any non-cellular truthiness.
      const isWifi = (net as { type?: string; typeName?: string }).type === Network.NetworkStateType.WIFI
        || (net as { typeName?: string }).typeName === "WIFI"
        || (net as { isWifi?: boolean }).isWifi === true;
      if (!isWifi) {
        return "Waiting for Wi-Fi (Wi-Fi only is on in Settings)";
      }
    }
  } catch {
    // Network unreadable: fail open rather than stalling forever.
  }

  if (chargeOnlyUpload) {
    const battery = requireBattery();
    if (!battery) return null; // native not built yet — don't hold uploads hostage
    try {
      const state = await battery.getBatteryStateAsync();
      const charging =
        state === battery.BatteryState.CHARGING || state === battery.BatteryState.FULL;
      if (!charging) {
        return "Waiting for charger (charge-only is on in Settings)";
      }
    } catch {
      // Unreadable battery state: fail open.
    }
  }
  return null;
}
