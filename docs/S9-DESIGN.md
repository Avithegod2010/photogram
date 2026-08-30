# S9 DESIGN — Telegram-Group Album Sharing (DECIDED — owner answered all questions 2026-08-30)

_Status: agreed spec. Phase 1 (one-way claim) implements everything below except the items marked
"later". Groundwork exists: `src/lib/chats.ts` (`listMyGroups()`)._

---

## 1. The goal

Let Photogram albums live in a **private Telegram group** instead of only in Saved Messages, so
media can be shared with family — while still using the user's own Telegram account (TDLib), never
the Bot API.

## 2. Decided design (owner's answers, 2026-08-30)

1. **Direction: BOTH, PHASED.** Phase 1 ships the one-way claim (family sends to a Telegram group
   from their normal Telegram app; Photogram claims their media into a Shared album). Phase 2 later
   adds two-way (family members use Photogram and upload from their own accounts). Consequence for
   Phase 1 code: the upload queue is **chat-parameterized from day one** so Phase 2 needs no rework.
2. **Placement: ALBUM-ONLY by default + per-album "Show in my timeline" toggle (default OFF) with a
   master switch in Settings → Shared albums.** The main gallery query simply excludes rows that
   have an `album_id` unless the toggles say otherwise — a view filter, not a data move, fully
   reversible. Memories, search, and the map exclude claimed rows entirely for now. Exception:
   **photos the owner sends to the group themselves are inserted WITHOUT album_id** and stay in the
   main timeline permanently — they're the owner's own photos.
3. **Storage: NEVER auto-delete family media.** Free-Up-Space skips every row with an `album_id`
   set. Only the owner's own backed-up media is eligible. (Reason: their originals aren't the
   owner's to delete; group retention is out of our control.)
4. **Groups: ONE GROUP = ONE ALBUM.** Groups are created in Telegram itself (no group-creation UI).
   **If a group has Telegram Topics enabled, each topic renders as a sub-album inside the group's
   section** (TDLib: chatListForum / forum_topic_id).
5. **Privacy: Telegram rules + clear warnings.** Everyone in a group sees everything in it —
   Photogram shows a one-time explanation in the picker flow and an extra caution badge when the
   picked group has many members.

## 3. Long-term todos (explicitly deferred, do not build yet)

- **Album organizer**: in-app option to sort/organize a shared album's photos by sender, by month,
  etc. (owner requested — future planning).
- **Two-way sync** (Phase 2): family members use Photogram and upload from their own accounts;
  needs per-user upload targets, dedupe of identical uploads, merge rules.

## 4. Technical plan (Phase 1)

1. **Schema v4** (additive): `albums` table (`id, name, chat_id TEXT, last_claimed_message_id TEXT,
   show_in_timeline INTEGER default 0, created_at`); `media.album_id` INTEGER nullable + index;
   `upload_queue.chat_id` TEXT nullable (NULL = Saved Messages, unchanged).
2. **Queries:** shared-album CRUD + claim cursor; main gallery / Memories / search / map / stats
   exclude `album_id IS NOT NULL` unless toggles allow; Free-Up-Space skips album rows;
   `enqueueUpload` gains optional target chat.
3. **Claim engine (`src/lib/claimer.ts`):** per album, `openChat` + `getChatHistory` on the group,
   claim media messages newer than the cursor; download originals into the app's own storage folder
   (NOT the device DCIM — keep the phone gallery clean), 320px thumbnails, insert rows with
   `album_id` + sender info; filename/id self-heal like the restorer. Own-sender messages →
   `album_id` NULL (timeline rule above). Topic sub-albums via chatListForum as a fast-follow.
4. **UI:** Collections → "Shared albums" section (list + cover) → "Link a group" picker
   (`listMyGroups()` + privacy warning + many-members caution); shared album grid (AlbumScreen in
   album mode) with per-album timeline toggle; master switch in Settings.

## 5. Non-goals for Phase 1

- Comments/reactions sync, People & Pets integration, editing family members' media in Photogram.
