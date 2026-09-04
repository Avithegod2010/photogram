import TdLib from "react-native-tdlib";
import {
  findMediaIdByRemoteMessage,
  getSyncedWithoutLocal,
  insertMedia,
  repairSyncedRowsWithoutRemote,
  setMediaRemote,
} from "../db/queries";
import { findDuplicate, quickFingerprint } from "./dedupe";
import { extractMedia } from "./claimer";

// F1 One-tap phone migration (docs/PLAN-FEATURES-v0.11-plus.md) — inventory
// engine, Path A: a fresh phone treats Saved Messages as the source of truth.
// Page getChatHistory over the own chat (the user id doubles as the Saved
// Messages chat id — same pattern as uploader.resolveSavedMessagesChat, which
// stays untouched), extract media from each message via claimer's extractMedia,
// and rebuild `media` rows as cloud-only (`state='synced'`, remote ids
// recorded, local_uri NULL until a restore puts the file back on this device).
// No thumbnails are generated here — rows without a local file have nothing to
// thumbnail; restore/scanner paths own that.

type TdAny = Record<string, any>;

export interface RehydrateProgress {
  // Every history message parsed so far (paging progress).
  scanned: number;
  // Media messages found in total.
  found: number;
  byType: { photos: number; videos: number; documents: number; animations: number };
  bytes: number;
  // Rows inserted into `media` this run.
  added: number;
  // Media messages already indexed by a previous run (idempotent skips).
  duplicates: number;
  // Media messages that could not be indexed this run.
  failed: number;
  lastError?: string;
  done: boolean;
}

export interface RehydrateSummary {
  found: number;
  byType: RehydrateProgress["byType"];
  bytes: number;
  added: number;
  duplicates: number;
  failed: number;
  // First failure reason this run (failure count is capped-info like the
  // scanner's banner: details are visible, the run is never fatal).
  lastError?: string;
}

function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

// TDLib wire sends seconds; some gson paths deliver ms. Values > 1e11 are ms
// (same units rule as the claimer's messageDateMs / scanner's toMs).
function toMs(secondsOrMs: unknown): number {
  const n = Number(secondsOrMs);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? Math.round(n) : Math.round(n * 1000);
}

function messageDateMs(message: TdAny): number {
  const ms = toMs(firstDefined(message?.date, message?.editDate, message?.edit_date));
  return ms > 86400000 ? ms : Date.now();
}

// The own user id doubles as the Saved Messages chat id (read-only reuse of
// the uploader's resolveSavedMessagesChat pattern).
async function resolveSelfUserId(): Promise<string> {
  const raw = await TdLib.getProfile();
  let parsed: TdAny | null = null;
  try {
    parsed = JSON.parse(raw);
    if (parsed && typeof parsed.raw === "string") parsed = JSON.parse(parsed.raw as string);
  } catch {}
  const id = parsed?.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("Cannot determine your Telegram user id.");
  }
  return String(id);
}

