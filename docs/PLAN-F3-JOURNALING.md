# PLAN — F3 Photo Journaling (v0.13): notes as Telegram captions

_Status: plan only, no code written. Written 2026-09-06. Target: v0.13, one coding session + one
gradle rebuild + a device verification pass. Style/format follows docs/PLAN-S9-TOPICS.md._

## 0. Request (quoted)

From `docs/PLAN-FEATURES-v0.11-plus.md` §2, F3 (v0.13) — the authoritative spec being expanded:

> **Goal (plain language).** Long-press any backed-up photo in Photogram and write a note — "Emma's
> first steps". The note is saved as that photo's caption in Telegram (so it survives forever and is
> visible from any Telegram client), and cached in Photogram's database so the gallery shows it
> instantly with a small indicator.

Plus §5 assumption 4 (already committed by the owner): **"F3 note replaces the photo's Telegram
caption (owner will see the note instead of the original fileName caption in Telegram). Documents/
videos keep fileName in metadata. Confirm."**

Dispatcher's expansion for this session: ViewerScreen-only entry (grid work DEFERRED, see D6), a
sync-first architecture that does **not** touch `src/lib/uploader.ts` (D2 option A), schema v8
stacked on the sibling agent's uncommitted v7 (D8), one new native wrapper via one idempotent
`scripts/patch-tdlib.js` insert entry, and explicit owner decisions collected at the end.

**Verified facts this plan relies on (checked, not assumed):**
- `node_modules/react-native-tdlib/android/.../TdApi.java`: `class EditMessageCaption extends
  Function<Message>`, constructor `(long chatId, long messageId, ReplyMarkup replyMarkup,
  FormattedText caption, boolean showCaptionAboveMedia)`; `FormattedText(String text, TextEntity[]
  entities)`; CONSTRUCTOR constant exists. TDLib answers with the edited Message object, or an
  error object `{"@type":"error","code":400,"message":"..."}` delivered through the SAME
  `client.send` callback (never a Java exception).
- `node_modules/react-native-tdlib/index.d.ts` line 126: `export function getMessage(chatId:
  number, messageId: number): Promise<TdRawResult>;` and line 263 registers it on the default
  export. The D3 read-back therefore uses the existing typed wrapper — **no extra task needed**.
- `src/lib/uploader.ts` (read-only check): sends `caption: fileName` for originals (lines ~385/390)
  and `${fileName}${PREVIEW_CAPTION_SUFFIX}` for previews (~410); `findSentMessage` (~592) matches
  by `caption.includes(fileName)` and skips preview captions; `remote_message_id` always tracks the
  ORIGINAL. **Hard rule: this file is NOT touched.**
- `src/db/schema.ts`: **no preview flag/marker column exists anywhere in the DB.** Previews never
  become media rows; assumption stated in A3 below.
- `src/db/queries.ts`: `EXCLUDE_ALL_SHARED` fragment (line 130) = `AND NOT EXISTS (SELECT 1 FROM
  album_media am WHERE am.media_id = media.id)`. Claimed shared-album photos ARE media-table rows
  (claimer.ts `insertMedia` + `linkMediaToAlbum`), so shared rows are identifiable by that link.
- Git state (2026-09-06): sibling's uncommitted files are App.tsx, package*.json, src/db/queries.ts,
  src/db/schema.ts, src/navigation/index.tsx (+ untracked junk files). **ViewerScreen.tsx is clean
  in git.**
- `ViewerScreen.tsx` (318 lines): ActionChip row at ~144–187 (Share, Save to device, Back up,
  Archive, Hide, Delete); info modal (meta sheet) ~189–209 with MetaRow rows; `ActionChip` component
  ~214–238; `MetaRow` ~240–247; single `styles` StyleSheet ~249–318.
- `App.tsx` boot effect at lines 18–25 (`phase === "ready"` → purge/repair/loops) — sibling-touched
  file, so the notes addition must be a separate region.

## 1. Requirements (what must be true when done)

1. The owner can add, edit, or remove a note (≤1000 chars) on any item from the **Viewer** screen.
   The note saves to SQLite immediately — typed data is never lost, even offline.
2. Once the item is `state='synced'` with remote ids, the note is pushed as that message's Telegram
   **caption** (replacing the fileName caption, per the committed D1 decision) via a new typed
   `editMessageCaption` native wrapper. `note_synced` flips to 1 only after Telegram confirms.
