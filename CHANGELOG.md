# Photogram — Commit Notes

Each entry below documents what a commit adds and what comes next. Newest first.

---

## v0.10 — Shared-album topic sub-albums + group-picker fix (NOT YET COMMITTED)

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

## v0.9 — OCR text search (opt-in), auto-backup folders, Safety check (COMMITTED `53f857c`)

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
