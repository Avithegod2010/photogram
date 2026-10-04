# Photogram — Commit Notes

Each entry below documents what a commit adds and what comes next. Newest first.

---

## Independent audit remediation — deep-pass fixes (COMMITTED in this commit)

**Six fixes applied by the independent auditor in its round-2 deep pass (verified by chatbot 1
and committed here); commit message authored by the auditor**
- **Editor byteSize honesty:** geometry-only edits (rotate/crop, no color pass) previously
  reported `byteSize: 0`, so their full-size JPEGs bypassed the 25 GB/day + 4 GB/h upload
  budgets. They now report their real on-disk size.
- **Byte-safe remote filename cap:** the sanitizer counted characters, but Android caps a
  filename component at 255 *bytes* — a 100-emoji name produced a 406-byte component. Now walks
  code points to a 200-byte budget (leaving room for the message-id prefix). Auditor's attack
  harness: 19 traversal cases → 0 escapes, 0 over-length.
- **Editor error surfacing:** Save had try/finally with no catch — any render failure silently
  no-opped the button. Now alerts with the reason.
- **Hidden lock-screen honesty:** the copy no longer promises a fingerprint prompt when the
  biometric lock is off ("Opening hidden photos…" instead).
- **biometrics.ts:** the deliberate fail-open trade-off (no enrolled biometrics → open; a
  fail-closed change could lock the owner out) is now documented in-code; behavior unchanged.
- **Scrub bookkeeping accuracy:** NEXT_SESSION now states the re-measured truth — Saved-Messages
  ids verified absent from all 39 commits; the supergroup id survives in 19 commits and is
  treated as accepted residue (not a credential).
- Deep pass also verified clean: caption JSON injection impossible (typed Java path, never
  concatenated JSON), no chat_id/reply_to double-target possible, no ReDoS in ladder regexes,
  notes force-path always re-reads the caption first, editor crop clamped + bounded, all new SQL
  parameter-bound. Deferred deliberately: uploader budget-accounting gap in the v0.20 guard
  (needs device testing — safety-critical file), MMKV encryption (no migration path),
  biometric fail-closed (could lock the owner out), npm downgrade advice (would break the app).
  tsc clean.

**Next**
- Album organizer + S9 Phase 2 two-way sync (next chatbot) · gradle rebuild → device verify.

---

## Security hardening round 2 — external audit triage (COMMITTED in this commit)

