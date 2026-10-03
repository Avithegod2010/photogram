import TdLib from "react-native-tdlib";
import {
  getPendingNoteSync,
  setMediaNote,
  setNoteSynced,
  MediaRow,
  PendingNoteRow,
} from "../db/queries";
import { isPreviewCaption } from "./uploadFormat";

// F3 photo journaling (docs/PLAN-F3-JOURNALING.md). A note IS the Telegram
// caption (D1): set locally first (never lost), then pushed via the typed
// editMessageCaption wrapper once the row is synced. NO uploader.ts import —
// send-time captions stay fileName so findSentMessage matching is untouched.

type TdAny = Record<string, any>;

function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

// Unlike forum.ts's error-collapsing parse, this KEEPS TDLib error objects —
// the error code/message decides the retry path (D4).
function parseRawKeepErrors(result: { raw: string } | null): TdAny | null {
  if (!result || typeof result.raw !== "string") return null;
  try {
    return JSON.parse(result.raw) as TdAny;
  } catch {
    return null;
  }
}

export type NoteSyncResult =
  | { status: "synced" }
  | { status: "deferred"; reason?: string }
  | { status: "failed"; reason?: string }
  | { status: "foreign"; caption: string };

const EDITABLE_CONTENT = new Set(["messagePhoto", "messageDocument", "messageVideo", "messageAnimation"]);

// D3/D4: read back the current caption before any edit — never blind-overwrite.
// force = the owner explicitly confirmed replacing a foreign caption.
async function applyNoteToRemote(row: PendingNoteRow, force: boolean): Promise<NoteSyncResult> {
  const chatId = Number(row.remote_chat_id);
  const messageId = Number(row.remote_message_id);
  if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) {
    return { status: "deferred", reason: "bad remote ids" };
  }
  // Fallback content-type guard (read-back is authoritative when it succeeds).
  const mime = row.mime_type ?? "";
  if (!(mime.startsWith("image/") || mime.startsWith("video/"))) {
    return { status: "deferred", reason: `mime ${mime || "null"}` };
  }

  // Read-back (fresh chats return empty history for a few seconds — openChat
  // first, the restorer's lesson). A failed read defers, even with force.
  let caption: string | null = null;
  let contentType: string | null = null;
  try {
    await TdLib.openChat(chatId);
    const parsed = parseRawKeepErrors(await TdLib.getMessage(chatId, messageId));
    if (!parsed || parsed["@type"] === "error") {
      return { status: "deferred", reason: "read-back failed" };
    }
    contentType = (parsed.content?.["@type"] as string) ?? null;
    caption = (firstDefined(parsed.content?.caption?.text, parsed.content?.caption?.text_) as string) ?? null;
  } catch (err) {
    return { status: "deferred", reason: err instanceof Error ? err.message : "read-back threw" };
  }

  // Content-type guard on authoritative data.
  if (!contentType || !EDITABLE_CONTENT.has(contentType)) {
    return { status: "deferred", reason: `content ${contentType ?? "null"}` };
  }
  // A2: never touch a preview caption.
  if (isPreviewCaption(caption)) {
    return { status: "deferred", reason: "preview caption" };
  }
  // Foreign caption = something we did not write (owner hand-captioned it in
  // Telegram). Our own pushed note counts as ours (makes removal seamless).
  const ownNote = row.note_text ?? "";
  const foreign =
    !!caption &&
    caption !== row.file_name &&
    caption !== ownNote &&
    !isPreviewCaption(caption);
  if (foreign && !force) {
    return { status: "foreign", caption };
  }

  const target = row.note_text ?? row.file_name ?? "";
  try {
    const parsed = parseRawKeepErrors(
      (await TdLib.editMessageCaption(chatId, messageId, target)) as { raw: string } | null
    );
    if (parsed && parsed["@type"] === "error") {
      const message = String(parsed.message ?? "");
      if (/not modified/i.test(message)) {
        await setNoteSynced(row.id);
        return { status: "synced" };
      }
      // MESSAGE_EDIT_FORBIDDEN / MESSAGE_ID_INVALID (stale pending id) / etc:
      // keep the note local and retry on the next trigger — data is never lost.
      if (__DEV__) console.log(`[notes] edit deferred id=${row.id}: ${message}`);
      return { status: "failed", reason: message };
    }
    if (!parsed) {
      return { status: "failed", reason: "unparseable response" };
    }
    await setNoteSynced(row.id);
    return { status: "synced" };
  } catch (err) {
    if (__DEV__) console.log(`[notes] edit threw id=${row.id}:`, err instanceof Error ? err.message : err);
    return { status: "failed", reason: err instanceof Error ? err.message : "edit threw" };
  }
}

// D5: boot retry + Viewer save/open triggers. Sequential on purpose — tiny
// volumes, and never parallel TDLib writes.
export async function syncPendingNotes(): Promise<{ pushed: number; deferred: number; failed: number }> {
  const counters = { pushed: 0, deferred: 0, failed: 0 };
  let pending: PendingNoteRow[] = [];
  try {
    pending = await getPendingNoteSync();
  } catch {
    return counters;
  }
  for (const row of pending) {
    const result = await applyNoteToRemote(row, false);
    if (result.status === "synced") counters.pushed++;
    else if (result.status === "failed") counters.failed++;
    else counters.deferred++;
  }
  return counters;
}

// Viewer entry point: local-first save, then best-effort immediate push when
// the row is already synced. The shared-row guard runs in the Viewer (it owns
// the alert); this function assumes it passed.
export async function saveViewerNote(
  row: MediaRow,
  text: string | null,
  force: boolean
): Promise<NoteSyncResult | { status: "saved-local" }> {
  await setMediaNote(row.id, text);
  if (row.state === "synced" && row.remote_chat_id && row.remote_message_id) {
    return applyNoteToRemote(
      {
        id: row.id,
        remote_chat_id: row.remote_chat_id,
        remote_message_id: row.remote_message_id,
        note_text: text,
        file_name: row.file_name,
        mime_type: row.mime_type,
      },
      force
    );
  }
  return { status: "saved-local" };
}