3. Pending notes (`note_synced = 0`) are retried: on app boot, when the Viewer saves a note, and
   when the Viewer opens a synced row with a pending note. No background task, no uploader change.
4. If Telegram currently shows a caption that is neither the row's fileName nor a preview caption,
   the owner gets an explicit "Replace the caption 'X'?" confirm before it is overwritten.
5. Schema v8 is additive on top of v7 (`media.note_text TEXT`, `media.note_synced INTEGER NOT NULL
   DEFAULT 0`); the generic migration runner picks it up with no `db/index.ts` change.
6. Shared-album (album_media-linked) rows are excluded from note syncing — the app never edits
   captions on family members' messages.
7. Regression-free: new uploads still carry the fileName caption at send time and still match
   `findSentMessage`; the uploader and all protected files behave byte-identically.

Non-goals (explicit scope decisions, see D6/D7): no Gallery grid indicator, no grid long-press, no
album_media caption edits, no two-way caption sync (Telegram-side caption edits are not pulled back
in v0.13), no new navigation routes.

## 2. Design decisions

### D1 — Caption composition: the note IS the caption

When a note is set, the message's Telegram caption becomes the note text itself — the clean string
the owner reads in every Telegram client. This replaces the fileName caption and implements the
owner-committed tradeoff (§5.4 of the features plan): the restore-time **filename fallback** for
photos degrades, but (a) `remote_message_id` is authoritative, (b) the fallback only ever rescued
stale pending ids (self-healed since v0.5), and (c) documents/videos/animations keep `fileName`
inside TDLib document metadata, which `messageContentFileName` reads first — unaffected.

**Note removal symmetry:** "Remove" in the editor clears `note_text` and (once synced) edits the
caption **back to the row's `file_name`**, restoring the pre-note state. If `file_name` is null the
caption restore is skipped (nothing sensible to restore; local note is still cleared).

Rejected alternative: `"<note> — <fileName>"` — preserves filename-fallback matching but pollutes
the caption the owner reads everywhere; revisit only if device testing shows fallback misses.

### D2 — Upload-time caption handling: option A (sync-after), option B rejected for now

- **A (RECOMMENDED, planned): zero uploader.ts changes.** Notes save locally with
  `note_synced = 0`; a sync loop in `src/lib/notes.ts` pushes the caption via the new
  `editMessageCaption` wrapper only after the row reaches `state='synced'` (boot retry + Viewer
  triggers, D5). An item noted while still uploading gets its caption edited right after upload
  confirmation flips it to synced. Cost: a brief window where Telegram shows the fileName caption
  before the note lands. Benefit: zero risk to the mid-bulk-backup uploader and to
  `findSentMessage` matching (the caption still contains fileName at send time).
- **B (rejected for now): minimal uploader edit** — read `note_text` at send time and send it as
  the caption. Rejected: touches `uploader.ts` mid-bulk-backup (hard prohibition) and breaks
  `findSentMessage` caption matching for that send (caption would no longer contain fileName).
  Revisit only after the bulk backup finishes AND device testing shows option A's delay window is
  unacceptable to the owner.

### D3 — Already-captioned guard (read-back before edit)