**Actions from the independent auditor's report** (mediums fixed; lows triaged below)
- **Path-traversal fix (`src/lib/claimer.ts`):** shared-album file names come from remote TDLib
  metadata — any group member controls them. `extractMedia` now reduces every fileName to a safe
  basename (all `/` and `\` separators stripped, `.`/`..`/empty rejected), so a crafted name like
  `x/../../evil` can never write outside the shared directory. Normal names (spaces, unicode)
  are preserved so restore-time matching is unaffected.
- **Permission trim:** `READ_MEDIA_AUDIO` (a photo app has no audio feature) and
  `SYSTEM_ALERT_WINDOW` (a dev-client convenience) are stripped from the main Android manifest
  and blocked at the config level (`app.config.ts blockedPermissions`) so future prebuilds keep
  them out. Dev builds keep the overlay via the debug manifest.
- **Release-log hygiene:** all `[forum]` / `[notes]` diagnostics (chat ids, topic titles) are now
  dev-builds-only (`__DEV__`).
- **Scrub bookkeeping:** the test-group supergroup id that survived the history rewrite is
  redacted at the tip, and NEXT_SESSION no longer overstates the rewrite ("scrubbed from all
  commits" corrected to name the accepted residue — a group id is not a credential; every member
  of the group already knows it).
- Deliberately NOT done, per the audit's own triage: npm's `expo@46` downgrade "fix" (would break
  the app — the 14 moderate advisories trace to two benign CVEs in build-tooling chains); MMKV
  encryption, biometric fail-closed fallback, HiddenScreen copy, and JSON.parse guards are queued
  as low-priority follow-ups.

**Next**
- Gradle rebuild (activates v0.16 notifications + v0.17 notes native + allowBackup/permission
  changes) → device verification of v0.12–v0.21.

---

## v0.21 — Place-name search, fully offline (COMMITTED in this commit)

**Added in this commit** (per docs/PLAN-V0.13-EIGHT.md; label shifted from the plan's v0.20 —
v0.17 went to photo journaling)
- **Offline reverse geocoding at scan time:** every GPS-tagged item gets a city-level place name
  ("Pune, India") computed entirely on-device — no network calls, ever. Dataset: 24,323 cities
  (population ≥ 15,000, GeoNames-derived via the `all-the-cities` build-time package, CC-BY-4.0
  attribution noted here), bundled as a ~0.96 MB `assets/geo/cities.json` behind a lazy-loaded
  0.5°-grid nearest-neighbor index (`src/lib/places.ts`).
- **Schema v11 (additive):** `media.place_name TEXT` + partial index. Scan integrates like the
  OCR pattern: new rows get a place after insert, and rescan backfills GPS rows missing one.
- **Search integration:** the gallery search now matches `place_name` alongside filenames, tags
  and OCR text (ASCII case-insensitive LIKE). Viewer info sheet gains a **"Place"** row.
- **Accepted accuracy trade-offs (owner-approved):** rural/wilderness photos resolve to the
  nearest city within 50 km else "unknown"; towns under the population cutoff inherit their
  nearest big city. tsc clean; not yet device-verified.

**Verify on device when free**
- Rescan → spot-check 3 photos' Place values against cities you actually photographed in; search
  a city name → those photos appear; airplane mode → scan + search still work end-to-end.

---

## v0.20 — Quick "Send to album" from the Viewer (COMMITTED in this commit)

**Added in this commit** (per docs/PLAN-V0.13-EIGHT.md; label shifted from the plan's v0.19 —
v0.17 went to photo journaling)
- **Viewer "Send" chip** (shown for photos with a local copy): pick a linked shared album from a
  bottom sheet and the photo is queued into that album's Telegram group — through the **normal
  queue**, so the FLOOD_WAIT ladder, budgets and inter-message gap govern it like every upload.
- **Two uploader safety hunks:**
  1. *Remote-link guard (required):* when a queue row targets a different chat than the one the
     photo already lives in, the worker completes the send WITHOUT overwriting the recorded
     Saved-Messages link (restore + phone migration depend on it).
  2. *Queue dedupe now groups by media + target chat* — a Saved-Messages row and a send-to-album
     row for one photo can coexist instead of one deleting the other.
- **Best-effort album link:** a self-expiring listener links the group message into the album
  grid once the send confirms; if matching misses, the next "⟳ Claim new" treats the group post
  as a clean own-duplicate (no double library row). For topic groups the message lands in
  General; the claimer's topic backfill attributes it later. New `src/lib/sendToAlbum.ts`.
  tsc clean; not yet device-verified.

**Verify on device when free**
- Send a synced photo to the test group → visible in Telegram; album grid shows it (or "⟳ Claim
  new" reports it as duplicate — never a second library row); the photo's own backup state and
  restore still work exactly as before.

---

## v0.19 — Photo editor lite + versioned archive (COMMITTED in this commit)

**Added in this commit** (per docs/PLAN-V0.13-EIGHT.md; label shifted from the plan's v0.18 —
v0.17 went to photo journaling)
- **Editor lite, zero new native modules** (no rebuild): rotate 90° steps, draggable crop rect,
  and brightness/contrast/saturation sliders. Geometry runs through expo-image-manipulator; the
  color pass is pure JS over jpeg-js pixels. Live preview renders the same math on the 320px
  thumbnail (debounced); Save renders once at ≤ 2048 px (the storage-saver cap — full-resolution
  originals are not re-encoded, stated limitation).
- **Versioned archive:** Save creates a SECOND media row (`edited_from` → root original, schema
  v10 + partial index) — the original is never touched. The edit uploads through the existing
  queue/ladder as a **REPLY to the original's Telegram message** (`upload_queue.reply_to_message_id`
  + a small uploader hunk that seeds the reply target and skips the preview-first dance for such
  rows; ladder/budgets/gap untouched). Same fileName caption preserved for `findSentMessage`.
- **Edits stay out of the main surfaces:** timeline, search, date-range, random, geo, safety
  check, storage/heartbeat/monthly stats, memories, on-this-day and Wrapped all exclude
  `edited_from` rows. Edits are reachable via the Viewer info sheet's **"Versions" row** — tap to
  page through original + edits.
- **Viewer "Edit" chip** (photos with a local file + Telegram copy; disabled with hint otherwise).
- New `src/lib/imageEdit.ts` + `src/screens/EditScreen.tsx`; `insertMedia` gained optional
  `edited_from`. tsc clean; not yet device-verified.

**Verify on device when free**
- Edit a synced photo (rotate + crop + sliders) → Save → Telegram shows the edit as a REPLY under
  the original; gallery shows ONE tile; Versions row flips between them; delete an edit → Trash,
  original untouched. Edit chip disabled for cloud-only / not-synced photos.

---

## v0.18 — Year-in-review "Wrapped" (COMMITTED in this commit)

**Added in this commit** (per docs/PLAN-V0.13-EIGHT.md; label shifted from the plan's v0.17 —
v0.17 went to photo journaling)
- **Collections → "2026 Wrapped"**: a stack of stat cards over the owner's own library — total
  captured (photos/videos), GB safely in Telegram, busiest month, top 3 days (with thumbnail
  strips), distinct days captured, and favorites count (ties into v0.13 hearts).
- Year chips switch between any year that has data; cards animate in with a staggered
  FadeInDown. Empty years render an honest zero-state.
- New read-only aggregation module `src/lib/wrapped.ts` — `stats.ts` and the Settings dashboard
  are untouched. No schema, no rebuild, no new dependencies. tsc clean; not yet device-verified.

**Verify on device when free**
- Collections → 2026 Wrapped: numbers spot-check against reality (busiest month, top day);
  year switching; empty year → graceful zeros.

---

## Security hardening — going public (COMMITTED in this commit)

- **`android:allowBackup` = false** (app.config.ts + the generated AndroidManifest): the local
  photo index (SQLite + thumbnails + settings) is excluded from Google's device-backup service.
  Takes effect in the APK with the next gradle rebuild.
- **LICENSE copyright line** now carries only the public handle (no real name).
- **Repo went PUBLIC** after a full history rewrite: all commit author/committer identities
  remapped to the GitHub noreply address, and every personal trace (Telegram chat/message ids,
  device serial, LAN IPs) scrubbed from all commits' content. Commit SHAs changed — docs were
  refreshed with the new hashes afterwards.

---

## License — MIT (COMMITTED `3207e41`)

- Added the owner's MIT `LICENSE` (the file that shipped with the Expo template carried Expo's own
  copyright — replaced before first publish) and updated the README license section.

---

## v0.12 — Junk Sweeper: on-device cleanup suggestions (COMMITTED `f372998`)

**Added in this commit** (built by the parallel chatbot-2 agent; committed on the owner's behalf
after that agent became unavailable — code-reviewed and accepted as-is by chatbot 1)
- **Opt-in sweep engine** (`src/lib/junk.ts` + `src/lib/imageAnalysis.ts`): Settings → Junk
  sweeper toggle. Analyzes the existing 320px thumbnails entirely on-device for four junk
  patterns — blurry (variance-of-Laplacian), pocket shots (dark + noisy frames), same-day
  near-duplicates (pHash + union-find clustering, largest kept as leader), and stale screenshots
  (90+ days) — writing findings to the new `junk_findings` table (schema v7, additive). Chunked
  + resumable (500-item chunks, cursor survives app kills); a daily check auto-sweeps at most
  weekly (`src/lib/junkAutoSweep.ts`).
- **Nothing is ever auto-deleted.** Collections → Junk sweeper review screen
  (`src/screens/JunkSweeperScreen.tsx`) lists findings by category with thumbnails; the owner
  decides per item or in batches, and "Keep" is permanent (a kept or deleted verdict is never
  overwritten by a later sweep).
- **Three deletion scopes with hard safety gates:** local files (system confirm dialog + verified
  delete, the proven Free-Up-Space pattern), Telegram messages (deleteMessages + remote id cleared
  so restore never points at a gone message), or both. Every scope requires the item to be fully
  synced with a remote copy; local scopes additionally require the file to exist.
- **Shared-album (family) media is never swept** — claimed family property is excluded from sweep
  candidates, matching the heartbeat and Free-Up-Space rules.
- **Also fixes a latent broken import:** `uploader.ts` (committed in v0.11.2) called
  `getQueueStatus()` but the function was never committed to `queries.ts` — this commit adds it.

**Verify on device when free**
- Settings → Junk sweeper → enable → run a sweep on the real library → review findings; keep one,
  delete one locally, and confirm family-album photos never appear.

**Next**
- Gradle rebuild (combined: expo-notifications + editMessageCaption), device verification of
  v0.12.1–v0.17, GitHub publish.

---

## v0.17 — Photo journaling: notes as Telegram captions (COMMITTED in this commit)

**Added in this commit** (F3 per docs/PLAN-F3-JOURNALING.md; owner-approved adaptations: schema
renumbered v8→v9 — v8 is Favorites — and label v0.17)
- **A note IS the Telegram caption (D1):** adding a note on any photo/video replaces that
  message's fileName caption in Saved Messages (visible in every Telegram client, survives
  forever); removing the note restores the fileName caption. Local-first: the note is saved to
  SQLite instantly and marked `note_synced = 0` until Telegram confirms — typed text is never lost,
  even offline.
- **New typed native wrapper `editMessageCaption`** via one idempotent 4-part insert in
  `scripts/patch-tdlib.js` (verified TdApi constructor; raw `td_json_client_send` is
  fire-and-forget so request/response MUST use typed wrappers). **Requires one gradle rebuild**
  (combined with v0.16's expo-notifications rebuild).
- **Schema v9 (additive):** `media.note_text TEXT`, `media.note_synced INTEGER DEFAULT 0`.
- **Sync-after design (option A):** ZERO changes to `src/lib/uploader.ts` — send-time captions
  stay fileName so `findSentMessage` matching is byte-identical and the FLOOD_WAIT ladder is
  untouched. Pending notes retry on app boot and when the Viewer opens; the Viewer save path
  pushes immediately when the row is already synced. Offline notes land on the next trigger.
- **Safety guards:** read-back before any edit (openChat → getMessage) — a caption the owner
  hand-typed in Telegram is never overwritten without an explicit "Replace the caption?" confirm
  (the app's own pushed note counts as ours, so removal is seamless); preview captions are never
  touched; unknown errors keep the note local and retry; "not modified" counts as success.
- **Viewer UI:** "Note" ActionChip, Note block in the info sheet (shows "· pending" until
  confirmed), 1000-char editor modal (Save / Remove / Cancel). Shared-album (family) photos are
  blocked with an alert — the app never edits captions on family members' messages.
- **Queries:** `setMediaNote` / `setNoteSynced` / `getPendingNoteSync` (own library only, excludes
  shared-album claims + trashed) / `isSharedAlbumMedia`.
- tsc clean; not yet device-verified (needs the combined gradle rebuild).

## v0.16 — Notifications, strictly opt-in (COMMITTED in this commit)

**Added in this commit**
- **Settings → Notifications:** master toggle (asks the Android 13+ permission on enable —
  channels are created first, the SDK 57 gotcha — and reverts itself on denial) + two sub-toggles,
  both default ON once the master is on: "Backup finished" and "On this day". Off = silence,
  full stop.
- **"Backup finished"** fires when the upload queue drains with new completions (watches the
  upload store — zero uploader changes; MMKV last-notified counter prevents duplicates).
- **"On this day"** at most once per day, on the first in-app check after 09:00 local: counts
  prior-years same-day photos in the owner's library and posts one memory notification.
- **Honest limits:** delivery happens while the app is running (the worker and the check loop are
  in-process) — no promised OS-scheduled alarms while the app is killed.
- **expo-notifications ~57.0.21 installed; ONE gradle rebuild required** (shared with v0.17's
  wrapper rebuild). The code soft-requires the native module (same pattern as expo-battery), so
  the current APK keeps running safely — toggling on it politely reports the module isn't
  available yet.

## v0.15 — Timeline scrubber (COMMITTED in this commit)

**Added in this commit**
- **Drag-to-jump rail** on the gallery's right edge (Days mode): a bubble under your finger shows
  the month ("Mar 2025"); release jumps the grid to that month via the existing keyset paging
  (first-ms-of-next-month bound — deterministic, no pixel-offset math on variable masonry tiles).
- A **"⤒ Top"** chip appears after a jump to get back to now; the handle mirrors the current
  head-of-grid month when idle.
- New `getTimelineRange()` query (MIN/MAX of the visible timeline). The rail hides while
  searching, while selecting, on empty libraries, and when the timeline spans under 2 months.
- Pure JS + existing reanimated/gesture stack; no schema, no rebuild, no new deps.

## v0.14 — Gallery multi-select (COMMITTED in this commit)

**Added in this commit**
- **Long-press a tile → selection mode:** tick circles on tiles (tap to toggle), header bar with
  "N selected / Select all / ✕", hardware back exits.
- **Bottom action bar:** Back up (queues local/failed rows through the normal dedupe'd queue),
  Archive, Hide, and Delete — Delete goes through the 30-day Trash with a confirm, exactly like
  single delete. Actions disable at zero selection.
- Ticks replace the favorite hearts while selecting; recycled tiles keep state (row data is the
  source of truth).
- Bonus fix found while here: tapping a photo while search results are shown now pages through the
  RESULT set in the Viewer (it previously opened the wrong photo from the full rows list).

## v0.13 — Favorites (COMMITTED in this commit)

**Added in this commit**
- **Heart any photo or video:** a small always-visible heart button on every Days-mode gallery
  tile (top-left; tapping it does NOT open the photo) and a Favorite chip in the Viewer. Schema
  v8 (additive): `media.is_favorite` + partial index.
- **Collections → Favorites:** a 3-column masonry grid of everything you've hearted, opening the
  Viewer on the favorites set. Favorites are per-device state in the local index (never synced to
  Telegram) and survive rescans.
- Query helpers `setMediaFavorite` / `listFavorites` (own media only, matching the Memories rule).

## v0.12.1 — Shareable backup heartbeat card (COMMITTED in this commit)

**Added in this commit** (F4 Settings-only slice per docs/PLAN-F4-HEARTBEAT-CARD.md)
- **Settings → Storage → "Share backup status":** one tap composes a numbers-only status line
  from the exact data behind the gallery heartbeat — e.g. "Photogram: 14.2 GB safe — 2,431 of
  2,431 backed up. Last upload 2h ago. 0 pending." — and opens the Android share sheet.
- Four states (all-synced recent / stale-48h shows the date / partial / never-synced omits the
  last-upload sentence); the pending figure falls back to total − synced so a drained queue can
  never fake "0 pending".
- **Privacy hard rule:** aggregate numbers only — no file names, paths, album or contact names.
  The row hides itself on a fresh install (nothing to report); share-sheet cancel is a no-op.
- Pure JS: `src/lib/heartbeatCard.ts` + one row in SettingsScreen; no schema, no rebuild, RN
  `Share.share` (not expo-sharing — plain text, not a file share).

---

## v0.11.2 — Upload safety: real FLOOD_WAIT handling, escalation ladder, Danger zone (COMMITTED `c96db15`)

**Added in this commit** (owner-directed account-safety hardening; static verification only — the
owner forbids device testing, so no rate limit was ever triggered for real)
- **Real FLOOD_WAIT detection (was dead code):** `updateMessageSendFailed` events (carrying
  error{code,message}) are now listened for and parsed — gson camelCase, wire snake_case, code
  429/420, "FLOOD_WAIT_X", "retry after N", "slow down", "PEER_FLOOD". Previously the error branch
  after td_json_client_send could never fire, so rate limits were silently ignored.
- **The owner's escalation ladder, implemented exactly:**
  1st hit → obey X + 3 min. 2nd within 1 h → obey X + 30 min + forced 2 s gap. 3rd within 24 h →
  6 h safety pause + user warning + 4 s gap for 24 h. Wait > 1 h → rest-of-day pause. PEER_FLOOD →
  24 h pause + warning + 4 s gap. Every rung guaranteed ≥ X + buffer (midnight-edge fixed).
  Rate-limited items return to "pending" WITHOUT burning attempts; a done row can never be
  un-done by a late failure; the send-matching fallback can never bind a wrong message after a
  rate-limited send (double-checked guard + preview-suffix skip).
- **Persisted budgets** (survive restarts; the old session throttle forgot itself): 25 GB/day
  (settings-adjustable) + 4 GB/hour circuit-breaker, day rolls at local midnight. Gate checked
  before every dequeue; gated status shows resume time.
- **Inter-message gap** before every send: OFF by default; Settings → Danger zone lets the owner
  set 0–4 s. Ladder windows can force 2 s / 4 s gaps regardless.
- **Settings → "Danger zone"** (bottom, red-tinted): inter-message gap chips (Off–4s), daily
  budget chips (5/10/25/50/∞ GB, used-today readout), status rows (mode, last rate-limit, hits
  1 h/24 h, budget used), and a "Simulate rate limit (testing)" button routing through the real
  ladder path (testing-only; increments real counters).
- Static verification: two adversarial code-review rounds (first found a send-binding race that
  could mark a rate-limited photo as synced — fixed; plus midnight-edge pause bug — fixed), then
  PASS with the two residual narrow races also hardened. `npx tsc --noEmit` clean. No device
  testing was performed by design.

**Next**
- Ladder can only be truly proven by Telegram itself — if a real FLOOD_WAIT lands, the Settings
  Danger zone will show the hit and the pause; report back to the agent for tuning if needed.

---

## v0.11.1 — UI polish: animated tabs, settings reorder, scrollable Collections, date toggle, Viewer icons (COMMITTED `4c0ba9a`)

**Added in this commit** (owner-requested polish, 3 batches, all subagent-coded + code-reviewed PASS)
- **Fluid tab switching + animated tab icons** (`RootTabs.tsx`): incoming tab fades in and slides up
  12 px (200 ms) on every focus. Tab icons animate per personality on focus: Gallery cloud pops
  (spring 1→1.18→1), Collections search wiggles (−12°→12°→0), Settings gear does a full 360° spin
  (replays every landing). First custom Reanimated worklets in the app — smoke-tested live, no
  crashes, zero JS errors.
- **Fixed Settings "Shared albums" text overflow**: the shared `Row` component now groups label+sub
  in a flex:1 container (matches ToggleRow), so long sub-texts wrap in-bounds everywhere.
- **Settings reordered**: UPLOADS dashboard first, then Backup preferences, Auto-backup, Storage,
  Device storage, Search, Shared albums, Privacy — ACCOUNT + MIGRATION last (set-and-forget).
- **Collections tab scrollable**: all 8 rows reachable on any screen size; title stays fixed.
- **"Show date in every photo" toggle** (Settings → Backup preferences, default OFF): when off,
  the capture-date badge is hidden on every photo tile (Days-mode 4-column grid) — cleaner grid.
  Day-group headers are unaffected. Verified live: ON → badges appear, OFF → clean grid.
- **Viewer action buttons redesigned**: Share / Save to device / Back up / Archive / Hide / Delete
  are now icon mini-buttons (Ionicons above a tiny label) with the same ripple/danger/disabled
  behavior; the bar wraps gracefully on narrow screens.

**Verify on device when free (owner)**
- Feel the tab animations (Settings gear spin) and scroll Collections to the bottom.
- Viewer: open any photo and check the new icon buttons.
- Settings: Uploads at top, Account/Migration at bottom, "Show date in every photo" default OFF.

**Next**
- Final visual pass on the animations once wireless debugging returns from the sibling chatbot.

---

**Added in this commit** (two features; owner can ask to split into separate versions)
- **One-tap phone migration (plan F1):** after a fresh QR login on a new phone, Photogram detects
  the Telegram backup in Saved Messages and offers "Restore your backup": walks Saved Messages
  history (paged, idempotent — re-runs pick up only new items), rebuilds the local index as
  cloud-only rows (state `synced`, no local file), then restores the original files to the device
  gallery at the owner's pace (pause/resume/stop), and re-links shared albums via the existing
  claim flow. New `src/lib/rehydrate.ts` + `src/screens/MigrateScreen.tsx`; Settings → Migration
  entry; empty-library banner (one-time). Review findings fixed: scanner dedupe also matches
  `media_library_id` (restored files are recognized on rescan — no duplicates), short-page
  pagination settles instead of ending early, zombie-row repair at run start, non-empty-library
  warning before migrating.
- **Preview-first upload format (owner request):** each Saved Messages backup now sends a small
  preview photo first (the 320px thumbnail made at scan time, caption `filename · preview`), then
  the original file as a REPLY to that preview — Telegram shows something instantly and the big
  original threads beneath it. Shared-album queue rows stay single-message (the claimer must not
  see double posts). Settings → "Preview first, file as reply" toggle (default ON). Restorer's
  filename fallback skips preview captions (restoring a preview would fetch the wrong bytes).
- **Topic pipeline fixes (S9 — three stacked bugs found via live debugging):**
  1. `GetSupergroup.supergroupId` is LONG in this TdApi but the library wrapper cast (int) —
     supergroup ids > 2³¹ overflowed, so every forum read failed. New idempotent replace-patch in
     `scripts/patch-tdlib.js` + gradle rebuild.
  2. gson field names: ForumTopicInfo carries `forumTopicId`/`name`/`isHidden`; the parser read
     wire-format `message_thread_id`/`title` that never appear, dropping every topic. Fixed.
  3. Switched topic history to a NEW typed wrapper `getForumTopicHistory(chatId, forumTopicId, …)`
     (getMessageThreadHistory needed root messages pre-loaded and 400'd on cold chats). Patch
     entry + gradle rebuild (both wrappers in the installed APK).
  Also: lazy topic-list retry (TDLib answers empty while syncing a fresh chat), permanent concise
  `[forum]` logcat diagnostics.
- **Verified on device (2026-09-05, owner's "Photos testing" group — 4 topics named 1..4):**
  topics parse [General#1, 1#2, 2#5, 3#6, 4#11]; forum_topics cache populated; first claim
  attributed 11 media rows per topic (General 1, "1" 2, "2" 2, "3" 2, "4" 4); chip row renders
  with counts ("All (11) | General · 1 | 1 · 2 | 2 · 2 | 3 · 2 | 4 · 4"); tapping a chip filters
  the grid (chip "4" → 4 items); claim-twice = 0 new · 0 failed (idempotent); plain non-topic
  group and auto-albums show NO chip row (regression PASS).

**Verify on device when free (owner)**
- New upload format: next backed-up photo appears in Saved Messages as a small preview with the
  original replying to it.
- Migration: on THIS phone the gallery banner must NOT appear (library not empty); Settings →
  Migration → inventory count ≈ real Saved Messages count; restore 2-3 items.

---

## v0.10.1 — Claim hotfix: file:// URI normalization (COMMITTED in this commit)

**Added in this commit**
- **Fix (found via device retest + new error-surfacing alerts):** claiming from a shared album
  failed for every item with "FileSystemFile.copy rejected — URI is not absolute". TDLib's
  `downloadFileByRemoteId` result gives a plain filesystem path; the expo-file-system `File` API
  requires an absolute `file://` URI. `claimOne` now normalizes the path before copying.
- Claim result alerts now include the stored error reason ("N failed — <reason>").
- Device-verified after fix: claim reports "1 new · 0 failed", album row + cursor + activity feed
  correct. Note: the "Photogram" test group is a plain (non-forum) group — chip-row verification
  still needs the topic-enabled test group (forum path untouched by this fix).

---

## v0.10 — Shared-album topic sub-albums + group-picker fix (COMMITTED `be8f73d`)

**Added in this commit**
- **Topic sub-albums (S9 Phase 2)**: a Telegram group with Topics (forum) enabled becomes one album
  per topic. Collections → Shared albums → open the album → chip row ("All" + one chip per topic
  with counts) → tapping a chip filters the grid; the Viewer pager works on the filtered set.
  Schema v6 (additive): `album_media.forum_topic_id` column + `forum_topics` cache table
  (id, chat_id, title). Claiming walks every topic via `getForumTopics` +
  `getMessageThreadHistory` and advances the per-album cursor only when EVERY topic read
  succeeds (idempotent — re-claim picks up where it stopped); "General" is thread id "1".
  Non-forum groups keep the flat claim path (no chip row).
- **Native `getForumTopics` typed wrapper**: new entry in `scripts/patch-tdlib.js`
  (TdApi.GetForumTopics + getForumTopics + full-chat-object fetch), requires the gradle rebuild
  already shipped in this batch's APK. Raw `td_json_client_send` is fire-and-forget — request/
  response TDLib calls must go through typed wrappers.
- **Group-picker fix (the "no group found" bug)**: `src/lib/chats.ts` `listMyGroups()` now uses
  the library's typed wrappers (`loadChats` → `getChats` → per-chat `getChat`) instead of a raw
  fire-and-forget send that could never see the response. The picker now actually lists groups.
  Also made the picker scrollable (was a plain View — groups past the 5th were unreachable).
- **Shared-albums polish**: per-album "Recent activity" feed resolves sender names; claim
  progress banner shows claimed/duplicate counts.

**Verified on device**
- APK with native `getForumTopics` installed (confirmed present in the built dex); app relaunched;
  schema v6 migrated on launch (meta.schema_version=6, forum_topic_id column, forum_topics table;
  `media` 1907 rows and `upload_queue` 2132 rows intact — zero data loss).
- Picker fix confirmed live: "+ Link group" lists real groups (was "No groups found") and the list
  now SCROLLS (was a plain View — groups past the 5th were unreachable).
- Link flow verified: the owner's "Photogram" test group links (album row + confirm dialog + first
  claim runs).

