# Photogram — Feature Plan v0.11 → v0.16

Status: PLAN ONLY (no code written). Prepared 2026-09-01.
Companion reading: `NEXT_SESSION.md` (current in-flight state), `docs/PLAN-S9-TOPICS.md` (format precedent), `CHANGELOG.md` (version discipline).

---

## 0. The request (quoted)

> Plan the next 6-feature batch for Photogram, one feature per version v0.11 through v0.16, in exactly this order:
> - F1 (v0.11) One-tap phone migration
> - F2 (v0.12) Junk Sweeper
> - F3 (v0.13) Photo journaling
> - F4 (v0.14) Family-visible backup heartbeat
> - F5 (v0.15) Time Machine ("On this day")
> - F6 (v0.16) Search by vibe
>
> Constraints: TDLib fire-and-forget (typed native wrappers only), additive schema via new migration versions, protected files (`src/lib/tdlib.ts`, `src/lib/qrLink.ts`, `src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`, `src/db/schema.ts` + `src/db/index.ts`, `app.config.ts`) must not be redesigned, do not touch `src/lib/uploader.ts` mid-bulk-backup, 1.5 GB/day throttle is by design, Metro port 8083 only, never touch `E:\Opencode CLI\Projects\photogram-bot`, secrets stay gitignored, every version needs a CHANGELOG entry, no commits without owner approval, verify Expo SDK 57 APIs at https://docs.expo.dev/versions/v57.0.0/.

Note: **v0.10 is RESERVED** for the S9 topics work currently built but uncommitted, pending device verification (see `NEXT_SESSION.md`). Nothing in this plan starts until S9 is verified and committed.

---

## 1. Executive summary (plain language)

Photogram already backs up the owner's phone photos to their own Telegram (Saved Messages) and re-claims shared family albums. The next six versions make the app feel finished: it should survive a new phone (F1), help clean out junk (F2), let the owner write memories onto photos (F3), tell the family "your photos are safe" with one tap (F4), resurface old memories (F5), and find photos by feel — "beach", "sunset" — without typing file names (F6).

The guiding rule for all six: **add, don't rewrite**. Every feature is a new module plus small additive database migrations; the proven engines (scanner, uploader, claimer, restorer, QR login) are reused as-is.

### Order / gates table

| Version | Feature | Opt-in? | Protected files touched? | New native wrapper? | New npm deps (verified) | Effort |
|---|---|---|---|---|---|---|
| v0.11 | F1 One-tap migration | User-triggered only (no toggle needed) | **NO** — reuses LoginScreen/authStore/qrLink as-is | **NO** — existing typed wrappers suffice (getChatHistory, getMessage, downloadFileByRemoteId) | none | **L** |
| v0.12 | F2 Junk Sweeper | **Opt-in** | **YES** — `src/db/schema.ts` (additive migration v7) | NO | expo-background-task 57.0.15 + expo-task-manager + jpeg-js | **L** |
| v0.13 | F3 Photo journaling | Default-on UX, user-initiated per photo | **YES** — `src/db/schema.ts` (additive migration v8) | **YES** — `TdApi.EditMessageCaption` via `scripts/patch-tdlib.js` | none | **M** |
| v0.14 | F4 Heartbeat share | Display default-on; share is one tap | NO | NO | none (uses built-in React Native `Share` API) | **S** |
| v0.15 | F5 On this day | Default-on (same as Memories) | NO | NO | none | **M** |
| v0.16 | F6 Search by vibe | **Opt-in** (model download disclosure) | **YES** — `src/db/schema.ts` (additive migration v9) | NO (TFLite runs via its own JSI module, not TDLib) | react-native-fast-tflite 3.0.1 | **L** |

Total effort shape: **two S/M releases in the middle (v0.13, v0.14, v0.15) bookended by three large ones (v0.11, v0.12, v0.16)**. Roughly: F1 ~2 sessions, F2 ~2–3 sessions (heuristics tuning dominates), F3 ~1 session + one gradle rebuild, F4 ~half a session, F5 ~1 session, F6 ~2–3 sessions (model sourcing spike dominates).

Dependency note: F2 and F6 share the new background-task infrastructure (section 3), so v0.12 must land before v0.16.

---

## 2. Feature sections

### F1 — One-tap phone migration (v0.11)

**Goal (plain language).** When the owner gets a new Android phone, Photogram should be able to rebuild itself: they log in with the same Telegram account (QR, exactly like today), the app notices their backup already exists in Saved Messages, rebuilds its photo index from Telegram, restores the actual photo files to the new phone's gallery at the owner's pace, and re-links the shared family albums. One screen, one progress bar ("Restoring 3.2 GB…").