function mimeFor(fileName: string, isVideo: boolean): string {
  if (isVideo) return "video/mp4";
  const name = fileName.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function typeBucket(message: TdAny): keyof RehydrateProgress["byType"] | null {
  const content: TdAny = message?.content ?? {};
  const type: string = content["@type"] ?? "";
  if (type === "messagePhoto" || Array.isArray(content.photo?.sizes)) return "photos";
  if (type === "messageVideo" || content.video) return "videos";
  if (type === "messageAnimation" || content.animation) return "animations";
  if (type === "messageDocument" || content.document) return "documents";
  return null;
}

const PAGE_SIZE = 100;
// Freshly created chats return empty history for a few seconds before TDLib
// finishes loading them (the restorer's open-chat + retry pattern). The first
// page gets the full retry budget; later pages only a short one, so reaching
// the oldest message doesn't stall the run.
const FIRST_PAGE_RETRIES = 5;
const LATER_PAGE_RETRIES = 2;
const EMPTY_PAGE_DELAY_MS = 1500;
// A SHORT page is ambiguous the same way an empty one is: TDLib streams a
// chat's history from the server, so a partial page usually means "still
// loading", not "the oldest message". It is only accepted as the end once
// SHORT_PAGE_STABLE_ROUNDS consecutive refetches return the same oldest
// message id AND the same length; MAX_SHORT_PAGE_PROBES bounds the probing
// (same 1.5 s delay per attempt as the empty-page budget) so the run always
// terminates — a re-scan is idempotent, so an early end just means the owner
// taps "Re-scan" later.
const SHORT_PAGE_STABLE_ROUNDS = 3;
const MAX_SHORT_PAGE_PROBES = 20;
const INSERT_CHUNK = 50;

// Oldest parseable message id in a fetched page (null when none parse).
function oldestIdOf(page: Array<{ raw_json: string }>): number | null {
  let oldest: number | null = null;
  for (const entry of page) {
    try {
      const id: unknown = JSON.parse(entry.raw_json)?.id;
      if (typeof id === "number" && (oldest === null || id < oldest)) oldest = id;
    } catch {}
  }
  return oldest;
}

interface PendingRow {
  chatId: string;
  messageId: string;
  input: Parameters<typeof insertMedia>[0];
}

// Resolves the ambiguity of a SHORT history page: TDLib streams a chat's
// history from the server, so a partial page usually means "still loading",
// not "the oldest message". Re-fetches (same 1.5 s delay as the empty-page
// budget) until either the page fills in — the fuller page is returned and the
// walk continues normally — or the page stops changing: after
// SHORT_PAGE_STABLE_ROUNDS consecutive fetches with the SAME oldest message id
// AND the same length it is accepted as the genuinely-last page.
// MAX_SHORT_PAGE_PROBES bounds the probing so the walk always terminates; a
// re-scan is idempotent, so a cap-forced early end is merely cosmetic. Returns
// null when cancelled.
async function settleShortPage(
  chatId: number,
  fromMessageId: number,
  initial: Array<{ raw_json: string }>,
  cancelRef?: { cancelled: boolean }
): Promise<Array<{ raw_json: string }> | null> {
  let page = initial;
  let lastOldest = oldestIdOf(initial);
  let lastLen = initial.length;
  let stableRounds = 0;
  for (let probes = 0; probes < MAX_SHORT_PAGE_PROBES; probes++) {
    if (cancelRef?.cancelled) return null;
    await new Promise((resolve) => setTimeout(resolve, EMPTY_PAGE_DELAY_MS));
    let fetched: Array<{ raw_json: string }> = [];
    try {
      fetched = await TdLib.getChatHistory(chatId, fromMessageId, PAGE_SIZE, 0);
    } catch {}
    if (fetched.length === 0) {
      // Transient hiccup — an empty fetch confirms nothing, so the stability
      // window restarts (the probe cap still bounds total attempts).
      stableRounds = 0;
      continue;
    }
    if (fetched.length >= PAGE_SIZE) return fetched; // was still loading — walk on
    const oldest = oldestIdOf(fetched);
    if (fetched.length === lastLen && oldest !== null && oldest === lastOldest) {
      stableRounds++;
      if (stableRounds >= SHORT_PAGE_STABLE_ROUNDS) return fetched; // confirmed end
    } else {
      stableRounds = 0;
    }
    page = fetched;
    lastOldest = oldest;
    lastLen = fetched.length;
  }
  return page; // probe cap reached — accept the latest page as the end
}

// Walks Saved Messages newest-oldest, indexing every media message into
// `media` as a cloud-only synced row. Idempotent by remote message id: a
// re-run re-reads the same history, skips every message already indexed
// (findMediaIdByRemoteMessage), and inserts only what the old phone uploaded
// since — duplicates and bytes are still counted, so the totals stay accurate.
// Bounded memory: one history page (100 raw messages) at a time; inserts are
// batched and flushed in INSERT_CHUNK chunks.
export async function rehydrateInventory(
  onProgress?: (p: RehydrateProgress) => void,
  cancelRef?: { cancelled: boolean }
): Promise<RehydrateSummary> {
  const chatId = await resolveSelfUserId();
  try {
    await TdLib.createPrivateChat(Number(chatId));
  } catch {}

  // Self-heal first (review fix): a crash between insertMedia and setMediaRemote
  // in a previous run leaves synced rows with no remote ids and no local file —
  // invisible to restore and permanently skipped here by fingerprint. Deleting
  // them up front lets this run re-index those messages cleanly.
  try {
    await repairSyncedRowsWithoutRemote();
  } catch {}

  const progress: RehydrateProgress = {
    scanned: 0,
    found: 0,
    byType: { photos: 0, videos: 0, documents: 0, animations: 0 },
    bytes: 0,
    added: 0,
    duplicates: 0,
    failed: 0,
    done: false,
  };
  const report = () => onProgress?.({ ...progress, byType: { ...progress.byType } });
  const fail = (err: unknown) => {
    progress.failed++;
    if (!progress.lastError && err instanceof Error) progress.lastError = err.message;
  };

  // getChatHistory(fromMessageId=0) returns the newest page first; pass the
  // oldest id of the previous page as fromMessageId to walk backward until an
  // empty page — or a short page settleShortPage confirmed is the last one —
  // ends the history. The strictly-decreasing guard breaks a pathological
  // TDLib replay of the same page instead of looping forever.
  let fromMessageId = 0;
  let batch: PendingRow[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const chunk = batch;
    batch = [];
    for (const row of chunk) {
      if (cancelRef?.cancelled) break;
      try {
        const inserted = await insertMedia(row.input);
        if (inserted !== null) {
          progress.added++;
          await setMediaRemote(inserted, row.chatId, row.messageId, "synced");
        } else {
          // INSERT OR IGNORE lost a UNIQUE race (fingerprint) — the row exists.
          progress.duplicates++;
        }
      } catch (err) {
        fail(err);
      }
    }
    report();
  };

  try {
    while (true) {
      if (cancelRef?.cancelled) break;

      const retries = fromMessageId === 0 ? FIRST_PAGE_RETRIES : LATER_PAGE_RETRIES;
      let page: Array<{ raw_json: string }> = [];
      for (let attempt = 0; attempt < retries; attempt++) {
        if (cancelRef?.cancelled) break;
        try {
          page = await TdLib.getChatHistory(Number(chatId), fromMessageId, PAGE_SIZE, 0);
          if (page.length > 0) break;
        } catch {}
        if (attempt < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, EMPTY_PAGE_DELAY_MS));
        }
      }

      if (page.length === 0) break; // history exhausted (or chat unreadable)

      // A short page is ambiguous (review MAJOR 2): settle it before trusting
      // it as the end. If TDLib was still streaming history, the settled page
      // comes back full (or fuller) and the walk continues normally below.
      if (page.length < PAGE_SIZE) {
        const settled = await settleShortPage(Number(chatId), fromMessageId, page, cancelRef);
        if (settled === null) break; // cancelled during probing
        page = settled;
      }

      let oldestInPage = Number.MAX_SAFE_INTEGER;
      for (const entry of page) {
        if (cancelRef?.cancelled) break;
        let message: TdAny | null = null;
        try {
          message = JSON.parse(entry.raw_json);
        } catch {}
        if (!message || typeof message.id !== "number") continue;

        progress.scanned++;
        const messageId = String(message.id);
        if (message.id < oldestInPage) oldestInPage = message.id;

        const bucket = typeBucket(message);
        const info = extractMedia(message);
        if (!bucket || !info) continue; // text / service / unsupported messages

        progress.found++;
        progress.byType[bucket]++;
        progress.bytes += info.byteSize;

        try {
          // Idempotency key: this Saved Messages message already indexed by a
          // previous run (re-runs after the old phone uploads more land here).
          if ((await findMediaIdByRemoteMessage(chatId, messageId)) !== null) {
            progress.duplicates++;
            continue;
          }
          const takenAt = messageDateMs(message);
          const fingerprint = quickFingerprint({
            byteSize: info.byteSize,
            modifiedAtMs: takenAt,
            fileName: info.fileName ?? `tg-${messageId}`,
          });
          // Same-file re-sends (identical size+date+name) collapse onto the
          // existing row — one library row per identical file, the scanner's
          // dedupe rule too.
          if ((await findDuplicate(fingerprint)) !== null) {
            progress.duplicates++;
            continue;
          }
          batch.push({
            chatId,
            messageId,
            input: {
              local_uri: null,
              thumb_uri: "",
              file_name: info.fileName ?? `tg-${messageId}`,
              mime_type: mimeFor(info.fileName ?? "", info.isVideo),
              byte_size: info.byteSize,
              width: info.width,
              height: info.height,
              taken_at: takenAt,
              fingerprint,
              state: "synced",
              tags: "migrated",
            },
          });
        } catch (err) {
          fail(err);
        }
        if (batch.length >= INSERT_CHUNK) await flush();
      }
      report();

      if (cancelRef?.cancelled) break;
      // No parseable message in the page → the cursor cannot advance safely.
      if (oldestInPage === Number.MAX_SAFE_INTEGER) break;
      // A still-short page has been through settleShortPage, so it is a
      // confirmed end (or the probe cap fired) — the oldest message is in it.
      if (page.length < PAGE_SIZE) break; // reached the oldest message
      if (fromMessageId !== 0 && oldestInPage >= fromMessageId) break;
      fromMessageId = oldestInPage;
    }

    await flush();
  } finally {
    progress.done = true;
    report();
  }

  return {
    found: progress.found,
    byType: progress.byType,
    bytes: progress.bytes,
    added: progress.added,
    duplicates: progress.duplicates,
    failed: progress.failed,
    lastError: progress.lastError,
  };
}