**Verify on device when free (owner)**
- OPEN ISSUE found during retest: the first claim reported "0 claimed · 1 failed", the second
  "0 claimed · 0 duplicates · 51 failed", and forum_topics stayed empty (claim took the flat
  path). The per-item claim code is UNCHANGED from the v0.8-verified claimer, so this is either
  environmental (flaky Wi-Fi during the test) or a download/GetRemoteFile issue that needs one
  error message. Claim alerts now surface the stored error text ("N failed — <reason>") — run
  "⟳ Claim new" once with the phone on a stable network and read the reason. THEN: forum chip row
  with counts → chip filters grid → Viewer pager on the filtered set → claim twice → second run
  claims 0 new; regression: plain (non-topic) group and auto-albums show NO chip row.

**Next plan**
- `docs/PLAN-FEATURES-v0.11-plus.md` — six features v0.11–v0.16 (migration, junk sweeper,
  photo journaling, family heartbeat, on-this-day, vibe search), planned 2026-09-01, awaiting
  owner review before any coding.

---

## v0.9 — OCR text search (opt-in), auto-backup folders, Safety check (COMMITTED `4c6b8e8`)

**Added in this commit**
- **OCR text search — owner opt-in (idea 5)**: Settings → Search → "Read text in photos (OCR)".
  When ON, every scan runs ML Kit text recognition (on-device) over photos and stores the text in
  the new `media.ocr_text` column (schema v5); search now matches words inside screenshots,
  receipts, documents. Applies to new scans AND backfills older photos that have no text yet
  (photos only; videos skipped). Uses `@react-native-ml-kit/text-recognition`, SOFT-required — its
  native module lands with the next gradle rebuild; until then OCR silently does nothing.