**Two paths considered.**
- **Path A (RECOMMENDED): fresh install + QR login + rebuild from Telegram.** The new phone treats Saved Messages as the source of truth: walk the Saved Messages history, rebuild the local `media` table rows (state `synced`, remote ids recorded), then optionally re-download files to the device gallery, and re-claim shared albums via the existing claim engine.
- **Path B (REJECTED): direct local transfer of `photogram.db` + downloaded files.** Why rejected: (1) TDLib's own session database is not designed to be copied between devices — auth state, database keys, and file paths can invalidate, and Photogram does not control that layout; (2) Android 10+ scoped storage and restricted adb backups make app-private data transfer unreliable without root; (3) even a valid `photogram.db` copy carries `local_uri` values pointing at files that do not exist on the new phone, so every row needs re-resolution anyway — which is exactly what Path A does; (4) Path A reuses device-verified engines (`restorer.ts` restore flow, `claimer.ts` extract, `TdLib.downloadFileByRemoteId`) with **zero new TDLib calls**.

**Opt-in vs default.** User-triggered only. Trigger points: (a) after fresh login, if the `media` table is empty and Saved Messages contains Photogram uploads, show a one-time "Restore your backup" banner on GalleryScreen; (b) a permanent "Migrate from another phone" entry in SettingsScreen. No settings toggle required.

**Design — MigrateScreen phases:**
1. **Inventory** (new `src/lib/rehydrate.ts`): `TdLib.createPrivateChat(self)` then page `getChatHistory` (existing typed wrapper) oldest-newest; reuse `extractMedia(message)` from `src/lib/claimer.ts` on each message; count items + aggregate bytes from `file.expectedSize` (firstDefined camel/snake, ids as TEXT). Show "Found 2,431 photos, 14.2 GB in your Telegram backup."
2. **Index rebuild**: insert rows into `media` with `state='synced'`, `remote_chat_id`/`remote_message_id`, `byte_size`, `taken_at` = message date (EXIF arrives only after download; `repairTakenAtUnits` pattern stays authoritative for units), fingerprint from quickFingerprint where derivable; dedupe on remote message id. Local `local_uri` stays null until step 3.
3. **Restore (optional, paced)**: enqueue `restoreMediaToDevice(mediaId, onProgress)` per row (existing `src/lib/restorer.ts`, including its pending-id self-heal). Aggregate progress bar "Restoring 3.2 GB — 1.1 GB done". Downloads are user-initiated and not subject to the 1.5 GB/day upload throttle (that throttle is upload-side by design).
4. **Re-link shared albums**: list the account's groups via `listMyGroups()` (`src/lib/chats.ts`) + `getChat`/`getSupergroup` forum checks (existing wrappers), let the owner pick the family albums, then run the existing `claimAlbumMedia` per album with fresh cursors. (ASSUMPTION — verify during implementation whether album identity is detectable automatically, e.g. by an album marker/naming convention; default is the manual picker above.)

**Additive schema changes:** none. The database on the new phone is fresh; the existing generic migration runner in `src/db/index.ts` builds it from v1. Only a `meta` key (`last_migration_at`) if needed — no schema version bump.

**New TDLib wrappers:** none. Uses existing typed wrappers: `createPrivateChat`, `getChatHistory`, `getMessage`, `downloadFileByRemoteId`.

**New npm/native deps:** none.

**Screens/UI changes:** new `src/screens/MigrateScreen.tsx` (phase list + progress); GalleryScreen empty-state banner; SettingsScreen entry; `src/navigation/index.tsx` new route `Migrate`. LoginScreen QR flow reused untouched.

**Expected files:** `src/lib/rehydrate.ts` (new), `src/screens/MigrateScreen.tsx` (new), `src/navigation/index.tsx` (add route), `src/screens/SettingsScreen.tsx` (entry row), `src/screens/GalleryScreen.tsx` (banner when `total === 0` and backup detected), possibly export `extractMedia` from `src/lib/claimer.ts` if not already exported.

**PROTECTED-FILES-TOUCHED: NO.** `LoginScreen.tsx`, `authStore.ts`, `qrLink.ts` are consumed as-is; `schema.ts`/`db/index.ts` untouched.

**Risks & edge cases:**
- Old phone still uploading (throttled): new phone sees a partial backup — MigrateScreen must show "N items still backing up on your old device — Re-run inventory" and support re-runs (inventory is idempotent by remote message id).
- Stale pending message ids recorded by the old uploader: handled by restorer's `fetchMessage` filename fallback + `updateRemoteMessageIdById` self-heal (already in `src/lib/restorer.ts`).
- Mixed content types (messagePhoto vs messageDocument vs messageAnimation): `extractMedia` already handles all; inventory must count and label each.
- Restored files re-scanned by scanner: fingerprint dedupe prevents duplicate rows; verify restored asset URIs are set via `setLocalUri` before the scanner runs (restore does this; ensure migration pass pauses auto-scan until index rebuild completes).
- TDLib must finish loading the Saved Messages chat before history pages fully populate — reuse the open-chat + retry pattern from `restorer.ts` `fetchMessage`.