Before any caption edit, `notes.ts` runs the proven read-back sequence: `TdLib.openChat(Number(
remote_chat_id))` (fresh chats return empty reads for a few seconds — restorer's lesson), then
`TdLib.getMessage(chatIdNumber, Number(remote_message_id))` → parse raw → current caption at
`message.content.caption.text` (the same gson path `findSentMessage` uses).

- If the current caption is empty, equals the row's `file_name`, or ends with the preview suffix
  (`isPreviewCaption` from `src/lib/uploadFormat.ts` — defensive only; see A3) → proceed silently.
- If it is anything else (owner hand-captioned it in Telegram) → the Viewer shows an explicit
  confirm: "Replace the caption 'X'?" before the edit is sent. The sync loop (boot retry) NEVER
  overwrites a foreign caption without that confirm — it defers those rows (stays `note_synced=0`)
  and logs one line.
- If read-back fails entirely (TDLib hiccup, cold chat) → **defer, never blind-overwrite**: the
  edit is skipped this run and retried on the next trigger. One foreign caption lost is forever;
  one retry delayed is nothing.

### D4 — Error taxonomy (typed-note data can never be lost)

The native wrapper resolves `{ raw }` for BOTH success and TDLib error objects, so `notes.ts`
parses the raw JSON itself (its own parse, not `forum.ts`'s error-collapsing `parseRawResult`,
because the error code/message is needed):

- `@type === "error"` and `message` contains `not modified` (case-insensitive; covers
  "MESSAGE_NOT_MODIFIED" and TDLib's textual variant — exact string verified live in Task 7) →
  treat as **success**, `setNoteSynced(id)`.
- `MESSAGE_EDIT_FORBIDDEN`, `MESSAGE_ID_INVALID` (stale pending-id rows — known v0.5 signature),
  chat-not-found, or any other error → keep the note local (`note_synced = 0`), one-line
  `console.log` + one-line toast in the Viewer path (silent log-only in the boot loop), retry on
  the next trigger. Nothing is deleted from SQLite.
- **Content-type guard, pick documented:** primary guard = the D3 read-back's `content["@type"]`
  ∈ {`messagePhoto`, `messageDocument`, `messageVideo`, `messageAnimation`} — authoritative and
  free since the read already happened. Fallback when read-back is unavailable = DB `mime_type`
  starts with `image/` or `video/` (animations land as video/mp4). Anything else → defer, log.
- `CLIENT_NOT_INITIALIZED` (native reject when TDLib client is null) → same keep-local path.

### D5 — Sync triggers (no background task)

1. **Boot:** `App.tsx` calls `syncPendingNotes()` once auth is ready (its own small `useEffect`,
   separate region from the sibling's boot effect).
2. **Viewer save:** after `setMediaNote`, the Viewer fires `syncPendingNotes()` immediately
   (best-effort; failure leaves the row pending).
3. **Viewer open:** when the Viewer loads rows and any loaded synced row has `note_synced = 0`,
   it fires `syncPendingNotes()` then refreshes the rows.
4. A note typed **offline** lands on the next trigger (app restart with network, or opening that
   item in the Viewer once online). Documented behavior, not a bug. No WorkManager, no timers.
5. Note added while still uploading: synced after upload confirmation + next trigger (typically the
   boot retry). This is option A's accepted delay window (D2).

### D6 — Territory scoping: v0.13 ships Viewer-only (grid work DEFERRED)

The committed spec's GalleryScreen grid indicator + long-press-to-edit are **deferred to a
follow-up**: GalleryScreen is another agent's active territory (their Junk Sweeper work is
uncommitted in the tree, and a future multi-select may also want long-press). Deferring avoids a
three-way merge on a hot file for a cosmetic indicator. Explicit scope decision for the owner to
confirm (open question 2).

### D7 — Album/claimed photos out of scope

Notes exist for the owner's own library. Shared-album media rows are excluded from syncing by the
`EXCLUDE_ALL_SHARED` pattern (`NOT EXISTS (SELECT 1 FROM album_media am WHERE am.media_id =
media.id)`) in `getPendingNoteSync`, and the Viewer refuses to save a note on such a row with an
alert ("Notes apply to your own backed-up photos") — editing a family member's message caption
would be forbidden by Telegram anyway (`MESSAGE_EDIT_FORBIDDEN`). A tiny `isSharedAlbumMedia(id)`
query (new, end of queries.ts) powers the Viewer check.

### D8 — Schema sequencing: v8 stacks on the sibling's uncommitted v7

`SCHEMA_V7` (junk_findings) is the sibling agent's uncommitted v0.12 work already in the tree.
This plan appends `SCHEMA_V8` **after** it and `{ version: 8, up: SCHEMA_V8 }` after v7 in
`MIGRATIONS` — pure addition, no edits to v7 lines. Commit-order proposal: the sibling commits
v0.12 (v7) first; **then** this feature's v0.13 commit contains only the v8 lines of schema.ts.
Owner decision (open question 3). `db/index.ts` needs no change (generic runner).

```sql
-- SCHEMA_V8 (F3 photo journaling, docs/PLAN-F3-JOURNALING.md)
ALTER TABLE media ADD COLUMN note_text TEXT;
ALTER TABLE media ADD COLUMN note_synced INTEGER NOT NULL DEFAULT 0;
```

`note_synced = 0` means "a local note (or a note removal) Telegram has not confirmed yet";
`note_synced = 1` means Telegram confirmed the caption matches. No index needed (pending set is
tiny; queries filter on scanned columns).

### D9 — Build: ONE gradle rebuild, coordinated with the sibling's F2

The new native `editMessageCaption` method needs exactly one gradle rebuild after the patch entry
lands (JS/SQLite-only iterations afterwards need none). The sibling's F2 (new npm native dep
expo-background-task) ALSO needs a rebuild — propose a **single combined rebuild** if timing
aligns (owner arbitrates the one-build-at-a-time slot on the 8 GB machine; keep
`org.gradle.parallel=false`, `workers.max=2`, arm64-only). The patch is applied to node_modules by
running `node scripts/patch-tdlib.js` once after the entry is added (idempotent; postinstall
re-applies it forever).

### A1 — `getPendingNoteSync` refinement (deliberate deviation from the dispatch note)

The dispatcher sketched `note_text NOT NULL AND note_synced = 0`. This plan drops the `NOT NULL`
so note **removals** (D1: caption restored to fileName) also get a retry path — otherwise a
removed note leaves the old note sitting in Telegram forever with no retry. Final predicate:
`note_synced = 0 AND state = 'synced' AND remote_chat_id IS NOT NULL AND remote_message_id IS NOT
NULL AND visibility != 'trashed'`. The sync action branches on `note_text`: non-null → push note
as caption; null → restore `file_name` caption. `visibility != 'trashed'` avoids editing captions
of items about to be purged.

### A2 — Preview rows: no DB marker exists (verified)

`schema.ts` has no preview flag; the uploader records only the ORIGINAL in `remote_message_id` and
previews never become media rows. Assumption: **`remote_message_id` always points at the
original.** Defensive belt: if a read-back caption ever ends with the preview suffix, treat it as
a read-back failure and defer (never edit a preview caption).

### A3 — UI shape (dispatch-conformant)

- New **"Note" ActionChip** (`pencil-outline`; fallback icon `chatbox-outline` if the glyph looks
  wrong on device), inserted in the chip row after "Back up", before "Archive". Always enabled
  when a row is showing (local-only rows save locally and sync later per D2-A); the save flow
  applies the shared-row guard (D7).
- **Meta sheet:** a Pressable note block below the "Backup" MetaRow — key "Note", value = note
  text (`numberOfLines={3}`) or "None — tap to add", suffixed " · pending" while `note_synced = 0`.
  Tap opens the editor.
- **NoteEditorModal** = separate component at the END of ViewerScreen.tsx with its own small
  `noteStyles` StyleSheet (the existing `styles` block is NOT edited — merge surface with the
  sibling's planned Favorites heart toggle). Modal: transparent backdrop, centered card, multiline
  `TextInput` (`maxLength = 1000`, char counter `n/1000`, autoFocus, `textAlignVertical: "top"`),
  buttons Save / Remove (only when a note exists) / Cancel. Every ViewerScreen edit is a separate
  comment-marked region: (1) one chip line in actionsBar, (2) one note block in the meta sheet,
  (3) one contiguous state+handlers block in the component body, (4) component + noteStyles at end.

## 3. Task breakdown (ordered; each task lands green)

### Task 1 — patch-tdlib.js: the editMessageCaption insert entry (4-part pattern)

- File: `scripts/patch-tdlib.js` — append ONE new group of 4 entries to `insertPatches` (after the
  getForumTopicHistory entries, before the array closes), reusing the proven anchors verbatim
  (`getMessageThreadHistory` anchors in all four files) so the insert order is
  getForumTopics → getForumTopicHistory → editMessageCaption:
  1. `TdLibModule.java` (marker `public void editMessageCaption(`):
     ```java
     @ReactMethod
     public void editMessageCaption(double chatId, double messageId, String caption, Promise promise) {
         try {
             if (client == null) {
                 promise.reject("CLIENT_NOT_INITIALIZED", "TDLib client is not initialized");
                 return;
             }
             TdApi.EditMessageCaption request = new TdApi.EditMessageCaption(
                 (long) chatId,
                 (long) messageId,
                 null,
                 new TdApi.FormattedText(caption, new TdApi.TextEntity[0]),
                 false
             );
             client.send(request, object -> {
                 WritableMap result = Arguments.createMap();
                 result.putString("raw", gson.toJson(object));
                 promise.resolve(result);
             });
         } catch (Exception e) {
             promise.reject("EDIT_MESSAGE_CAPTION_ERROR", e.getMessage());
         }
     }
     ```
  2. `index.js` (marker `editMessageCaption: TdLibModule.editMessageCaption,`): register on the
     export object.
  3. `index.d.ts` method decl (marker `export function editMessageCaption(`):
     `editMessageCaption(chatId: number, messageId: number, caption: string): Promise<TdRawResult>;`
  4. `index.d.ts` default-export line (marker `editMessageCaption: typeof editMessageCaption;`).
- Then run `node scripts/patch-tdlib.js` once and confirm all four "[patch-tdlib] inserted" lines;
  re-run to confirm idempotent no-ops. NEVER edit node_modules directly.
- Acceptance: the four files contain the method/registration/typings; script re-run is a no-op;
  `npx tsc --noEmit` clean.
- Risk: low — byte-for-byte the proven getForumTopics pattern with a verified TdApi constructor.

### Task 2 — schema.ts v8 (PROTECTED — owner approval gate)

- File: `src/db/schema.ts` ONLY. Append `SCHEMA_V8` (SQL in D8) + `{ version: 8, up: SCHEMA_V8 }`.
  Touch nothing in v7 or earlier. Tell the owner: additive-only, two ALTERs, no data rewrite,
  downgrade impossible (SQLite), stacks on the sibling's uncommitted v7 (D8 sequencing).
- Acceptance: `tsc` clean; on-device migration log shows v7→v8; DB pull check:
  `PRAGMA table_info(media)` includes `note_text` and `note_synced`, `meta.schema_version = '8'`,
  all existing rows unchanged.
- Risk: low.

### Task 3 — queries.ts: note CRUD at end of file (+ MediaRow fields)

- File: `src/db/queries.ts` (NOT protected). Two separate regions:
  1. `MediaRow` interface (line ~6): add `note_text?: string | null;` and `note_synced?: number |
     null;` (optional — `SELECT *` supplies them post-v8; optional keeps every other consumer
     compiling). Marked with a one-line comment.
  2. End of file (after `pageSweepCandidates`, ~line 962 — clearly separated from the sibling's
     junk_findings CRUD at ~870–960), all marked `// F3 notes (docs/PLAN-F3-JOURNALING.md)`:
     - `setMediaNote(id: number, text: string | null)` → `UPDATE media SET note_text = ?,
       note_synced = 0, updated_at = ? WHERE id = ?` (null = pending removal, A1).
     - `setNoteSynced(id: number)` → `note_synced = 1`.
     - `getPendingNoteSync(limit = 50)` → rows per A1's predicate, selected columns:
       `id, remote_chat_id, remote_message_id, note_text, file_name, mime_type`.
     - `isSharedAlbumMedia(id: number): Promise<boolean>` → `SELECT 1 FROM album_media WHERE
       media_id = ? LIMIT 1`.
- Acceptance: `tsc` clean; app behaves exactly as before (nothing calls the new functions yet).
- Risk: low — UI untouched so zero regression surface.

### Task 4 — new `src/lib/notes.ts`: wrapper + guard + sync loop

- New file (NOT protected; ~120 lines; mirrors `forum.ts` conventions: local `firstDefined`,
  local raw-parse that KEEPS error objects — see D4). Exports:
  - `applyNoteToRemote(row)` (internal): openChat → getMessage read-back → D3 guard → D4
    content-type guard → `TdLib.editMessageCaption(chatId, messageId, noteText ?? row.file_name ??
    "")` → on success (incl. not-modified) `setNoteSynced(row.id)`; on failure log + leave pending.
    Read-back failure or foreign caption → defer (foreign captions are only overridden after the
    Viewer's explicit confirm, which passes a `force: true` flag).
  - `syncPendingNotes(): Promise<{ pushed: number; deferred: number; failed: number }>` — fetch
    `getPendingNoteSync()`, process sequentially (tiny volumes; never parallel TDLib writes),
    return counters.
  - `saveViewerNote(row, text, force)` — Viewer entry point: shared-row guard (D7 alert),
    `setMediaNote(row.id, text)`, then best-effort `applyNoteToRemote` when the row is synced with
    remote ids; returns a small result for the toast.
- Imports ONLY: `react-native-tdlib`, `../db/queries`, `./uploadFormat`. **No uploader.ts import.**
- Acceptance: `tsc` clean; live in Task 7. Risk: medium — TDLib error-string for
  MESSAGE_NOT_MODIFIED not yet observed live; mitigated by the case-insensitive "not modified"
  match + keep-local fallback for everything unrecognized.

### Task 5 — ViewerScreen.tsx: Note chip, meta block, editor modal (4 marked regions)

- File: `src/screens/ViewerScreen.tsx` (clean in git; every edit a self-contained region per A3):
  1. actionsBar: `<ActionChip label="Note" icon="pencil-outline" onPress={openNoteEditor} />`
     after the "Back up" chip.
  2. Meta sheet: Pressable note block after the Backup MetaRow (shows note text / "None — tap to
     add" / " · pending").
  3. Component body (one contiguous block): `noteEditorFor: number | null` state + `draft` text +
     handlers (`openNoteEditor` seeds the draft from the current row, `saveNote` →
     `saveViewerNote` → toast on failure → refresh row via `getMediaByIds`, `removeNote` →
     `saveViewerNote(row, null, force)`), plus the D5.3 open-trigger: after rows load, if any
     loaded synced row has `note_synced === 0`, fire `syncPendingNotes()` then refresh rows.
  4. End of file: `NoteEditorModal` component + `noteStyles` (own StyleSheet; existing `styles`
     untouched — sibling heart-toggle merge safety).
- Acceptance: `tsc` clean; chip opens the editor on any item; Save on a synced photo updates the
  Telegram caption within seconds; Cancel discards; counter caps at 1000 chars.
- Risk: low-medium (shared file — mitigated by the four-region rule).

### Task 6 — App.tsx boot retry (separate region)

- File: `App.tsx` (sibling-touched): one import line + a SECOND small `useEffect` below the
  existing one — same `phase === "ready"` gate, body `void syncPendingNotes().catch(() => {})`.
  The sibling's effect body is not edited.
- Acceptance: `tsc` clean; boot log shows the sync run; pending notes from an offline session push
  on restart.
- Risk: low.

### Task 7 — Combined gradle rebuild + device verification + docs

- Rebuild per D9 (coordinate the single slot with the sibling's F2 rebuild; if not aligned, take
  the slot alone — it is the only rebuild this feature needs). Install APK (never mid-upload;
  check logcat first), Metro 8083 (`--host lan` rules), then run the §5 checklist.
- Update `NEXT_SESSION.md` §0 (state + "notes are captions" fact + pending-id/MESSAGE_ID_INVALID
  note). CHANGELOG v0.13 entry drafted but committed only with owner approval.

## 4. Files to touch

| File | Change | Protected |
|---|---|---|
| `scripts/patch-tdlib.js` | one 4-part insert entry group (Task 1) | no |
| `src/db/schema.ts` | additive SCHEMA_V8 (Task 2) | **YES — owner approval gate** |
| `src/db/queries.ts` | MediaRow + 2 fields; 4 new functions at EOF (Task 3) | no |
| `src/lib/notes.ts` | NEW: wrapper, guards, syncPendingNotes, saveViewerNote (Task 4) | no |
| `src/screens/ViewerScreen.tsx` | 4 marked regions: chip, meta block, handlers, modal (Task 5) | no |
| `App.tsx` | boot retry effect, separate region (Task 6) | no |
| `CHANGELOG.md`, `NEXT_SESSION.md` | docs at verification/commit time | tracked docs |

Untouched by design: `src/lib/uploader.ts` (HARD RULE), `src/lib/tdlib.ts`, `src/lib/qrLink.ts`,
`src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`, `src/db/index.ts`, `app.config.ts`,
`src/screens/GalleryScreen.tsx` (D6 deferral), navigation (no new routes — modal lives in
ViewerScreen), everything in `..\photogram-bot`.

## 5. Risks & edge cases

1. **Offline typing** — save is local-first (`setMediaNote` before any TDLib call); sync happens
   on a later trigger (D5). Typed text is never lost.
2. **Stale pending message ids** (stored id off by one from the real message, v0.5 signature) —
   the edit fails `MESSAGE_ID_INVALID` → D4 keep-local + log; the restorer's existing id self-heal
   can correct `remote_message_id`, after which the next trigger retries with the fixed id.
3. **Caption length** — Telegram's media-caption limit is ~1024 chars; the UI caps at
   `maxLength = 1000` (A3). The sync path sends only what the DB holds, which only the editor
   writes — no server-side truncation risk in practice.
4. **findSentMessage regression** — with option A, send-time captions are untouched (still
   fileName), so matching is byte-identical; acceptance item 9 proves it on device.
5. **MESSAGE_NOT_MODIFIED exact string unverified** — matched case-insensitively on "not
   modified"; unknown strings fall into keep-local+retry (safe direction).
6. **Foreign captions** — never overwritten without the explicit confirm (D3); boot loop defers.
7. **Concurrent caption edits** (owner edits caption in Telegram Desktop while the app pushes) —
   last write wins; the D3 guard makes the app-side surprise explicit.
8. **Shared-album rows** — excluded in SQL (A1/D7) and blocked in the Viewer save flow.
9. **Sibling merge surface** — ViewerScreen is clean today and its edits land first (open question
   4); queries.ts additions are end-of-file; App.tsx/schema.ts additions are separate regions.

## 6. Device acceptance checklist (Viewer path — no long-press needed in v0.13)

- [ ] Prereq: rebuilt APK installed (combined rebuild per D9), Metro 8083, DB migrated to v8
      (`meta.schema_version = '8'`; `note_text`/`note_synced` in `PRAGMA table_info(media)`).
- [ ] Open a synced photo in Viewer → Note chip → type "Emma's first steps" → Save → within
      seconds the caption in the Telegram app (Saved Messages) shows the note; DB `note_synced=1`.
- [ ] Meta sheet shows the note; force-stop + relaunch → note persists from the DB (no refetch).
- [ ] Airplane mode → add note → local save + "pending" marker, no crash; back online, relaunch
      (or reopen the item) → boot/open push flips `note_synced` to 1 and Telegram shows the note.
- [ ] Replace-caption guard: hand-caption a message in Telegram first → set its note in Photogram
      → "Replace the caption 'X'?" dialog; Cancel changes nothing; Confirm pushes the note.
- [ ] Save the exact same note twice → second attempt is silent success (not-modified path).
- [ ] Note on a never-backed-up (local-only) photo → saves locally, no TDLib call, no crash; after
      that item is backed up and the next trigger fires, the caption edits to the note.
- [ ] Remove: set a note, then Remove → caption reverts to the fileName in Telegram after the next
      trigger; `note_text` is NULL.
- [ ] Shared-album photo (from a claimed album) → Note → alert, no Telegram edit attempted.
- [ ] Regression: back up a NEW photo → arrives in Saved Messages with its fileName caption, queue
      drains, state flips to synced exactly as before (findSentMessage matching intact).
- [ ] `getPendingNoteSync` via DB pull: only `note_synced=0` synced rows with remote ids appear.

## 7. Assumptions & open questions for the owner

1. **D2 — Option A confirmed** (sync-after caption edit; zero uploader.ts changes; brief
   fileName-caption window before a note lands on a just-uploaded item). Option B (uploader edit)
   stays rejected until the bulk backup is done and only if the owner asks.
2. **D6 — v0.13 ships Viewer-only** (no grid indicator, no long-press) — grid polish deferred to a
   follow-up once GalleryScreen's territory frees up. Confirm.
3. **D8 — Commit sequencing**: sibling commits v0.12 (schema v7) first; this feature's v0.13
   commit then contains only the v8 lines. Confirm the ordering and the v0.13 version label.
4. **ViewerScreen edit order vs the sibling's Favorites heart toggle** — proposal: this feature's
   Viewer edits land first (ViewerScreen is currently clean in git), then the heart toggle stacks.
   Confirm.
5. **D9 — Build slot timing**: single combined gradle rebuild with the sibling's F2 if timing
   aligns, else this feature takes its own slot. Owner arbitrates.
6. **A1 refinement**: note REMOVAL also syncs (caption restored to fileName, retried like a note
   push). Confirm this matches the owner's mental model of "removing" a note.