// Cloud-only synced rows waiting for a paced device download — the restore
// phase's work queue (same shape the Settings restorable list uses; shared
// album rows are excluded by the query itself).
export function listCloudOnly(): Promise<
  Array<{ id: number; byte_size: number; file_name: string | null }>
> {
  return getSyncedWithoutLocal();
}

// HEURISTIC (review MINOR 4): "does a Photogram backup exist in Saved
// Messages?" — not "is there any media at all". The owner's Saved Messages may
// also hold personal forwarded files, so a bare extractMedia() hit over-triggers
// the Gallery migration banner. Photogram uploads (uploader.ts) always carry a
// caption equal to the media's fileName, so a message counts only when it is a
// photo/video/animation/document AND its caption matches that fileName (for
// photos, which have no fileName field in TDLib, the caption itself must look
// like a media file name). This can in principle miss or over-match (any
// hand-captioned message whose text equals a file name) — it is a cheap gate
// for a banner, not a parser; the real inventory walk is fingerprint-exact.
function looksLikeFileName(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const s = text.trim();
  return s.length > 0 && !s.includes("\n") && /\.[a-z0-9]{2,5}$/i.test(s);
}

function looksLikePhotogramUpload(message: TdAny): boolean {
  const bucket = typeBucket(message);
  if (!bucket) return false;
  const content: TdAny = message?.content ?? {};
  // TDLib gson keeps the caption object as caption.text in both conventions.
  const caption: unknown = content.caption?.text;
  const fileName = firstDefined(
    content.document?.fileName,
    content.document?.file_name,
    content.video?.fileName,
    content.video?.file_name,
    content.animation?.fileName,
    content.animation?.file_name
  );
  if (typeof fileName === "string" && fileName.length > 0) {
    return caption === fileName;
  }
  // Photos: the uploader's caption IS the stored fileName — require that the
  // caption at least has the shape of a file name.
  return looksLikeFileName(caption);
}

// Cheap "does a backup exist" probe for the Gallery empty-state banner: reads
// the most recent Saved Messages page and reports whether it contains at least
// MIN_PHOTOGRAM_UPLOAD_MATCHES Photogram-style uploads (see the heuristic
// above). Never inserts; safe to call on an empty library.
const MIN_PHOTOGRAM_UPLOAD_MATCHES = 3;

export async function hasSavedMessagesMedia(): Promise<boolean> {
  try {
    const chatId = await resolveSelfUserId();
    try {
      await TdLib.createPrivateChat(Number(chatId));
    } catch {}
    const page = await TdLib.getChatHistory(Number(chatId), 0, 50, 0);
    let matches = 0;
    for (const entry of page) {
      try {
        const message = JSON.parse(entry.raw_json) as TdAny;
        if (message && looksLikePhotogramUpload(message)) {
          matches++;
          if (matches >= MIN_PHOTOGRAM_UPLOAD_MATCHES) return true;
        }
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}