**Device acceptance checks (NEXT_SESSION item-5 style):**
- [ ] Fresh-install path: log in via QR on a device with empty gallery → banner appears → MigrateScreen inventory count matches the number of media messages in Saved Messages (spot-check against Telegram app).
- [ ] After index rebuild, Gallery shows items with cloud/not-local state; heartbeat total matches old phone's heartbeat.
- [ ] Tap restore on a photo → file appears in device gallery, row becomes local; progress bytes advance.
- [ ] Restore 100+ items → aggregate "Restoring X GB" bar tracks; app stays responsive; kill + relaunch mid-restore → resume works (no duplicate rows).
- [ ] Re-link one family album → claim re-runs, album timeline fills, cursor min-of-newest respected (no re-claim of old items).
- [ ] Re-run inventory after old phone uploads more → only new items added, zero duplicates.

**Effort: L** (~2 sessions: rehydrate engine, MigrateScreen, banner, album re-link, device testing across two devices/emulator + real phone).

---

### F2 — Junk Sweeper (v0.12)

**Goal (plain language).** Photogram quietly finds the photos you'd delete yourself — blurry shots, accidental pocket pictures, near-identical bursts, screenshots from months ago — and asks "Delete 87 junk photos?" with a review screen where every photo can be kept or deleted, category by category. It only ever deletes the local file, and only when Photogram is certain the photo is already safe in Telegram.

**Opt-in vs default.** **Opt-in**, off by default. Why: the feature deletes files based on heuristics — trust must be earned, and scanning costs battery/storage reads. First toggle-on shows a plain-language explainer ("Photogram looks at your photos on this phone only. Nothing is deleted without your review. Telegram keeps the original."). Weekly auto-sweep is part of the same opt-in.

**Detection heuristics (all on-device, computed on the existing 320 px thumbnails):**
- **Blurry**: variance of Laplacian over grayscale pixels below threshold. Needs raw pixel access: decode thumbnail JPEG with `jpeg-js` (pure JS, no native module; 320 px decodes in tens of ms).
- **Pocket / accidental**: mean luminance very low (near-black "lens covered" frames) plus high local noise; also extreme-crop aspect checks.
- **Near-duplicate**: pHash — 32x32 grayscale, DCT, 64-bit hash; group images with Hamming distance ≤ 8 within the same day; keep the largest `byte_size` as leader, others become findings.
- **Stale screenshot**: rows already tagged `screenshot` by `autoTagsFor` in `src/lib/scanner.ts` whose `taken_at` is older than 90 days.

**Additive schema changes (migration v7 in `src/db/schema.ts`, SCHEMA_V7 following the SCHEMA_V6 pattern):**
```sql
CREATE TABLE junk_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('blurry','pocket','near_duplicate','stale_screenshot')),
  score REAL,
  detail TEXT,            -- e.g. leader media_id for near-dup groups
  group_key TEXT,         -- near-dup group id, null otherwise
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','kept','deleted'))
);
CREATE INDEX idx_junk_findings_status ON junk_findings (status, category);
CREATE INDEX idx_junk_findings_media ON junk_findings (media_id);
```
"Keep" is recorded as `status='kept'` in the same table — the sweeper skips media_ids that already have any `kept` row, so a kept photo is **never re-suggested**. Dismissals therefore need no separate table. Sweeping is resumable: process thumbnails in chunks (e.g. 500 per run), tracking progress by last-scanned media id in `meta`.

**New TDLib wrappers:** none.

**New npm/native deps (SDK 57 verified):** `expo-background-task` 57.0.15 (peer `expo: *` — compatible) + `expo-task-manager` (its companion) for the weekly auto-sweep; `jpeg-js` for pixel decoding. No new native build beyond the background-task autolink (dev-client rebuild once).

