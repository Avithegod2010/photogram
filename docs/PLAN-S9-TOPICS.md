# PLAN — S9 Fast-Follow: Topic Sub-Albums (forum topics inside shared albums)

_Status: plan only, no code changed. Written 2026-09-01. Target: v0.10 (or next version the owner picks)._

## 0. Request (quoted)

From `docs/S9-DESIGN.md` §2 item 4: **"ONE GROUP = ONE ALBUM. If a group has Telegram Topics enabled,
each topic renders as a sub-album inside the group's section (TDLib: chatListForum / forum_topic_id)."**
And §4 item 3: **"Topic sub-albums via chatListForum as a fast-follow."**

Dispatcher's task: when a shared album is linked to a Telegram group with forum topics enabled, the
shared-album UI shows each topic as a sub-album inside the group's album, the claim engine records
which topic each claimed message came from, and media from each topic is shown separately. Media sent
outside any topic (the General topic) needs sensible handling. Groups WITHOUT topics behave exactly
as today.

## 1. Requirements (what must be true when done)

1. Claiming a shared album whose group has topics enabled stores, per claimed message, the Telegram
   topic id (`message_thread_id`) it came from — alongside the existing `sender_id` / `message_id`.
2. The shared-album screen shows the group's topics as sub-albums (filter chips) above the grid;
   selecting one shows only that topic's media; an "All" chip shows everything. Each chip shows its
   media count.
3. The General topic (messages sent to the group without picking a topic) appears as its own
   "General" sub-album. Media claimed before this feature (topic unknown) appears only under "All".
4. Groups without topics: UI and claim behavior are byte-identical to today (regression-free).
5. The claim cursor stays **one watermark per album** (`albums.last_claimed_message_id`); no
   per-topic cursors, no re-claiming, no skipping.
6. Topic metadata is persisted in SQLite (the UI reads only SQLite — product rule §1.3), refreshed
   by each claim run.
7. No changes to protected files other than the flagged additive migration in `db/schema.ts`
   (owner approval required — see Task 1).