- **Auto-backup (idea 6)**: Settings → Auto-backup → master toggle + device-folder picker
  (none selected = all folders). A quiet pass runs 15 s after boot and every 5 minutes: rescan
  (deduped) → any NEW photo/video in the selected folders is auto-queued for upload. Wi-Fi-only /
  charge-only holds still apply, and the persistent queue keeps it safe across restarts.
  `ScanProgress.addedMediaIds` feeds the enqueue decision.
- **Safety check (idea 7)**: Collections → "Safety check" — the "drop my phone in a river" screen.
  Verdict card (safe / X items not yet safe, GB that exist only on this phone), stat row (Safe ·
  Cloud-only · Waiting · Failed), and an attention list sorted worst-first. Covers the owner's own
  library; family media in shared albums is excluded (never auto-deleted, by design).

**Verify on device when free** (schema v5 migrates on first launch; ML Kit needs the pending
gradle rebuild before OCR actually reads text):
- Settings → Search → enable OCR → ⟳ rescan → search a word visible in a screenshot.
- Settings → Auto-backup → enable + pick folder → take a new photo → it should appear queued
  within ~5 minutes (or force the pass by restarting the app).
- Collections → Safety check: verdict matches the heartbeat and queue numbers.

**Next plan**
- Commit v0.9 after verification · gradle rebuild (ML Kit + expo-battery native + SDK bumps +
  optional Maps key) · bulk backup resume · S9 topic sub-albums (fast-follow)