**Background behavior:** weekly auto-sweep uses the shared maintenance task (section 3). In-task gates before any work: charging (checked via `expo-battery`, already installed — WorkManager's own charging constraint is not relied on), opt-in flag on, and a 7-day MMKV timestamp gate. WorkManager periodic tasks run at best-effort (≥15 min minimum interval, only when app is backgrounded, OEM battery optimization may delay) — the manual "Sweep now" button guarantees testability and is the primary path.

**Screens/UI changes:**
- New `src/screens/JunkSweeperScreen.tsx`: summary header ("Delete 87 junk photos? 1.2 GB"), one section per category with select-all-per-category checkbox, per-photo thumbnail + keep/delete toggle, and a "not yet backed up" badge that disables deletion for `state !== 'synced'` rows.
- SettingsScreen: opt-in toggle + "Sweep now" entry (follows the existing `Section`/toggle pattern, `settingsStore.ts` MMKV zustand: new keys `junkSweeperEnabled`).
- GalleryScreen: optional small result pill after a manual sweep ("87 junk photos found").

**Deletion semantics (the safety-critical part):** a row is deletable only if `state = 'synced'` AND `hasRemoteCopy(row)` (existing helper in `src/lib/restorer.ts`). Deletion calls the existing `deleteLocalCopyOnly(id, localUri)` from `src/lib/trash.ts` (file delete + `clearLocalUri`), then marks the finding `deleted`. The Telegram copy is the undo — there is **no** Photogram trash stage for junk (deliberate; Trash screen semantics remain Telegram-side deletes). The confirmation dialog repeats this in plain language.

**Expected files:** `src/lib/imageAnalysis.ts` (new, shared — section 3), `src/lib/junk.ts` (new: sweep engine, thresholds, chunked runner), `src/screens/JunkSweeperScreen.tsx` (new), `src/db/schema.ts` (v7), `src/db/queries.ts` (findings CRUD: upsertFinding, listFindingsByCategory, setFindingStatus, hasKeptFinding), `src/store/settingsStore.ts`, `src/screens/SettingsScreen.tsx`, `src/navigation/index.tsx`, `src/lib/backgroundTask.ts` (new, shared — section 3).

**PROTECTED-FILES-TOUCHED: YES — `src/db/schema.ts` only** (appenditive SCHEMA_V7; `db/index.ts` needs no change, its runner iterates `MIGRATIONS` generically).

**Risks & edge cases:**
- False positives (an intentionally artistic blurry shot): conservative thresholds, always-review flow, and permanent "keep" are the mitigations; log category + score in `detail` for later threshold tuning.
- Performance: full library ≈ 13k items × ~30–80 ms decode+analyze → hours; mitigated by chunked background runs and per-run budget. Never block the uploader loop (`src/lib/uploader.ts` untouched).
- Thumbnails may be missing for older rows: generate on demand via `makeThumbnail` (section 3) or skip and revisit next sweep.
- Videos: v0.12 scope is photos only for blur/pocket/near-dup (video thumbs are analyzed only for staleness tags). State this in the UI.
- WorkManager OEM delays: acceptance relies on manual sweep, not on timing.

**Device acceptance checks:**
- [ ] Toggle on in Settings → explainer shown once; toggle persists across app restart (MMKV).
- [ ] Plant test set on device (a blurry photo, a near-black pocket shot, 3 burst near-duplicates, an old screenshot) → manual sweep finds all four categories with correct grouping; leader kept in near-dup group.
- [ ] "Keep" a blurry artistic photo → re-run sweep → it never reappears.
- [ ] Delete one junk photo → local file gone from device gallery, photo still visible in Photogram via its Telegram copy, still present in Saved Messages in the Telegram app.
- [ ] Airplane-mode test: a photo still uploading (`state != 'synced'`) shows "not yet backed up" and cannot be selected.
- [ ] Batch delete 87 items → progress feedback, zero crashes, `media` rows now `local_uri = null` but retained with remote links.

**Effort: L** (~2–3 sessions; heuristic threshold tuning on real libraries dominates).

---

### F3 — Photo journaling (v0.13)

**Goal (plain language).** Long-press any backed-up photo in Photogram and write a note — "Emma's first steps". The note is saved as that photo's caption in Telegram (so it survives forever and is visible from any Telegram client), and cached in Photogram's database so the gallery shows it instantly with a small indicator.

**Opt-in vs default.** No toggle — the feature only acts when the owner long-presses and types. Grid indicator and Viewer display are default-on.

**New TDLib wrapper (REQUIRED — the only one in this batch):** `editMessageCaption`.
- `TdApi.EditMessageCaption` **exists** in the bundled TDLib jar (verified: `TdApi$EditMessageCaption.class` in `node_modules\react-native-tdlib\android\build\intermediates\javac\...\org\drinkless\tdlib\`), but no typed wrapper exists in `node_modules/react-native-tdlib/index.d.ts`.
- Add **one insert entry** to `scripts/patch-tdlib.js` copying the 4-part getForumTopics pattern exactly: (1) `TdLibModule.java` `@ReactMethod editMessageCaption(double chatId, double messageId, String caption, Promise promise)` constructing `new TdApi.EditMessageCaption()` with `chatId`, `messageId`, and `caption = new TdApi.FormattedText(text, new TdApi.TextEntity[0])`, sending via `client.send(request, object -> { ... gson.toJson(object) ... })` and parsing `@type === "error"` on the JS side; (2) `index.js` module registration; (3)+(4) `index.d.ts` method declaration + default-export typing.
- JS-side wrapper lives in a new `src/lib/notes.ts` (NOT in protected `src/lib/tdlib.ts`), following the `src/lib/forum.ts` `parseRawResult`/`firstDefined` conventions. Read-back uses the existing `TdLib.getMessage` wrapper.
- **Requires one gradle rebuild** after patching (same as S9 topics work — coordinate so only one rebuild is needed if they land close together).

**Caption composition decision (load-bearing):** the uploader (`src/lib/uploader.ts` — DO NOT TOUCH) sends `caption = fileName` and `findSentMessage` matches by caption containing fileName. Decision: when a note is set, **the photo's caption in Telegram becomes the note itself** (clean caption the owner sees everywhere), accepting that the restore-time *filename fallback* for photos degrades (documents/videos/animations keep `fileName` in TDLib document metadata, which `messageContentFileName` reads first — unaffected). Mitigation: `remote_message_id` is authoritative; the filename fallback only ever rescued stale pending ids, and the DB now stores the note alongside. Alternative rejected: `"<note> — <fileName>"` — preserves matching but pollutes the caption the owner reads in Telegram; revisit only if device testing shows fallback misses.
- **Already-captioned guard:** before editing, read the current caption via `TdLib.getMessage`; if it exists and is not the row's own `fileName` (i.e. the owner hand-captioned it in Telegram), require an explicit confirm in the edit dialog ("Replace the caption 'X'?").

**Additive schema changes (migration v8):**
```sql
ALTER TABLE media ADD COLUMN note_text TEXT;
ALTER TABLE media ADD COLUMN note_synced INTEGER NOT NULL DEFAULT 0;
```
`note_synced = 0` means a local note exists that Telegram has not confirmed yet (offline typed, or caption push failed) — retried on app boot.

**Screens/UI changes:**
- `src/screens/ViewerScreen.tsx`: new ActionChip "Note" beside Share/Save/Back up; note shown as a MetaRow in the existing info modal; edit opens a TextInput modal.
- FlashList grid item (GalleryScreen): small pencil/dot overlay indicator on rows with `note_text`.
- Long-press on a grid tile opens the note editor directly (primary entry).

**Expected files:** `scripts/patch-tdlib.js` (1 insert entry), `src/lib/notes.ts` (new), `src/db/schema.ts` (v8), `src/db/queries.ts` (setMediaNote, getPendingNoteSync), `src/screens/ViewerScreen.tsx`, `src/screens/GalleryScreen.tsx` (grid indicator + long-press), `App.tsx` (boot retry for `note_synced = 0`).

**PROTECTED-FILES-TOUCHED: YES — `src/db/schema.ts` only.**

**Risks & edge cases:**
- TDLib errors on edit: `MESSAGE_NOT_MODIFIED` (same text) → treat as success; `MESSAGE_EDIT_FORBIDDEN` / not found → keep note local with `note_synced = 0` and surface a small error toast; never lose the typed note.
- Offline typing: save locally immediately, sync on boot retry.
- Non-media messages: guard — note editing only for rows with valid remote ids and media content (photo/document/video/animation).
- Telegram allows caption edits on own media messages indefinitely; if TDLib ever rejects an old message, the `note_synced = 0` path covers it.
- Regression check: uploading a NEW photo after notes exist must still be matched by `findSentMessage` (notes do not touch the uploader).

**Device acceptance checks:**
- [ ] After the patched gradle rebuild, long-press a backed-up photo → add note → caption changes in the Telegram app (verify visually in Saved Messages).
- [ ] Restart Photogram → note still shown (read from `media.note_text`, not refetched).
- [ ] Grid shows the note indicator on the edited photo only.
- [ ] Airplane mode: add note → local save, warning shown; go online, relaunch → boot retry pushes caption, `note_synced` flips to 1.
- [ ] Replace-caption guard: hand-caption a message in Telegram first, then edit note in Photogram → confirm dialog appears.
- [ ] Regression: back up a new photo → it appears in Saved Messages with its fileName caption and heartbeat pending count drops to 0 as before.

**Effort: M** (~1 session of code + one gradle rebuild + device verification pass).

---

### F4 — Family-visible backup heartbeat (v0.14)

**Goal (plain language).** One tap produces a shareable, human status line the owner can paste to the family group chat: "Photogram: 14.2 GB safe — 2,431 of 2,431 backed up. Last upload 2 h ago. 0 pending." Numbers only.

**Opt-in vs default.** The heartbeat is already displayed on GalleryScreen (lines ~384–394, fed by `getBackupHeartbeat()` in `src/lib/stats.ts`) — that display stays default-on. The share action is user-initiated. No new toggle.

**Privacy rule (hard):** the share text contains aggregate numbers only — no file names, no paths, no thumbnails, no album names, no contact names. Album counts are NOT included even as an option in v0.14 (deferred until the owner asks).

**Implementation:** new `src/lib/heartbeatCard.ts` composes the text from `getBackupHeartbeat()` (`{ total, synced, lastSyncedAt }`) + pending count (from the uploader's queue state — read via existing exports, no uploader modification) + `formatBytes` (existing in `stats.ts`). Share via React Native's built-in `Share.share({ message })` — **not** `expo-sharing` (that API shares files/URLs; plain-text sharing on Android is the RN Share sheet). Zero new deps.

**Screens/UI changes:** GalleryScreen heartbeat block gains a share icon button; SettingsScreen entry "Share backup status" as a secondary path.

**Expected files:** `src/lib/heartbeatCard.ts` (new), `src/screens/GalleryScreen.tsx` (icon), `src/screens/SettingsScreen.tsx` (entry), `CHANGELOG.md`.

**PROTECTED-FILES-TOUCHED: NO.**

**Risks & edge cases:** heartbeat null (fresh/empty DB) → hide the share button; "2 h ago" formatting on stale timestamps → print absolute date after 48 h; share sheet cancel → no-op. No TDLib calls at all.

**Device acceptance checks:**
- [ ] Tap share on Gallery → Android share sheet opens with the exact status text; sending to WhatsApp/Telegram shows only numbers.
- [ ] Text matches the on-Gallery heartbeat numbers exactly.
- [ ] Fresh install with 0 items → no share button, no crash.

**Effort: S** (half a session including CHANGELOG).

---

### F5 — Time Machine / "On this day" (v0.15)

**Goal (plain language).** Each day, Photogram shows a small card on the gallery: "On this day — 3 years ago — 12 photos". Tapping it opens a full-screen story of everything taken on this month-day across all previous years.

**Opt-in vs default.** Default-on, consistent with the existing Memories/Days surfaces (no toggle precedent there). Suppressible by the user for the session (card long-press → "Hide today").

**Implementation:**
- New `src/lib/onThisDay.ts`. SQL modeled directly on `getMemories()` in `src/lib/memories.ts`, with two differences: (1) day keying uses `strftime('%m%d', taken_at/1000, 'unixepoch', 'localtime')` so the card matches the owner's local calendar; (2) exclude the current year (`strftime('%Y', ...) < strftime('%Y','now','localtime')`). Return grouped `{ year, ids[] }` for the Story screen.
- UI: card above the FlashList in GalleryScreen (same visual slot family as the Rediscover/heartbeat blocks); tap navigates to the **existing** `Story { ids, title }` route — no new screen needed.
- Empty day → no card rendered (never an empty-state screen).
- Timezone note: `src/lib/memories.ts` currently keys by UTC. F5 uses `localtime`; a one-line alignment of `getMemories()` to `localtime` is offered as an optional follow-up (small behavior change — flag to owner, do not bundle silently).

**Additive schema changes:** none (verify `taken_at` has an index; if missing, an additive `CREATE INDEX` may join the v8 or v9 migration — decide at implementation, still additive-only).

**New TDLib wrappers / deps:** none.

**Screens/UI changes:** `src/screens/GalleryScreen.tsx` (card), `src/lib/onThisDay.ts` (new), `src/store/settingsStore.ts` only if a per-day hide needs persistence (prefer session-only state).

**PROTECTED-FILES-TOUCHED: NO.**

**Risks & edge cases:** `taken_at` unit repair (`repairTakenAtUnits` in `App.tsx`) must have run before the card computes — it does (boot order); screenshots taken "today" in previous years will legitimately appear (correct behavior, same as Memories); very large day sets (100+) → Story screen already handles id lists (FlashList).

**Device acceptance checks:**
- [ ] With an old photo taken on today's month-day present → card shows "On this day — N years ago — M photos" and the year math is right.
- [ ] Tap → Story screen shows exactly the prior-years month-day set (current-year photos excluded).
- [ ] Day with no prior-year photos → no card.
- [ ] Cross-check one bucket against the Memories screen count; device set to a non-UTC timezone → day boundary respects local time.

**Effort: M** (one session: query + card + wiring + timezone verification).

---

### F6 — Search by vibe (v0.16)

**Goal (plain language).** Overnight, while the phone charges, Photogram looks at each photo on-device and attaches descriptive tags — "beach", "sunset", "food", "dog". Then the owner can type "beach" in the existing search bar and see their beach photos. No photo ever leaves the phone.

**Opt-in vs default.** **Opt-in** with an explicit first-run disclosure: model size (~15–25 MB), downloaded over Wi-Fi only, all analysis on-device, can be disabled anytime. Why opt-in: a one-time model download plus nightly battery/thermal cost is not something to impose silently.

**Runtime evaluation (done):**
- **react-native-fast-tflite 3.0.1** (verified on npm; JSI/TurboModule-based; compatible with Expo SDK 57's new architecture; needs a dev-client rebuild like any native module). RECOMMENDED for the MVP.
- **onnxruntime-react-native 1.24.3** (verified): viable but heavier, and the CLIP route it enables requires a text encoder + tokenizer + embedding index — real complexity, deferred.
- Rejected for MVP: CLIP embeddings (semantic search is the later, fuzzy-NLU phase); react-native-ml-kit image labeling as primary (already have text-recognition from this family, but label vocabulary control and custom "vibe" mapping is better served by a tflite scene model we choose).

**Model choice (the main spike task of v0.16):**
- Preference: a **Places365-style scene-classification tflite model** (labels: beach, sunset, mountain, food, indoor…) — exactly the "vibe" vocabulary wanted. Must source a known-good `.tflite` + labels file and verify license.
- Fallback: MobileNetV2/V3 ImageNet model + a bundled JSON mapping of ImageNet class ids to friendly tags (seashore→beach, sandbar→beach, lakeside→lake…). Honest limitation: ImageNet has no "sunset" class — the mapping table is curated and incomplete, which is acceptable for an MVP with tag filtering.
- Ship as task T6.1: source model, verify input tensor shape/normalization, measure per-inference latency on the Samsung SM-S942B, and only then build the batch runner.

**Additive schema changes (migration v9):**
```sql
CREATE TABLE media_tags (
  media_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  confidence REAL NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (media_id, tag)
);
CREATE INDEX idx_media_tags_tag ON media_tags (tag);
```
FTS deliberately deferred — `LIKE` over `media_tags.tag` (mirroring `searchMediaRaw` in `src/db/queries.ts`) is sufficient at this scale; FTS can be added additively later.

**Pipeline:** shared background task (section 3), charging-only, Wi-Fi not required (inference is local; only the one-time model download needs Wi-Fi). Per run: fetch rows lacking tags, load thumbnail → resize to model input (e.g. 224x224 via `expo-image-manipulator`, already installed) → run inference → persist top-k labels above a confidence threshold (default 0.35, tunable constant in `src/lib/vibe.ts`). Budgeted per run (e.g. 300 images) and resumable.

**Query integration:** `src/lib/search.ts` `parseDateQuery`/`runSearch` gain a vibe term branch — MVP matches the query against `media_tags.tag` via a small alias map (e.g. "seaside"→beach). No fuzzy NLU in v0.16 (explicitly scoped down; tagged-filtering first).

**Screens/UI changes:** search results in GalleryScreen may show a "tagged: beach" row chip; SettingsScreen section with disclosure dialog, model state (`idle / downloading / ready / failed`), progress, and a disable switch (`settingsStore` keys `vibeSearchEnabled`, `vibeModelState`).

**Expected files:** `src/lib/vibe.ts` (new: runtime wrapper, batch runner, alias map), `src/db/schema.ts` (v9), `src/db/queries.ts` (tag upsert, tagsForMedia, searchByTag), `src/lib/search.ts`, `src/screens/GalleryScreen.tsx`, `src/screens/SettingsScreen.tsx`, `src/lib/backgroundTask.ts` (shared), model + labels assets under `assets/models/` (git-tracked if small/license-clean, else first-run download via `expo-file-system`).

**PROTECTED-FILES-TOUCHED: YES — `src/db/schema.ts` only.**

**Risks & edge cases:**
- Model sourcing is the make-or-break task (T6.1 spike gates everything else) — if no suitable tflite scene model is found and licensed, fall back to the MobileNet mapping and re-scope vocabulary.
- fast-tflite JSI quirks on some OEMs: the T6.1 spike must run on the actual device before further build-out.
- Battery/thermal: charging-only + per-run budgets; if the device is never plugged in overnight, tags simply accumulate slowly — acceptable.
- Accuracy expectations: classification tags are coarse; the UI should show them as filters, not guarantees ("Showing photos tagged beach").
- Model file provenance/licensing must be recorded in the CHANGELOG entry.

**Device acceptance checks:**
- [ ] Opt-in → disclosure dialog → download over Wi-Fi completes; model state becomes "ready"; airplane mode afterwards does not break inference (model cached).
- [ ] With charger connected + app backgrounded overnight → a sample of photos gains tags in `media_tags` (inspect via a debug row or temporary screen).
- [ ] A known beach photo receives a beach-family tag; search "beach" returns it.
- [ ] Unplug charger → no batches run; toggle off → task no-ops.
- [ ] Tag search does not regress existing date/filename search paths.

**Effort: L** (~2–3 sessions; spike + tuning dominate).

---

## 3. Cross-feature shared utilities

### 3.1 Background maintenance task (F2 + F6)
New `src/lib/backgroundTask.ts` wrapping `expo-background-task` + `expo-task-manager` (verified: expo-background-task 57.0.15, peer `expo: *`, SDK 57 compatible; Android implementation is WorkManager).
- One registered periodic task (e.g. `photogramMaintenance`); inside, consult MMKV timestamp gates: F2 sweep weekly, F6 tagging every night-with-charge.
- In-task gates checked before any work: `Battery.isCharging()` / battery level via `expo-battery` (WorkManager's constraint options are not assumed — verify exact `TaskOptions` fields against https://docs.expo.dev/versions/v57.0.0/ at implementation time; the in-JS charging check is the reliable path either way).
- Known limits to document in CHANGELOG: periodic interval ≥ 15 min, runs only while app is backgrounded, OEM battery optimization may delay runs — hence manual buttons ("Sweep now", foreground batch) are the guaranteed test path.
- Must never run concurrently with the upload worker's critical sections; it only reads thumbnails and writes to its own tables.

### 3.2 Image-analysis pipeline (F2 + F6)
New `src/lib/imageAnalysis.ts`:
- `decodeThumb(uri): { width, height, gray: Uint8Array }` via `jpeg-js` on the 320 px thumbnails produced by `makeThumbnail` (`src/lib/scanner.ts`).
- `varianceOfLaplacian(gray)` and `meanLuminanceAndNoise(gray)` for F2.
- `pHash64(gray)` (DCT-based) + `hamming(a,b)` for F2 near-dup.
- F6 consumes the same thumbnails, resized to the model's input size via `ImageManipulator` before tensor conversion.
- Memory discipline: decode one image at a time; no arrays of pixels held across iterations.

### 3.3 Thumbnail backfill
F2/F6 depend on thumbnails existing. For older rows without one, generate on demand with `makeThumbnail(uri, isVideo)` and store before analysis (or skip the row this run). Do not regenerate thumbnails for rows that already have them.

### 3.4 Typed TDLib wrapper pattern (F3)
Adding `editMessageCaption` = exactly one `insertPatches` entry in `scripts/patch-tdlib.js` with the 4 parts (java `@ReactMethod`, `index.js` registration, two `index.d.ts` lines), following the getForumTopics entries verbatim. Idempotency rule from `NEXT_SESSION.md`: never edit node_modules without the matching insert entry, because postinstall re-applies patches. One gradle rebuild after landing (coordinate with S9 if uncommitted work needs one too).

---

## 4. Rules reminder (binding for every task in this plan)

1. **TDLib fire-and-forget:** `td_json_client_send` never returns responses. Request/response only via typed native wrappers; new TDLib calls require a `scripts/patch-tdlib.js` insert entry.
2. **Additive schema only:** new tables/columns in a new `SCHEMA_Vn` (v7 = F2, v8 = F3, v9 = F6) appended in `src/db/schema.ts`; the runner in `src/db/index.ts` picks them up automatically.
3. **Protected files** (`src/lib/tdlib.ts`, `src/lib/qrLink.ts`, `src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`, `src/db/schema.ts`, `src/db/index.ts`, `app.config.ts`): reuse additively, never redesign; this plan touches only `schema.ts` (additive migrations in F2/F3/F6) and flags it per feature.
4. **`src/lib/uploader.ts`: do not touch** mid-bulk-backup. The 1.5 GB/day throttle is by design.
5. **Metro port 8083** for this project; never open, modify, or use anything in `E:\Opencode CLI\Projects\photogram-bot`.
6. **Secrets:** `tdlib.secrets.json` stays gitignored; never commit or copy into code/docs.
7. **v0.10 is reserved** for S9 topic verification/commit. Each of v0.11–v0.16 ships separately with its own `CHANGELOG.md` entry ("Added in this commit" + "Verify on device when free") and **no commit without owner approval**.
8. **Expo SDK 57:** exact-versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code touching Expo modules (esp. expo-background-task TaskOptions in F2/F6).

---

## 5. Assumptions to confirm with the owner before execution

1. **F1 uses Path A** (fresh install + QR re-login + rebuild from Saved Messages + re-download). The DB-file-copy path (B) is rejected for the reasons in F1. Confirm.
2. **F1 album re-link is a manual picker** (list groups → owner picks albums → re-claim) unless implementation discovers an automatic album marker. Confirm acceptable.
3. **F2 deletion is final locally** (Telegram copy is the undo; no Photogram trash stage for junk deletes). Confirm.
4. **F3 note replaces the photo's Telegram caption** (owner will see the note instead of the original fileName caption in Telegram). Documents/videos keep fileName in metadata. Confirm.
5. **F4 share card is numbers-only**, no album names or counts, even optionally. Confirm.
6. **F5 switches day keying to local time** (and optionally aligns the existing Memories screen later as a separate tiny change). Confirm.
7. **F6 MVP ships tag-filter search only** (no fuzzy natural-language queries), with a Places365-style model if a licensed tflite can be sourced, else a MobileNet mapping table. Confirm scope.
8. Each version ships **after** device acceptance checks pass and the owner approves the commit.