Non-goals: posting INTO topics from Photogram, two-way sync, topic pinning/notifications, >100-topic
paging (family groups won't hit it), background claiming (claims stay manual, as today).

## 2. Design decisions

### D1 — Data model: schema v6, additive only (PROTECTED — owner approval gate)

`db/schema.ts` gains one new migration block appended to `MIGRATIONS` (same pattern as v2–v5).
`db/index.ts` needs NO change (it iterates `MIGRATIONS` generically).

```sql
-- SCHEMA_V6 (forum topic sub-albums, docs/PLAN-S9-TOPICS.md)
ALTER TABLE album_media ADD COLUMN forum_topic_id TEXT;   -- Telegram message_thread_id, TEXT (ids exceed JS safe ints)
CREATE TABLE IF NOT EXISTS forum_topics (
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,                                -- Telegram message_thread_id, TEXT
  title     TEXT NOT NULL,
  is_hidden INTEGER NOT NULL DEFAULT 0,                   -- General topic can be hidden in Telegram
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, thread_id)
);
```

- `media` table untouched. Timeline/search/map/stats exclusion rules (`EXCLUDE_ALL_SHARED`,
  `EXCLUDE_UNLESS_TIMELINED` in `db/queries.ts`) keep working unchanged — topic rows are ordinary
  album_media rows.
- Rejected: per-topic cursor columns (`albums.last_claimed…` per topic) — unnecessary; message ids
  are globally sequential per chat, so one watermark works (see D3).
- Rejected: storing topic ids only in memory — violates "SQLite is the gallery's source of truth".

### D2 — TDLib calls (exact requests; gson camelCase on responses, snake_case on requests)

All calls go through `TdLib.td_json_client_send` raw requests, the pattern proven in
`src/lib/chats.ts` (`sendTd` / `sendTdWithRetry` / `firstDefined`). Requests use TDLib wire
snake_case field names (chats.ts sends `chat_list`, `chat_id` and works in production); responses
come back gson JAVA camelCase, so every read is `firstDefined(camel, snake_case)`.

**a. Is the group a forum?** Only supergroups can have topics (`kind === "basic"` groups → never).
```
{ "@type": "getChat", chat_id: <num> }                     // already the chats.ts pattern
  → chat.type["@type"] === "chatTypeSupergroup" → supergroupId = firstDefined(type.supergroupId, type.supergroup_id)
{ "@type": "getSupergroup", supergroup_id: <num> }
  → isForum = firstDefined(sg.isForum, sg.is_forum)
fallback if undefined: { "@type": "getSupergroupFullInfo", supergroup_id: <num> }
  → firstDefined(full.isForum, full.is_forum)
```

**b. Topic list** — the correct TDLib method is **`getForumTopics`** (td_api.tl, added TDLib 1.8.0;
there is no `getForumTopicList`):
```
{ "@type": "getForumTopics",
  chat_id: <num>, query: "",
  offset_date: 0, offset_message_id: 0, offset_message_thread_id: 0,
  limit: 100 }
→ @type "forumTopics", topics[] of "@type":"forumTopic"
   topic.info.messageThreadId (or message_thread_id), topic.info.title, topic.info.isHidden (is_hidden)
```
A TDLib `error` response (e.g. "CHAT_NOT_FORUM"-style 400) ⇒ treat the chat as non-forum. Confirm the
exact response field shapes live during Task 3 (error messages name unknown methods, so a wrong name
fails loudly and safely).

**c. Per-topic history** — TDLib method **`getMessageThreadHistory`**:
```
{ "@type": "getMessageThreadHistory",
  chat_id: <num>, message_thread_id: <num topic id>,
  from_message_id: 0, offset: 0, limit: 100, only_local: false }
→ @type "messages", messages[] (newest first), each a full message object the claimer already parses
```
react-native-tdlib 2.3.0 also exposes a typed wrapper `TdLib.getMessageThreadHistory(chatId,
threadId, fromMessageId, offset, limit): Promise<TdRawResult>` (`index.d.ts` line 153, returns
`{ raw: string }`). Plan: use the **raw `td_json_client_send` request** as primary (the raw pattern
is field-proven in this app; the typed wrapper is untested here), and note the wrapper as fallback.
Topic attribution comes from the loop variable — we never need to parse `messageThreadId` /
`replyTo` off individual messages for claiming (those fields changed shape across TDLib versions:
`message.message_thread_id` → `message.reply_to(messageReplyToMessage)`; the backfill in Task 4b
checks both via `firstDefined`).

**d. General topic** = thread id **"1"** (Telegram constant). Always append it to the scan list if
`getForumTopics` didn't include it. If TDLib rejects thread 1 at runtime, General messages fall back
to appearing under "All" only (graceful, no crash).

### D3 — Claim cursor: stays per-album, but advances to the MINIMUM newest id across topics

Message ids are globally sequential inside one chat (topics are just reply-threads in one channel),
so a single `albums.last_claimed_message_id` watermark works. But with multiple topics the cursor
must advance only to `min(newestMessageId per topic)` — not the max — so a message posted into a
topic during the (slow, download-heavy) claim run can never fall below the cursor and be skipped:

1. Snapshot phase: fetch every topic's newest history (metadata only, no downloads) → per-topic
   `newestId`.
2. Claim phase: process messages with `id > cursor`, oldest-first per topic, downloads included.
3. Cursor update: `setAlbumClaimCursor(albumId, String(min(perTopicNewestIds)))` — computed from the
   snapshot phase, before/while downloads run. This is strictly safer than today's max-based update.

The non-forum path keeps today's exact logic (`getChatHistory` → max id), untouched.

### D4 — General-topic handling

General media gets `forum_topic_id = '1'` and renders as a sub-album titled "General" (the real
Telegram title). Owner's own messages still never get album-linked (S9 rule 2) regardless of topic.
Pre-topics rows (`forum_topic_id IS NULL`) show only under "All". If General is `is_hidden` and has
0 claimed media, its chip is hidden.

### D5 — Groups without topics

`isForumChat()` false → no `forum_topics` rows are written, no topic recorded
(`linkMediaToAlbum(..., forumTopicId = null)`), UI renders no chip row. Identical to today.

### D6 — UI nesting: filter chips inside the shared album (no new routes)

In `AlbumScreen.tsx` (shared mode only): a horizontal Material 3 chip row sits above the grid —
"All (N)" first, then one chip per topic ("Beach · 12"), General first among topics. Selecting a chip
re-runs `listAlbumMedia(albumId, topicId)`. The grid, Viewer handoff (`ids`/`index`), state dots, and
the "Show in my timeline" switch all operate on the filtered set exactly as today.
Rejected: a separate sub-album card grid on `SharedAlbumsScreen` — would double navigation depth and
fragment the Viewer's id list; chips keep "one group = one album" literally true.

### D7 — Topic list lifecycle

Each claim run rebuilds `forum_topics` for the album from the live TDLib list (DELETE + INSERT in one
transaction) → renames propagate after the next claim, deleted topics disappear. UI never calls TDLib.
No Expo APIs are used in this feature (plain RN `ScrollView`/`Pressable`) → no SDK-57 docs lookup
required.

## 3. Task breakdown (ordered; each task lands green)

### Task 1 — Schema v6 migration [PROTECTED — GET OWNER APPROVAL BEFORE EDITING]

- File: `src/db/schema.ts` only. Append `SCHEMA_V6` (SQL in D1) + `{ version: 6, up: SCHEMA_V6 }` to
  `MIGRATIONS`. No other file changes. Explicitly tell the owner: additive-only, follows the v4 S9
  pattern, no data rewrite, downgrade impossible (SQLite).
- Acceptance: `tsc` passes; on-device migration log shows v5→v6; pull the DB
  (`adb exec-out run-as com.photogram.app cat files/SQLite/photogram.db*`) and verify with
  `node:sqlite`: `PRAGMA table_info(album_media)` includes `forum_topic_id`; `forum_topics` exists;
  `meta.schema_version = '6'`; all existing rows/lists unchanged.
- Risk: low (additive ALTER + new table).

### Task 2 — queries.ts: topic-aware album queries (no UI change yet)

- File: `src/db/queries.ts` (NOT protected).
  1. `linkMediaToAlbum(albumId, mediaId, senderId, messageId, forumTopicId: string | null = null)`
     → INSERT gains `forum_topic_id` column. (Existing callers keep compiling via the default.)
  2. New `replaceForumTopics(albumId, topics: Array<{ threadId: string; title: string; isHidden: boolean }>)`
     — single `withTransactionAsync`: `DELETE FROM forum_topics WHERE album_id = ?` then batch INSERT.
  3. New `listAlbumTopics(albumId): Promise<Array<{ thread_id: string; title: string; is_hidden: number; count: number }>>`:
     ```sql
     SELECT ft.thread_id, ft.title, ft.is_hidden,
       (SELECT COUNT(*) FROM album_media am
         WHERE am.album_id = ft.album_id AND am.forum_topic_id = ft.thread_id) AS count
     FROM forum_topics ft WHERE ft.album_id = ?
     ORDER BY (ft.thread_id = '1') DESC, ft.updated_at ASC
     ```
  4. `listAlbumMedia(albumId, topicId?: string | null)` — add `AND am.forum_topic_id = ?` when
     `topicId` is given; no filter otherwise (All view, includes NULL-topic rows).
  5. New `listAlbumMediaWithoutTopic(albumId, limit = 200)` (message_id, for backfill) and
     `setAlbumMediaTopic(albumId, messageId, threadId)`:
     `UPDATE album_media SET forum_topic_id = ? WHERE album_id = ? AND message_id = ? AND forum_topic_id IS NULL`.
- Acceptance: `tsc` passes; the app runs exactly as before (nothing calls the new functions yet);
  quick sanity: call `listAlbumTopics` from a temporary log line and see `[]` for a non-topic album,
  then remove it.
- Risk: low. UI untouched so zero regression surface.

### Task 3 — New `src/lib/forum.ts`: forum detection + topic list + thread history

- New file (NOT protected; ~90 lines, mirrors chats.ts structure: local `sendTd`, `sendTdWithRetry`,
  `firstDefined`):
  - `export async function isForumChat(chatId: string): Promise<boolean>` — D2a (basic groups →
    `false` immediately; any error → `false`).
  - `export interface ForumTopicRef { threadId: string; title: string; isHidden: boolean }`.
  - `export async function listForumTopics(chatId: string): Promise<ForumTopicRef[]>` — D2b; on
    error returns `[]`. ALWAYS ensure thread id `"1"` ("General") is present (D2d).
  - `export async function fetchThreadMessages(chatId: string, threadId: string, limit = 100):
      Promise<TdAny[]>` — D2c raw request; parses `messages` array via
    `firstDefined(parsed.messages, parsed.Messages)`; on error logs and returns `[]`.
- Acceptance: `tsc` passes; live on device, a temporary debug log during a claim against the owner's
  real topic-enabled test group prints the topic titles/ids and a non-empty message array per topic.
  This task is verified together with Task 4's first device run.
- Risk: medium — response field shapes are reasoned from TDLib td_api.tl, not yet observed live.
  Mitigation: `firstDefined` everywhere, graceful `[]`/`false` fallbacks, loud `lastError` surfacing.

### Task 4 — claimer.ts: forum-aware claiming (core logic)

- File: `src/lib/claimer.ts` (NOT protected).
  1. `claimOne(albumId, chatId, message, ownUserId, threadId: string | null)` — pass `threadId`
     through to `linkMediaToAlbum`.
  2. In `claimAlbumMedia`, after `openChat`: `const isForum = await isForumChat(album.chat_id)`.
  3. Non-forum → existing code path, byte-identical (D5).
  4. Forum path:
     - `topics = await listForumTopics(chatId)`; if empty (TDLib hiccup) → fall back to the existing
       non-forum path and record `lastError = "Could not read topics; claimed without topic split"`.
     - `await replaceForumTopics(albumId, topics)`.
     - Snapshot phase: for each topic, `fetchThreadMessages` (3-attempt retry) → per-topic
       `newestId` (top item regardless of media type) and keep messages with `id > cursor`.
     - Claim phase: per topic, oldest-first, `claimOne(..., topic.threadId)`; existing
       `findClaimedMessage` duplicate guard unchanged; progress reporting unchanged.
     - Cursor: `setAlbumClaimCursor(albumId, String(Math.min(...newestIdsOfSuccessfullyFetchedTopics)))`
       — skip the update entirely if no topic fetch succeeded (D3).
     - Backfill (Task 4b, same file): for up to 200 rows from `listAlbumMediaWithoutTopic`, call
       `TdLib.getMessage(chatIdNumber, Number(messageId))` → parse raw →
       `firstDefined(m.messageThreadId, m.message_thread_id, m.replyTo?.messageReplyToMessage?.replyToMessageId,
       m.replyTo?.messageReplyToMessage?.reply_to_message_id)` → `setAlbumMediaTopic`. Own-sender rows
       have no album_media row, so they're naturally excluded.
- Acceptance (on the owner's real test group — see assumptions): claim run claims messages from ≥2
  topics; pulled DB shows `album_media.forum_topic_id` populated per message and `forum_topics` rows
  with correct titles; "⟳ Claim new" twice → second run reports 0 new (cursor stable, no dupes);
  non-topic group still claims exactly as before (log the branch taken).
- Risk: medium (main logic). Mitigation: forum path is fully additive behind `isForumChat`; the
  non-forum branch is untouched.

### Task 5 — AlbumScreen.tsx: topic sub-album chips

- File: `src/screens/AlbumScreen.tsx` (NOT protected).
  - New state: `topics: Array<{ thread_id: string; title: string; count: number }>`,
    `activeTopic: string | "all"` (default `"all"`).
  - Load `listAlbumTopics(sharedAlbumId)` alongside rows (shared mode only). Rows loader becomes
    `listAlbumMedia(sharedAlbumId, activeTopic === "all" ? undefined : activeTopic)`; re-run on
    `activeTopic` change (include it in the existing `useEffect` deps).
  - Chip row (only when `topics.length > 0`): horizontal `ScrollView`, `Pressable` chips, M3 dark
    theme (`theme.colors.primaryContainer` when selected / `surfaceContainer` otherwise, per the
    existing mini-chip styles in `SharedAlbumsScreen.tsx`). Labels: `All (N)` then
    `${title}${count ? ` · ${count}` : ""}`, General first (list is already ordered). Hide the
    General chip when `thread_id === '1'`, `is_hidden` set, and `count === 0` (D4).
  - Groups without topics (`topics.length === 0`): nothing new renders — today's screen exactly.
- Acceptance: topic group shows chips; tapping a chip filters the grid; Viewer pager operates on the
  filtered set; timeline switch still works; count in header reflects the filter; non-topic album and
  auto-albums (Camera, Screenshots…) render with no chip row (regression check on device).
- Risk: low (pure UI over existing query).

### Task 6 — Device verification + docs

- Full pass on the Samsung (§5 env): both a topic-enabled supergroup and a plain group.
- Update `NEXT_SESSION.md` §0 (state + new key facts, e.g. "forum claim cursor = min-of-newest per
  topic"). **CHANGELOG entry only when the owner approves the commit** (AGENTS rule — do not commit).

## 4. Files to touch

| File | Change | Protected |
|---|---|---|
| `src/db/schema.ts` | additive SCHEMA_V6 (Task 1) | YES — owner approval gate |
| `src/db/queries.ts` | linkMediaToAlbum 5th param + 5 new/extended functions (Task 2) | no |
| `src/lib/forum.ts` | NEW: isForumChat / listForumTopics / fetchThreadMessages (Task 3) | no |
| `src/lib/claimer.ts` | forum-aware claim path + backfill (Task 4) | no |
| `src/screens/AlbumScreen.tsx` | topic chip row + filtered query (Task 5) | no |
| `NEXT_SESSION.md`, `CHANGELOG.md` | handoff note now; CHANGELOG at commit time only | tracked docs |

Untouched by design: `lib/tdlib.ts`, `lib/qrLink.ts`, `auth/authStore.ts`, `screens/LoginScreen.tsx`,
`db/index.ts`, `app.config.ts`, `lib/uploader.ts`, `lib/chats.ts`, `screens/SharedAlbumsScreen.tsx`,
all timeline-exclusion queries.

## 5. Risks

1. **TDLib response shapes not yet observed live** (topic list + thread history; gson camelCase vs
   wire snake_case, and TDLib version drift of message topic fields). Mitigation: raw requests +
   `firstDefined` both conventions + graceful fallback to the flat claim path; Task 3 verifies live
   before Task 4 is trusted.
2. **`getForumTopics` / `getMessageThreadHistory` method names** — these are the td_api.tl names
   (there is no `getForumTopicList`); a wrong name returns a TDLib `error` naming the problem, which
   the fallback path converts into "claim without topic split" rather than a crash.
3. **General topic (thread 1) semantics** — verify live; worst case General media appears under "All"
   only.
4. **Claim race across topics** — solved by the min-of-newest cursor (D3); strictly safer than the
   current single-chat max logic.
5. **>100 topics / huge backlogs** — not paged (one 100-message page per topic per run, same as
   today's group claim); fine for family groups; documented as a known limit.

## 6. Assumptions to confirm with the owner before executing

1. Approval to edit protected `src/db/schema.ts` for the additive v6 migration (Task 1).
2. General topic renders as its own "General" sub-album (not merged into "All").
3. Chips inside the shared album screen are the desired "sub-album" rendering (vs. separate cards in
   Shared albums).
4. The owner creates/has a real Telegram supergroup with 2–3 topics for device verification (claims
   are manual, so live testing needs the group).
5. Pre-existing claimed rows get topic-id backfilled opportunistically (capped at 200 per claim run)
   — acceptable extra TDLib `getMessage` calls.