---

## v0.8 — S9 Phase 1: Shared albums (one-way claim from a Telegram group)

**Design decisions (owner, 2026-08-30 — full spec in docs/S9-DESIGN.md)**
- Phased: one-way claim now, chat-parameterized plumbing so two-way needs no rework.
- Album-only by default; **per-album "Show in my timeline" toggle** (default OFF) + master switch in
  Settings. Photos the owner sends to the group themselves always stay in the main timeline.
- **Free-Up-Space never touches family media.**
- One group = one album (groups created in Telegram); topics as sub-albums = fast-follow.
- Privacy: Telegram rules + warnings in the picker (extra caution for many-member groups).

**Added in this commit** (NOT yet device-verified — phone shared with another agent)
- **Schema v4** (additive, PROTECTED files touched with owner approval): `albums.chat_id`,
  `albums.last_claimed_message_id`, `albums.show_in_timeline`; `album_media.sender_id`,
  `album_media.message_id`; `upload_queue.chat_id` (NULL = Saved Messages — the phase-2 hook).
- **Claim engine** (`src/lib/claimer.ts`): per album, reads the group's history past the claim
  cursor, downloads originals into app storage (device DCIM untouched), makes thumbnails, inserts
  rows tagged `shared`; own-sender rows stay unlinked; duplicates link the existing row instead of
  storing copies (and never overwrite an existing Saved Messages remote link); the group message is
  recorded as the row's remote copy so restore works.
