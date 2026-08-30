# S9 DESIGN — Telegram-Group Album Sharing (DRAFT — owner must answer the questions)

_Status: design proposal only. Nothing in this doc is implemented beyond the groundwork
(`src/lib/chats.ts` — lists the user's own Telegram groups). Owner answers the questions in
§4 before any UI/DB work starts._

---

## 1. The goal

Let Photogram albums live in a **private Telegram group** instead of only in Saved Messages, so
media can be shared with family — while still using the user's own Telegram account (TDLib), never
the Bot API.

## 2. The two directions (pick one to start)

**A. One-way claim (RECOMMENDED first step)**
- The owner creates a private Telegram group (e.g. "Family Album") and adds family members.
- Family members simply send photos/videos to that group **from their normal Telegram app** —
  no Photogram install, no new habits.
- Photogram watches the group's history and **claims** those messages: downloads the media,
  adds rows to the library (tagged + grouped in a "Shared" album), and records the message ids.
- Pros: zero work for family, no accounts, works today. Cons: their media consumes the owner's
  device storage; claims are one-way (deleting in Photogram doesn't delete in Telegram unless we
  also delete the message — Trash already does exactly this pattern for Saved Messages).

**B. Two-way sync (later, bigger)**
- Family members install Photogram and upload from their own accounts into the shared group.
- Photogram would need per-user settings (which chat to upload to), multi-chat upload support in
  the worker (today it hardcodes Saved Messages), and merge/dedupe logic when two people upload
  the same photo.
- Only worth building after A proves the workflow.

## 3. What each direction needs (technical sketch)

1. **Schema v4 (PROTECTED files — owner approval required):** an `albums` table
   (`id, name, chat_id TEXT, created_at`) + `media.album_id` (nullable FK). Auto-albums (Camera,
   Screenshots…) stay tag-based; only shared albums get rows in `albums`.
2. **Uploader change:** target chat becomes a parameter (today it is hardcoded to Saved Messages).
   The completion-confirm logic (updateMessageSendSucceeded / updateFile) is chat-agnostic already.
3. **Claim worker:** polls the group's `getChatHistory` for unclaimed media messages (cursor stored
   per album), downloads via the restorer's `downloadFileByRemoteId` path, inserts rows with
   `album_id` set. Reuses the existing filename/id self-heal tricks.
4. **Chat picker:** `listMyGroups()` from `src/lib/chats.ts` powers a simple picker screen
   (create-group happens in Telegram itself — simpler and safer than building group creation UI).
5. **UI:** Collections → "Shared albums" section listing `albums` rows; album grid reuses
   `AlbumScreen` with an album-id mode; Viewer gains a "Share to album" chip (sends the media to
   the group).

## 4. QUESTIONS THE OWNER MUST ANSWER (blocking)

1. **Direction:** start with one-way claim (A) — yes/no?
2. **Gallery placement:** should claimed family media appear in the main gallery timeline mixed
   with the owner's own photos (Google Photos does this), or only inside the Shared album?
   (Recommendation: inside the album only, with a Settings toggle later.)
3. **Storage policy:** should claimed media count toward "Free-Up-Space"? (Recommendation: NO —
   never auto-delete family members' originals from the owner's device without an explicit action.)
4. **Which group:** one shared group for everything, or multiple groups = multiple albums
   (one group per album)? (Recommendation: one group = one album, simple mental model.)
5. **Privacy:** claimed photos are visible to everyone in that Telegram group. Is the owner
   comfortable that family members can see everything sent to the group?

## 5. Non-goals for the first cut

- No comments/reactions sync (Telegram-only features).
- No People & Pets integration.
- No editing of family members' media in Photogram.
