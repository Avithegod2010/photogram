import { onUpdate } from "./tdlib";
import { claimAlbumMedia, claimSingleMessage, extractMedia } from "./claimer";
import { deleteAlbumMediaByMessage, listLinkedAlbums } from "../db/queries";

// S9 Phase 2 live sync for linked shared albums (docs/S9-DESIGN.md §2 item 1,
// phase 2): family posts/deletes in the Telegram group are reflected in the
// album grid without pressing "⟳ Claim new". Started ONCE from App.tsx's
// ready phase, next to the other loop starts.
//
// Handled updates (only for chats whose id belongs to a linked album):
// - updateNewMessage     → claim JUST that message through the claimer engine
//   (claimSingleMessage: same download + fingerprint dedupe + own-sender rules
//   as "⟳ Claim new", so no double rows and no own-photo duplicates).
// - updateDeleteMessages → remove the album_media LINK rows only. The media
//   row itself is never touched — the owner's library copy and its Saved
//   Messages backup are the owner's own storage; the photo just leaves the
//   album grid.
// - updateMessageContent (edits) is a deliberate NO-OP in this version: the
//   album grid reads SQLite only, so an edited caption/forward-info changes
//   nothing here. Revisit if sender/month grouping ever needs edit data.
//
// Boot catch-up: shortly after start, the idempotent per-album claim
// (claimAlbumMedia) runs once per linked album — its last_claimed_message_id
// cursor picks up only messages newer than the last run, so nothing missed
// while the app was closed is lost and no extra cursor is introduced.

type TdAny = Record<string, any>;

function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

// Allowlist of linked group chat ids, refreshed at start and at every drain —
// events for any other chat are dropped at enqueue time (zero DB/TDLib work).
let linkedChatIds = new Set<string>();

type SyncJob =
  | { kind: "new"; chatId: string; message: TdAny }
  | { kind: "delete"; chatId: string; messageIds: string[] };

// Event bursts (someone dumping 30 photos into the group) land here; the drain
// processes them strictly one at a time, so a burst can never fire concurrent
// TDLib calls. Capped so a pathological flood cannot grow it without bound —
// anything above the cap is covered by the next boot/claim catch-up anyway.
const jobQueue: SyncJob[] = [];
const JOB_QUEUE_CAP = 200;

// Small debounce: a burst settles into one sequential batch instead of one
// drain per message. New-claim acceptance latency stays well under a second
// of user-perceived delay for single messages (one debounce tick).
const DRAIN_DEBOUNCE_MS = 2000;

let drainScheduled = false;

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  setTimeout(() => {
    drainScheduled = false;
    if (jobQueue.length === 0) return;
    void runExclusive(drainQueue);
  }, DRAIN_DEBOUNCE_MS);
}

// Every TDLib-touching task (live drain, boot catch-up) runs through this
// single-file chain — claim downloads are heavy and must never run
// concurrently with each other (the claimer's sequential-loop property).
let workChain: Promise<void> = Promise.resolve();

function runExclusive(task: () => Promise<void>): Promise<void> {
  const run = workChain.then(task);
  workChain = run.catch(() => {});
  return run;
}

async function drainQueue(): Promise<void> {
  const albums = await listLinkedAlbums();
  linkedChatIds = new Set(albums.map((a) => a.chat_id));
  const byChat = new Map(albums.map((a) => [a.chat_id, a]));
  while (jobQueue.length > 0) {
    const job = jobQueue.shift()!;
    const album = byChat.get(job.chatId);
    if (!album) continue; // unlinked between enqueue and drain — drop it
    try {
      if (job.kind === "new") {
        const outcome = await claimSingleMessage(album, job.message);
        if (__DEV__) {
          console.log(`[groupSync] ${album.title}: live claim ${outcome} (msg ${job.message.id})`);
        }
      } else {
        let removed = 0;
        for (const messageId of job.messageIds) {
          removed += await deleteAlbumMediaByMessage(album.id, messageId);
        }
        if (__DEV__ && removed > 0) {
          console.log(`[groupSync] ${album.title}: ${removed} album link(s) removed (group delete)`);
        }
      }
    } catch (err) {
      // A sync failure must never crash the app — log and keep draining.
      if (__DEV__) {
        console.log(`[groupSync] job failed for ${album.title}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}

// Boot catch-up: re-run the idempotent claim per linked album so messages that
// arrived while the app was closed are picked up by the cursor (delayed like
// the autoBackup loop's first pass, so it never competes with login/paint).
function runBootCatchUp(): Promise<void> {
  return runExclusive(async () => {
    const albums = await listLinkedAlbums();
    for (const album of albums) {
      try {
        const progress = await claimAlbumMedia(album.id);
        if (__DEV__) {
          console.log(
            `[groupSync] catch-up ${album.title}: ${progress.claimed} new, ${progress.duplicates} dup, ${progress.failed} failed`
          );
        }
      } catch (err) {
        if (__DEV__) {
          console.log(`[groupSync] catch-up failed for ${album.title}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  });
}

function handleUpdate(update: { type: string; payload: Record<string, unknown> }): void {
  try {
    if (update.type === "updateNewMessage") {
      const message = update.payload.message as TdAny | undefined;
      if (!message || typeof message.id !== "number") return;
      // Non-media chatter (text, service messages) is zero work by definition.
      if (!extractMedia(message)) return;
      const chatId = String(firstDefined(message.chat_id, message.chatId, ""));
      if (!chatId || !linkedChatIds.has(chatId)) return;
      if (jobQueue.length >= JOB_QUEUE_CAP) return;
      jobQueue.push({ kind: "new", chatId, message });
      scheduleDrain();
      return;
    }
    if (update.type === "updateDeleteMessages") {
      const rawIds = firstDefined(update.payload.message_ids, update.payload.messageIds);
      if (!Array.isArray(rawIds) || rawIds.length === 0) return;
      const chatId = String(firstDefined(update.payload.chat_id, update.payload.chatId, ""));
      if (!chatId || !linkedChatIds.has(chatId)) return;
      if (jobQueue.length >= JOB_QUEUE_CAP) return;
      jobQueue.push({ kind: "delete", chatId, messageIds: rawIds.map((id) => String(id)) });
      scheduleDrain();
      return;
    }
    // updateMessageContent (edits): deliberate no-op for this version — see
    // the header comment. Every other update type is ignored here too.
  } catch (err) {
    if (__DEV__) {
      console.log("[groupSync] update handling failed:", err instanceof Error ? err.message : err);
    }
  }
}

let started = false;

export function startGroupSync(): void {
  if (started) return;
  started = true;
  // Load the allowlist before the listener can drop early events.
  void listLinkedAlbums()
    .then((albums) => {
      linkedChatIds = new Set(albums.map((a) => a.chat_id));
    })
    .catch(() => {});
  setTimeout(() => void runBootCatchUp(), 20_000);
  onUpdate(handleUpdate);
}