- **Shared albums UI**: Collections → "Shared albums" → link a group via picker
  (`listMyGroups()` + privacy warning) → first claim runs immediately with live progress; album
  cards with cover/count, "⟳ Claim new", Unlink (group untouched); shared album grid = AlbumScreen
  in shared mode with the timeline toggle.
- **Timeline exclusion everywhere**: main gallery (honoring master + per-album toggles), Memories,
  search, map, storage stats, and Free-Up-Space/restore lists all skip album-linked rows.
- **Uploader**: queue rows carry a target chat (NULL = Saved Messages) — the worker sends there;
  the completion-confirmation logic is chat-agnostic already.
- **Delight batch**: 🎲 **Rediscover** button in the gallery header (one random photo, full-screen);
  **backup heartbeat** under the gallery title ("🔒 All 1,852 backed up · 2h ago" / live X/Y while
  uploading; counts only the owner's media); **"On this day" Stories** — Memories cards now open a
  full-screen auto-advancing slideshow (tap left/right to steer, ⤢ opens the viewer); **shared-album
  activity feed** ("Maya added a photo to Family · 2h ago", sender names resolved from Telegram).

**Verify on device when free**: link a real family group → first claim; toggle per-album + master
switch and watch the timeline; confirm Free-Up-Space list excludes claimed items; resend a photo
into the group and "⟳ Claim new" picks it up. Also: Memories card → Story playback, 🎲 button,
heartbeat line.

**Next plan**
- Topic sub-albums (fast-follow) · S9 Phase 2 two-way · album organizer (sender/month, long-term)
- Gradle rebuild due: expo-battery native + SDK bumps + Maps key if added
- v0.7 on-device checklist still pending (Archive/Hidden, scan-fail banner, Wi-Fi hold, day headers)

---

## v0.7 — Real Archive + Hidden (biometric gate), corrupt-file UX, upload constraints, gallery polish

**Added in this commit**
- **Real Archive + Hidden screens**: Collections rows enabled. Archive lists archived media with an
  Unarchive action; Hidden shows a lock screen and asks for fingerprint/face (`expo-local-authentication`,
  already compiled in) before fetching or rendering anything — the Settings biometric toggle turns the
  gate off. Unhide action per item; items open in the full Viewer.
- **Corrupt-file UX**: the scanner records the names of files that fail (up to 8) and the
  scan-complete banner reads "N failed (tap for details)" — tapping lists the files, the error, and a
  note that they're skipped and retried on the next scan.
- **Wi-Fi-only / charge-only finally enforced**: the Settings toggles were decorative — the upload
  worker now checks conditions before every item and holds with a visible reason in Settings →
  Uploads ("Waiting for Wi-Fi…"). Charging detection uses expo-battery, npm-installed with a
  SOFT-require (fails open until the next gradle build adds its native module); Wi-Fi via
  expo-network works immediately.
- **"Backed up today" counter**: replaced the reset-on-restart "This session" stat with a per-day
  MMKV-persisted total.
- **Day-section headers in Days mode**: full-width Today / Yesterday / date headers between day
  groups via FlashList v2 masonry per-item span (skipped while searching).
- **S9 groundwork**: `src/lib/chats.ts` — `listMyGroups()` lists the user's Telegram groups via raw
  `td_json_client_send` getChats/getChat with retries.
- **Housekeeping**: all 10 SDK patch deps aligned (`expo install --fix`, RN 0.86.3, JS-side; APK picks
  them up at next gradle build). AGENT.md §7 + NEXT_SESSION.md refreshed (shared-phone warning,
  slow-Metro-boot lesson, v0.7 verification checklist).

**Not yet device-verified** (owner's phone shared with another automation agent): Archive/Hidden +
biometric gate, scan-fail banner details, Wi-Fi-only hold reason, day headers. Code is tsc-clean and
served by Metro; verify on next phone access.

**Next plan**
- S9 Phase 1 shared albums (design decided in docs/S9-DESIGN.md — one-way claim, per-album timeline
  toggle, never auto-delete family media, 1 group = 1 album with topics as sub-albums)
- A gradle rebuild is due anyway: brings expo-battery native + SDK bumps (and Maps key if added)

---

## v0.6 — S8 Auto-albums, cloud counts, upload-completion confirmation, date-unit repair, gallery grid fix

**Added in this commit**
- **S8 · Auto-albums** (new `src/lib/albums.ts`, `AlbumsScreen.tsx`, `AlbumScreen.tsx`): Collections →
  **Albums** is now real — auto-groups from scanner tags into **Camera / Screenshots / WhatsApp /
  Downloads / Videos** cards (cover = newest item, empty albums hidden). Tapping a card opens a
  3-column masonry grid of that album with video badges and upload-state dots; items open the Viewer.
- **Cloud counts in Settings → Storage**: stat grid now splits **Local photos/videos** vs
  **Cloud photos/videos** (rows with `state='synced'`) alongside In-cloud GB and In queue — counts
  tick up live while the bulk backup runs.
- **Uploads only marked "synced" when bytes actually reached Telegram**: the uploader now records the
  remote message ids as **"uploading"** and waits for real completion (updateMessageSendSucceeded /
  updateFile completion events, both gson camelCase + snake_case, plus a 5 s history-poll fallback)
  before flipping to `synced`. Progress now also feeds the live dashboard (the old progress handler
  only read snake_case and never fired). 2 h confirmation timeout → queue item fails with an honest
  message instead of over-claiming. Message lookup retries while a fresh chat's history is empty.
- **Queue dedupe (`dedupeUploadQueue`)**: pressing "▲ Back up" twice double-queued the whole library
  (3,599 rows) — worker boot + every enqueue now collapse surplus pending rows per media (verified:
  3,599 → 1,848, zero duplicate groups).
- **taken_at unit repair**: MediaLibrary's `creationTime`/`modificationTime` arrive in **milliseconds**
  on this stack — the v0.5 fix multiplied by 1000 again, putting every row in year 58,629. Scanner now
  normalizes both units (`toMs`), and a one-shot boot repair (`repairTakenAtUnits`, App.tsx) divided
  the damaged rows back to true dates (verified range Jul 2024 → Aug 2026).
- **Gallery grid finally visible (Days mode)**: days-mode tiles passed `aspectRatio: undefined` with an
  `absoluteFill` image → every tile collapsed to zero height, so the grid rendered invisible under the
  Memories carousel. Tiles now take their real per-item aspect (clamped 0.6–1.8). Verified visually:
  populated 4-column masonry with date badges.
- **More unique Memories**: carousel no longer requires ≥2 items per day — every prior-year day
  qualifies, ordered by same-date-first then closest-to-today.
- Timestamp backfill on rescan: rows with epoch-1970 `taken_at` get real dates via file mtime.

**Verified live on device (2026-08-30)**: storage cloud counts, Albums hub + grid + Viewer, queue
dedupe in DB, date repair, populated gallery grid + multi-day memories (screenshot-confirmed).

**Next plan**
- Owner resumes the bulk backup ("▲ Back up" — remember it auto-resumes on app restart; Pause in
  Settings → Uploads stops it for the session)
- S9 Telegram-group album sharing · real Archive/Hidden screens (Hidden behind the biometric toggle)
- Viewer "Save to device" chip visual check (code path already verified via bulk restore)
- 1 media row still has no discoverable date (falls back to save time on next scan)

---

## v0.5.1 — Handoff docs consolidated (docs only)

- `NEXT_SESSION.md` §0 rewritten as a single "current state" section: everything verified live on
  2026-08-29, all root causes (photo scan, scoped storage, pending message ids, gson camelCase,
  messageAnimation, getMessage 404s), wireless-adb + Metro workflow gotchas, and the next steps.
  Older session logs retitled §0b/§0c (history).
- `AGENT.md` §7 status + §13 first-actions refreshed to match (no more stale "awaiting phone install").
- No code changes.

---

## v0.5 — App revived on device, photo scan fixed, Free-Up-Space fixed, S7 Restore-to-device

**Added in this commit**
- **Backup triggers (missing core feature)**: nothing ever queued uploads before — `enqueueForUpload` had zero UI callers. Gallery header now has a **"▲ Back up N"** pill (queues all local/failed items with a confirm dialog) and the Viewer has a per-item **"Back up"** chip.
- **Permanent scan button**: the scan CTA previously existed only on the empty gallery — a **"⟳"** button now lives in the gallery header so the library can be re-scanned anytime (also backfills media-library ids for existing rows).
- **Photo scan fixed (two stacked bugs)**: (1) `scanner.ts` passed the string `"jpeg"` instead of the `SaveFormat.JPEG` enum, so every photo thumbnail threw and the per-item catch hid it; (2) `getAssetInfoAsync` needs `ACCESS_MEDIA_LOCATION` (EXIF/GPS) which the APK never declared. Fixed the enum, added the permission to `app.config.ts` + AndroidManifest (gradle rebuild), and made the scan banner show **"N failed (first error)"** so failures can never hide again. Verified live: 1,717 photos + 133 videos scanned, matching MediaStore.
- **Partial-access guard**: scanner detects Android's "Select photos and videos" limited access and alerts + banners with instructions to Allow-all.
- **Free-Up-Space fixed (scoped storage)**: Android 11+ blocks deleting other apps' files directly — the old `File.delete()` threw EACCES silently. Schema **v3** adds `media.media_library_id` (expo-media-library asset id, stored at scan, backfilled on rescan); `space.ts` now deletes via `MediaLibrary.deleteAssetsAsync` (system confirm dialog) and **verifies each file is gone** before clearing the DB. Verified live: file deleted via system dialog, DB correctly remote-only.
- **S7 · Restore-to-device (new `src/lib/restorer.ts`)**: downloads originals back from Saved Messages. Viewer gains a **"Save to device"** chip (shown when local copy is missing and a Telegram copy exists); Settings → Device storage gains **"Restore missing originals (N)"** bulk restore with progress. Verified live end-to-end: freed video re-downloaded from Telegram into DCIM, byte-identical, DB re-linked.
- **Upload id correctness**: the uploader stored TDLib *pending* message ids (replaced server-side right after send). New `updateMessageSendSucceeded` listener swaps in final ids (`replaceRemoteMessageId`); the restorer additionally matches messages by filename and self-heals stale ids.
- **Tab icons**: text glyphs replaced with `@expo/vector-icons` Ionicons — Gallery = cloud (Unlim style), Collections = magnifier, Settings = gear.
- **Build infra (from the device-revival session)**: react-native-tdlib autolinking fix + compileSdk 36 patch under `patches/`, auto-reapplied by `scripts/patch-tdlib.js` on postinstall; gesture-handler wiring in `App.tsx`/`index.ts`; `run-photogram-metro-fast.ps1` (Metro restarts without cache clear).
- Handoff docs `AGENT.md` / `NEXT_SESSION.md` updated with the full debugging trail.

**Verified live on device (2026-08-29)**: wireless adb pairing, Metro on 8083, TDLib login restored, upload smoke test (202 KB video → Saved Messages, confirmed playing), full rescan with photos, Free-Up-Space round trip, restore round trip.

**Next plan**
- Owner triggers the bulk "▲ Back up 1,849" (≈13 GB+, throttled 1.5 GB/session by design)
- Visual check of the Viewer "Save to device" chip (same code path as bulk restore — already verified)
- S8 Auto-albums, S9 Telegram-group album sharing
- Investigate: 2 corrupt files in NagramXF attachments; "56y" memories artifact (epoch-1970 dates → fall back to file mtime when metadata is missing)

---

## v0.4 — S4 Search + S5 Memories + S6 Map view

**Added in this commit**
- **S4 · Search**: Gallery search bar (magnifier icon). Understands dates ("June 2026", "2026", "last month", "today") and text matches against filenames + auto-tags (photo/video/screenshot/whatsapp/download). Debounced live results.
- **S5 · Memories carousel**: "X years ago" cards above the gallery grid, Reanimated fade-in, tap opens that day's photos in the viewer. Shows groups with 2+ items from previous years.
- **S6 · Map view**: Collections → Map places GPS-tagged photos as pins (grid-clustered, max 400). Tap pin → photo viewer.
- Schema migration v2: `tags`, `latitude`, `longitude` columns + geo index. New scans auto-capture location + tags; existing rows gain them on next rescan.

**Setup note (optional)**: Map view needs a free Google Maps API key — add `"google_maps_api_key": "..."` to tdlib.secrets.json before the next native rebuild. Without it, everything else works; Map screen shows setup instructions instead of crashing.

**Next plan**
- Phone build (`npx expo run:android`) — first real end-to-end test: QR login, scan, upload, viewer
- Then S7 Restore-to-device, S8 Auto-albums, S9 Telegram-group album sharing

---

## v0.3 — Core loop (F1–F4) + quick wins (S1–S3)

**Added in this commit**
- **F1 Masonry Gallery**: FlashList v2 masonry, Days/Months/Years pinch levels, date badges, upload-state dots, keyset paging.
- **F2 Viewer**: swipe, pinch zoom 4×, video playback, metadata sheet, Share/Archive/Hide/Delete.
- **F3 Upload Engine**: SQLite-persistent queue to Saved Messages, 1.5GB→5s throttle, FLOOD_WAIT reactive backoff, live progress, Pause/Resume.
- **F4 Scanner**: device library scan with dedupe gate + 320px thumbnails.
- **S1 · Free Up Space**: Settings → Device Storage shows how many GB of originals are safely in Telegram; one tap removes local copies (thumbnails stay, gallery still browsable offline).
- **S2 · Trash with 30-day countdown**: Collections → Trash is now real — thumbnails with days-left badges, Restore, Delete-Forever (removes from Telegram too). Auto-purge runs on app start.
- **S3 · Upload quality setting**: "Storage saver" recompresses photos >2048px to ~85% JPEG before upload; videos always stay original. Default: Storage saver.

**Next plan**
- S4 Search by date/tag/filename
- S5 Memories ("On this day") carousel
- S6 Map view from GPS EXIF clusters
- Then: phone build (`npx expo run:android`) for first end-to-end test

---

## v0.1 — Foundation

TDLib QR/tap-to-confirm auth, SQLite schema + migrations, settings store (EXIF toggle, biometric lock for Hidden), storage stats dashboard, 3-tab shell.
