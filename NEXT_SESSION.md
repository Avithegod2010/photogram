# PHOTOGRAM — MASTER HANDOFF (read this fully before coding)

_This file is the single source of truth for any AI agent or developer picking up this project cold.
Last updated: end of day 2026-08-29 (§0). Read §0, then §1–§17. CHANGELOG.md has per-version notes._

---

## 0. CURRENT STATE — END OF DAY 2026-08-30 · v0.6 COMMITTED · WORKING TREE CLEAN

**The full product loop works and v0.6 added S8 Auto-albums, cloud storage counts, upload-completion
confirmation, queue dedupe, and the date/grid fixes. All verified live on the Samsung (SM-S942B).**

### What works (verified on device 2026-08-30)
- **Gallery grid is finally visible** (Days mode tiles previously had no aspectRatio → zero-height,
  invisible). 4-col masonry with per-tile date badges, Memories carousel above.
- **Memories** now show unique day cards (single-item days included): "1y · 30 Aug · 1" etc.
- **Auto-albums**: Collections → Albums → Camera (1,750) / Screenshots (106) / WhatsApp (4) /
  Videos (137) → masonry album grid → Viewer.
- **Settings → Storage** splits Local vs **Cloud photos/videos/GB/queue** (live while uploading).
- **Upload-completion confirmation**: items flip local → queued → uploading → synced only after TDLib
  confirms the file fully reached Telegram (updateMessageSendSucceeded / updateFile + history poll).
- **Queue dedupe**: "▲ Back up" double-presses can no longer duplicate the queue (3,599 → 1,848 verified).
- **Bulk backup ran live**: 270+ items (~1.5 GB) landed in Saved Messages before owner paused it.
  The queue auto-resumes on every app restart (by design); Pause in Settings stops it for the session.

### Key facts newer agents must not re-trip (v0.6)
1. **MediaLibrary timestamps are MILLISECONDS on this stack** — `creationTime`/`modificationTime` are
   ms, not seconds. Use `toMs()` in `scanner.ts` (values > 1e11 are already ms). Never `* 1000` blindly.
2. **Days-mode gallery tiles need an explicit `aspectRatio`** — `absoluteFill` images collapse to 0
   height without one (that was the "gallery shows no photos" bug).
3. **Upload confirmation**: `waitForUploadConfirmed()` in `uploader.ts` — read BOTH gson camelCase and
   wire snake_case (`firstDefined`) for every TDLib JSON field.
4. `setMediaRemote(id, chat, msgId, state)` — pass "uploading" then flip to "synced" via `setMediaState`
   after confirmation. Never mark synced from message existence alone.
5. **uiautomator dump fails with "could not get idle state"** when app animations run — either zero the
   animation scales temporarily (`adb shell settings put global {window,transition,animator}_duration_scale 0`,
   RESTORE to 1 afterwards) or verify via screenshots read by a subagent (OCR) — the main agent's model
   may not accept images.
6. **Wireless adb drops when the screen dozes** — mDNS still lists the service; reconnect via
   `adb mdns services` → `adb connect <ip:port>` (port changes per session; refused = phone asleep,
   owner must open Settings → Developer options → Wireless debugging). After reconnect ALWAYS re-run
   `adb reverse tcp:8083 tcp:8083` before relaunching the dev client.
7. Metro: kill by port (`netstat -ano | grep 8083` → Stop-Process), restart with
   `powershell -ExecutionPolicy Bypass -File E:\Dev\run-photogram-metro-fast.ps1` (plain -File hits
   execution policy from tool shells). **The first boot after any npm install can take 4+ minutes**
   (CLI stalls stage-by-stage before `metro:instantiate`) — give it a long uninterrupted window
   before assuming it crashed; watch `.expo/dev/logs/start.log` for `metro:instantiate` + netstat
   for the LISTENING line. No bundle is served until the dev client fetches (force-stop + deep-link
   relaunch, then `metro:bundling:done` in the log).
8. **DB inspection** (worked great this session): pull db + -wal + -shm via
   `adb exec-out run-as com.photogram.app cat files/SQLite/photogram.db*` → read with `node:sqlite`
   (E:\Dev\nodejs). NOTE: Git Bash mangles `/sdcard/...` paths — set `MSYS_NO_PATHCONV=1`.
   1 media row still has no discoverable date (epoch-1970) — falls back to save time on next scan.

### Next steps (roadmap order)
1. Owner resumes the bulk backup (≈13 GB; throttled 1.5 GB → 5 s pause, reactive FLOOD_WAIT).
2. S9 Telegram-group album sharing · real Albums/Archive/Hidden screens (Hidden + biometric toggle).
3. Polish: Viewer "Save to device" visual check (code path verified via bulk restore); 2 corrupt-file UX.

### LONG-TERM IDEAS BACKLOG (owner-curated)
- **Telegram as a versioned archive**: when a future editor changes a photo, keep original AND edit
  as separate Telegram messages linked in the DB — infinite, free, verifiable version history that
  falls naturally out of the architecture (owner: add when the photo editor lands).
- **Album organizer**: sort/organize shared-album photos by sender, by month (from S9 Q4).
- **S9 Phase 2 two-way sync** (docs/S9-DESIGN.md §3).
- Pending owner approval (proposed 2026-08-30): OCR text search at scan time (ML Kit), auto-backup
  of specific folders via media-library change subscriptions, "Safety check" screen.

### FIRST ACTIONS for the next session (2026-09-01 — v0.9 COMMITTED `53f857c`, tree clean, all verified)
1. **State: v0.7 + v0.8 + v0.9 all committed and device-verified.** The full stack works: gallery
   (grid + day headers + heartbeat + Stories + dice button), Albums/Shared albums (S9 one-way
   claim), Archive/Hidden (biometric), OCR search (687 rows indexed, search-proven), auto-backup,
   Safety check, upload-completion-confirmed worker (550+/1869 in Telegram = about 8 GB; the bulk
   backup runs automatically over the next days — 14 GB left; the 1.5 GB throttle is BY DESIGN).
2. Nothing is pending or broken. Next is roadmap: S9 topic sub-albums (fast-follow) · Phase 2
   two-way · album organizer (long-term, docs/S9-DESIGN.md §3) · versioned-archive idea (long-term
   backlog in §0 ideas). Ask the owner what they want next.
3. Shared machine/phone: the other agent runs photogram-bot Metro on 8081 (E:\Tools
odejs) —
   coordinate heavy work; never touch their processes. Phone: USB or wireless adb both work; after
   any reconnect run `adb reverse tcp:8083 tcp:8083` before relaunching the app.
4. Gradle is warm — next rebuild is fast. Keep the Aliyun/Tencent mirrors in android/build.gradle
   and long HTTP timeouts in gradle.properties (CNG — re-apply after prebuild).

---

## 0b. SESSION LOG (evening) — full loop verified, details kept for the debugging trail

**Everything below was TESTED LIVE on the Samsung, not just implemented:**

- **Rescan with photos: WORKS.** After APK rebuild (ACCESS_MEDIA_LOCATION added to manifest +
  app.config.ts) + `pm grant`, the ⟳ scan pulled in the whole library: **1,850 items — 1,717 photos +
  133 videos**, matching MediaStore exactly. Only 2 failed (genuinely corrupt image in
  `Avi stuff/NagramXF/Attachment/…`) and the banner now SHOWS failed count + first error.
- **Free-Up-Space: FIXED and verified.** Root cause was Android 11+ scoped storage: the app cannot
  delete files owned by other apps (WhatsApp) — `File.delete()` throws EACCES and the old code
  swallowed it. Fix: schema **v3** added `media.media_library_id` (the expo-media-library asset id,
  stored at scan time and backfilled on duplicate rescan), and `space.ts` now calls
  `MediaLibrary.deleteAssetsAsync(ids)` → SYSTEM confirm dialog ("Allow Photogram to delete this
  video?") → then verifies each file is actually gone before clearing local_uri (denied dialog = no
  DB change). Verified: file gone from disk, DB row correctly remote-only.
- **Restore-to-device (S7): WORKING end-to-end.** "Restore missing originals" row in Settings →
  confirm → downloaded the video from Telegram → saved into DCIM gallery → local_uri + new
  media_library_id stored. Byte size identical to the original. Debugging that led here:
  1. `getMessage()` returns a bare gson error `{"@type":"error","code":404}` even with the chat
     created — replaced with `getChatHistory` lookup (uploader's proven path) + `openChat` first
     (fresh chats return empty history for a few seconds) + retry loop.
  2. **The uploader stored PENDING message ids** — TDLib assigns a temporary id at send time and
     replaces it via `updateMessageSendSucceeded` (ids differ in low bits: DB had …313, real …312).
     Fixes: restorer matches by **filename** fallback and SELF-HEALS the stored id;
     `uploader.ts` now listens for `updateMessageSendSucceeded` and calls
     `replaceRemoteMessageId(old, new)` for future uploads.
  3. **gson JSON uses JAVA field names** (camelCase: `fileName`, `expectedSize`,
     `isDownloadingCompleted`, `downloadedSize`) — NOT TDLib wire snake_case. Also TDLib may
     classify small MP4s as `messageAnimation` (our 202 KB test video did!) — restorer handles
     document + animation + photo (largest size) content. `restorer.ts` has a `firstDefined`
     helper checking both conventions everywhere.
  4. Diagnostics that made this debuggable: restore failures carry the exact TDLib response shape;
     scan failures carry the first error; bulk-restore summary lists up to 2 error messages.
- **Pending-id note for future debugging:** ids in Saved Messages history are spaced 2^20 apart;
  a stored id that is "off by one" from a real message id is the pending-id signature above.

**Superseded notes below were the state BEFORE the v0.5 commit — kept for the debugging trail:**

---

## 0c. SESSION LOG (afternoon) — app revived over wireless adb, backup buttons added

**What happened this session (newest context first):**

- **App is no longer white-screening.** Root cause was simply that Metro was not running. Metro now runs
  on port 8083 (`E:\Dev\run-photogram-metro-fast.ps1` — same as the original script but WITHOUT
  `--clear`, so warm-cache rebuilds take ~1 min instead of ~3). Keep using the fast script after JS edits.
- **Wireless adb (no USB):** paired via `adb pair 192.168.x.97:<pairPort> <code>` (Settings → Developer
  options → Wireless debugging → "Pair device with pairing code"). The phone auto-connects after pairing;
  if it drops (Wi-Fi doze / screen off), open the Wireless debugging screen to wake adbd and read the
  CURRENT IP:port shown on that screen, then `adb connect <ip:port>`. **Binary transfers must use
  `adb exec-out` — plain `adb shell cat` corrupts binaries (LF→CRLF).**
- **Missing product feature found & implemented (uncommitted):** NOTHING ever enqueued uploads —
  `enqueueForUpload()` existed with zero UI callers, so "In cloud / In queue" were always 0. Added:
  - `GalleryScreen.tsx`: header pill "▲ Back up N" (N = local+failed rows on the loaded page) with
    confirmation Alert that queues all of them.
  - `ViewerScreen.tsx`: "Back up" ActionChip (enabled when state is local/failed) that queues one item.
  Both call `enqueueUpload(mediaId)`. (Verified live later the same day — see §0b.)
- **DB facts (pulled via `adb exec-out run-as com.photogram.app cat files/SQLite/photogram.db*` and read
  with `node:sqlite` on the PC — pull db + -wal + -shm together):** 93 media rows, ALL WhatsApp videos,
  12.99 GB total, every `taken_at` = epoch 1970 → the "56y / 1 Jan · 16" Memories card is a BUG ARTIFACT
  (missing video metadata dates), not real memories. 0 photos scanned — suspect Android granular media
  permission (only some items granted) — needs checking. Queue table empty.
- **TDLib login state:** the old session stopped being reported after a messy restart chain. Learned:
  a dev-launcher bundle RELOAD creates a new JS context while the NATIVE TDLib client persists
  (`startTdLib` then resolves "TDLib already started"), and TDLib can end up in a client state where
  auth calls fail with "Initialization parameters are needed: call setTdlibParameters first". A full
  `adb shell am force-stop com.photogram.app` + fresh launch resets everything (params get applied).
  **Rule: after weird login errors, always clean-restart the process before debugging code.**
- **`sendRaw()` in `lib/tdlib.ts` is inherently broken-but-cosmetic:** native `td_json_client_send` is
  fire-and-forget (resolves the string "Request sent successfully", never a TDLib response), so sendRaw
  always throws "Unparseable TDLib response for X". QR login still proceeds (updates arrive via the
  `tdlib-update` fan-out) but shows a confusing error. The uploader is NOT affected (it uses
  `td_json_client_send` directly + `getChatHistory` to find the sent message id). Long-term fix idea:
  correlate requests via TDLib `@extra` field against the update stream, or wrap client.send with
  a per-request handler in the native module. Touching `lib/tdlib.ts` = PROTECTED FILE → ask owner first.
- **Smoke test PASSED (2026-08-29 ~19:06):** login restored via clean process restart (no re-login needed);
  Viewer "Back up" chip on media id 78 (202 KB WhatsApp video) → upload_queue done → media state synced →
  remote_chat_id=<redacted> (own id = Saved Messages), remote_message_id=<redacted> → Settings shows
  "198 KB In cloud". Telegram-side confirmation by owner: **the video arrived and plays.**
  KNOWN REFINEMENT for later: the worker marks an item "done" as soon as the Telegram message EXISTS
  (fire-and-forget sendMessage + getChatHistory scan) — it does not await the file's remote upload
  completion (updateFile remote.uploaded_size) before marking done. For small files this is instant; for
  multi-GB videos the app may briefly claim synced while bytes are still flying. Consider awaiting
  upload completion (or showing a partial state) in a future pass.
- **PHOTOS-NOT-SCANNING bug — root-caused 2026-08-29 (two stacked causes):**
  1. **`scanner.ts` used `format: "jpeg" as never`** in `makeThumbnail` instead of the
     `SaveFormat.JPEG` enum — every PHOTO thumbnail threw and the per-item `catch` silently
     swallowed it (videos use expo-video-thumbnails, so only videos ever landed in the DB).
     Fixed to `SaveFormat.JPEG`. Scan banner now shows `· N failed (lastError)` so failures
     can never hide again.
  2. Even after fix 1, all 1717 photos failed with "Cannot access ExifInterface because of
     missing ACCESS_MEDIA_LOCATION permission" (getAssetInfoAsync needs it for EXIF/GPS).
     Fixed by declaring `ACCESS_MEDIA_LOCATION` in `app.config.ts` (android.permissions) AND
     manually adding it to `android/app/src/main/AndroidManifest.xml` (android/ is CNG — the
     manual line is wiped by any future prebuild; app.config.ts covers it after that).
     Gradle rebuild + `pm grant android.permission.ACCESS_MEDIA_LOCATION` required once.
- **Media permission history:** the phone had granted "Selected items" (READ_MEDIA_VISUAL_USER_SELECTED)
  which limited scans; full READ_MEDIA_IMAGES/VIDEO were granted via `adb shell pm grant`. The scanner
  now detects `accessPrivileges === "selected"` (ScanProgress.partialAccess) and alerts + banners with
  instructions to Allow-all.
- **Scan CTA gap:** the "Scan device library" button only existed on the EMPTY gallery screen — once
  items were scanned there was no way to re-scan. Added a permanent "⟳" scan button in the gallery
  header (next to Back up and search).
- **Scan paging note:** expo-media-library legacy on Android treats `after` as a numeric OFFSET and
  returns `endCursor = cursor.position` — the scanner's cursor loop is correct for this. Page
  totalCount = full MediaStore match count. Phone library: ~1850 items (1714 jpeg + 3 png + 133 videos).
- **Tab icons:** text glyphs (▦ ▤ ≡) replaced with `@expo/vector-icons` Ionicons — Gallery=cloud
  (Unlim-style), Collections=magnifier (owner's explicit pick), Settings=gear. @expo/vector-icons was
  installed for this (npm install @expo/vector-icons).
- **Free-Up-Space:** initially looked code-correct — the REAL root cause (scoped storage) was found
  in the evening session; see §0b.

---

## 1. What this project is

**Photogram** (`E:\Opencode CLI\Projects\photogram`) — an Android app (Expo / React Native) that clones
Google Photos / Immich but uses the user's **personal Telegram account as free unlimited cloud storage**.

Core product rules (do not violate):
1. **TDLib user account, not Bot API.** Login is keyless for end users: QR scan or tap-to-confirm
   (`requestQrCodeAuthentication`), exactly like Telegram Desktop. Developer api_id/api_hash live hidden
   in a gitignored file — users never see them.
2. **Uploads go ONLY to the user's "Saved Messages" chat.**
3. **SQLite is the gallery's source of truth.** Never fetch the whole gallery from Telegram on load.
   Local thumbnails (320px) + metadata are stored in `expo-sqlite`; Telegram is only the byte warehouse.
4. **Throttling is mandatory:** proactive pause of 5 s after 1.5 GB uploaded per session, plus reactive
   `FLOOD_WAIT_X` parsing (pause exactly X+1 s, retry ≤5 attempts).
5. UI: Material 3 dark theme, masonry gallery with Days/Months/Years pinch levels, Reanimated animations.

**User interaction style:** the owner is not a professional developer. Explain steps simply, ask permission
before large installs or native-file edits, only commit when told (and then always update CHANGELOG.md).

---

## 2. Sibling project — DO NOT TOUCH

`E:\Opencode CLI\Projects\photogram-bot` is a DIFFERENT app (Telegram **Bot API** version, package
`com.photogrambot.app`) built by another agent. Never read/write/delete anything inside it.
This project must never migrate to the Bot API (50 MB file cap makes it useless for photo backup).

---

## 3. Architecture & data flow

```
[Device photos] --expo-media-library scan--> [dedupe gate] --> [SQLite media table]
                                                                   |
        [Gallery/Viewer UI reads ONLY SQLite]          [Upload queue table]
                                                                   |
                                              [TDLib sendMessage -> Saved Messages]
                                                                   |
                                              [updateFile events -> progress UI]
```

- Upload queue is persistent in SQLite (`upload_queue` table) and survives app kills.
- Thumbnails live in `FileSystem.cacheDirectory/thumbs/`; DB stores URIs, never blobs.
- Telegram IDs exceed JS safe-integer range → all ID columns are TEXT, bound as strings.

---

## 4. Tech stack (exact, as installed)

| Component | Version | Notes |
|---|---|---|
| Expo SDK | ~57.0.15 | RN 0.86.2, React 19.2.3, **New Architecture ONLY** (no legacy opt-out exists) |
| react-native-tdlib | 2.3.0 | Prebuilt `libtdjni.so` (3 ABIs). Classic NativeModule → runs via New-Arch interop. **Interop was proven working: app builds & launches** |
| expo-sqlite | 57.0.1 | async API (`openDatabaseAsync`), WAL mode, migrations via `meta.schema_version` |
| react-native-mmkv | 4.3.2 | **v4 API**: `createMMKV({id})`, `mmkv.remove(key)` (NOT `new MMKV`, NOT `.delete`) |
| zustand | 5.x | settings (persisted to MMKV), auth, upload stores |
| @shopify/flash-list | 2.0.2 | v2: `masonry` prop on FlashList; **no `estimatedItemSize` prop** |
| expo-image | 57.0.3 | prop is `transition={ms}` (NOT transitionDuration) |
| expo-media-library | 57.0.4 | **use `expo-media-library/legacy` subpath** for getAssetsAsync/MediaType.photo/SortBy |
| expo-image-manipulator | 57.0.12 | new chain API: `ImageManipulator.manipulate(uri).resize().renderAsync().saveAsync({format: SaveFormat.JPEG})` |
| expo-file-system | 57.0.5 | **new Blob-like API**: `new File(uri)`, `.exists`, `.size`, `.delete()`, `.slice()`; legacy API under `/legacy` |
| expo-video | 57.0.2 | `useVideoPlayer(source)` hook + `<VideoView player={...}>` (NOT `<Video>` component) |
| react-native-maps | 1.27+ | needs `google_maps_api_key` in tdlib.secrets.json (optional, pending) |
| Navigation | @react-navigation/native 7 + bottom-tabs + native-stack | RootStack: Tabs ⇄ Viewer/Trash/Map |
| reanimated | 4.5.1 | + react-native-worklets 0.10.1 (SDK-matched pair — do not bump independently) |

---

## 5. Environment (all on E: drive — C: has no space)

- **Node** `E:\Dev\nodejs` (v24.19.0) · **JDK 17** `E:\Dev\jdk\jdk-17.0.20+8` · **Android SDK** `E:\Dev\android-sdk`
- Env vars (JAVA_HOME, ANDROID_HOME, GRADLE_USER_HOME=E:\Dev\.gradle, npm cache=E:\Dev\npm-cache) are in
  **user registry** — fresh terminals get them; tool-host shells may need manual injection.
- **Google's SDK-manager downloader STALLS on this network (0 KB/s).** Proven workaround: kill build,
  `curl.exe -C - --retry 8` the zip from `dl.google.com/android/repository/...`, extract manually:
  - NDK r27b → `android-sdk\ndk\27.1.12297006\` (source.properties must show Pkg.Revision = 27.1.12297006)
  - Platform 36 → `android-sdk\platforms\android-36\` (android.jar present)
  - CMake → `android-sdk\cmake\3.22.1\bin\cmake.exe`
- Build script: `E:\Dev\run-photogram-build.ps1` (log `E:\Dev\photogram-build.log`) — runs
  `npx expo run:android` with env injected. **Do not pass `--device <serial>`** (expo wants a name; omit flag).
- Metro script: `E:\Dev\run-photogram-metro.ps1` (log `E:\Dev\photogram-metro.log`) — `expo start --dev-client`.
  After starting Metro: `adb reverse tcp:8081 tcp:8081`, then relaunch app or tap "Fetch development servers"
  in the dev launcher.
- Test device: Samsung SM-S942B, adb id `<redacted-serial>`, USB-debugging authorized for this PC.

---

## 6. Codebase map (src/)

| File | Role |
|---|---|
| `lib/tdlib.ts` | TDLib singleton: startTdLib with creds from `Constants.expoConfig.extra`, global `tdlib-update` event fan-out, `sendRaw()` with TdError mapping, fetchAuthorizationState/fetchProfile |
| `lib/qrLink.ts` | Converts TDLib `tdlib://…token=X` → `tg://login?token=X` (deep-link handoff + QR payload) |
| `lib/uploader.ts` | Worker loop: dequeue → sendMessage (inputMessagePhoto/inputMessageDocument, path without `file://`) → progress via updateFile → 1.5 GB/5 s throttle + FLOOD_WAIT backoff → setMediaRemote |
| `lib/scanner.ts` | expo-media-library/legacy paging scan → dedupe (quickFingerprint) → thumbnail (image: manipulator 320px; video: expo-video-thumbnails) → insertMedia with tags+GPS |
| `lib/dedupe.ts` | `quickFingerprint(size:mtime:fnv1a(name))`; optional SHA-256 content hash via head+tail 64 KB slices |
| `lib/stats.ts` | SQL aggregations for Settings dashboard (totals, 6-month buckets, formatBytes) |
| `lib/space.ts` + `lib/trash.ts` | Free-Up-Space (delete local originals of synced media), trash purge (30-day, also deletes Telegram messages), freeable-bytes counter |
| `lib/search.ts` | Query parser: "June 2026"/"2026"/"last month"/"today" → date-range SQL; else filename/tags LIKE |
| `lib/memories.ts` | "X years ago" groups (GROUP_CONCAT ids, ≥2 items, prior years) |
| `auth/authStore.ts` | Zustand phase machine: boot→choose→qr→phone→code→password→ready/fatal; drives from updateAuthorizationState; handles waitOtherDeviceConfirmation link |
| `db/schema.ts` + `db/index.ts` | Migrations v1 (tables) + v2 (tags, latitude, longitude, geo index); WAL, FK on |
| `db/queries.ts` | All typed SQL: insertMedia, pageVisibleMedia (keyset), queue ops, trash ops, search, geo list |
| `screens/LoginScreen.tsx` | M3 login: QR + "Open Telegram" handoff + phone/code/password fallbacks |
| `screens/GalleryScreen.tsx` | FlashList masonry, Days/Months/Years (segmented + pinch), search bar, Memories header, scan CTA, state dots |
| `screens/ViewerScreen.tsx` | Horizontal pager, zoom ScrollView, VideoView, meta sheet, Share/Archive/Hide/Delete |
| `screens/SettingsScreen.tsx` | Account, storage stats + chart, upload-quality chips, free-up-space, Wi-Fi/charging toggles, biometric toggle, live Uploads dashboard |
| `screens/TrashScreen.tsx`, `CollectionsScreen.tsx`, `MapScreen.tsx` | Trash grid with countdown; Collections hub; clustered map (graceful no-key notice) |
| `components/MemoriesCarousel.tsx` | Reanimated FadeInDown cards |
| `store/settingsStore.ts` | MMKV-persisted: exifPreserve, hiddenLockEnabled, wifiOnly/chargeOnly, uploadQuality ('storage_saver' default) |
| `store/uploadStore.ts` | Reactive queue state for Settings UI; THROTTLE_LIMIT_BYTES = 1_500_000_000 |
| `app.config.ts` | Reads `tdlib.secrets.json` (api_id, api_hash, optional google_maps_api_key) → expoConfig.extra; package `com.photogram.app` |
| `CHANGELOG.md` | **Per-commit notes (required by owner):** what the commit adds + next plan |

---

## 7. CURRENT STATUS — APK with TDLib built & verified, awaiting phone install

- ✅ Native build succeeded (46m 56s); APK installed; dev client launches
- ✅ **Red-error saga fully solved (3 separate bugs):**
  1. **"Cannot find native module 'CalendarNext'"** — was MU Weather's JS (other chatbot's project) served
     by MU Weather's Metro on port 8081 into Photogram's dev client. Not Photogram's bug.
     **Port map now: MU Weather = 8081 (theirs, do not touch) · Photogram = 8083 (ours).**
  2. **"TdLibModule not linked"** — react-native-tdlib was NEVER compiled into the APK. Its
     `react-native.config.js` used legacy keys (`sourceDir`, `packageImportPath`, `packageInstance`);
     the CLI v20+ schema rejects `sourceDir` and silently drops the whole `platforms` map →
     expo's autolinking skipped the module → no TdLibModule class, no libtdjni.so in APK.
     **Fix:** patched the config to declare only `packageImportPath`+`packageInstance` (schema accepts
     those; `sourceDir` auto-discovered). Verified: expo config command returns the correct import
     `com.reactnativetdlib.tdlibclient.TdLibPackage`.
  3. **tdlib pinned compileSdk 34** — Platform 34 not installed, and Google SDK downloads stall at
     0 KB/s on this network (§5). **Fix:** patched `android/build.gradle` to compileSdk/targetSdk 36.
  - Both patches persisted in `patches/` and auto-reapplied by `scripts/patch-tdlib.js` (npm postinstall).
    Do not remove until upstream fixes react-native-tdlib (2.3.0 is latest as of 2026-08-26).
- ✅ **New APK built & verified** (122.6 MB): `lib/arm64-v8a/libtdjni.so` (20.5 MB) present,
  138 TdLib class refs in dex. `BUILD SUCCESSFUL in 7m 24s`, `EXITCODE=0`.
- ⚠️ Build stability on this 8 GB machine: a 4-ABI parallel C++ build OOM-killed clang once
  ("LLVM ERROR: out of memory" in :react-native-gesture-handler). `android/gradle.properties` now has
  `reactNativeArchitectures=arm64-v8a`, `org.gradle.parallel=false`, `org.gradle.workers.max=2`.
  Keep these. (android/ is CNG — re-apply after any prebuild.)

**FIRST ACTIONS for the next session:**
1. Connect Samsung via USB (debugging authorized) → `E:\Dev\android-sdk\platform-tools\adb.exe devices`
   → `adb install -r android\app\build\outputs\apk\debug\app-debug.apk` (debug keystore unchanged →
   in-place update). No-USB fallback: send the APK to the phone (Telegram/Drive) and sideload.
2. Owner opens the **Photogram** app (NOT Expo Go — Expo Go can never run Photogram: no TDLib native).
   It auto-connects to `http://192.168.x.120:8083` (Metro runs there, `CI=1`, no Fast Refresh —
   restart via `E:\Dev\run-photogram-metro.ps1` after code edits).
3. Expected: TDLib LoginScreen (QR / tap-to-confirm). Then continue roadmap (S7 restore-to-device next).
4. Rebuild anytime with `E:\Dev\run-photogram-gradle.ps1` (log `E:\Dev\photogram-gradle.log`,
   ends `EXITCODE=0`). Keep the PC awake during builds — a shutdown killed one run mid-build.

---

## 8. Secrets & config

- `tdlib.secrets.json` (gitignored, NEVER commit, never paste values into code/docs) holds:
  `api_id`, `api_hash` (owner's own, registered at my.telegram.org), optional `google_maps_api_key`.
- If the file is missing: copy `tdlib.secrets.example.json`. Values are recoverable from the owner (chat history).
- Map tab is optional; without key it shows a setup notice instead of crashing.

---

## 9. Git & workflow conventions

- Commits ONLY when owner approves. **Every commit must include an updated `CHANGELOG.md` entry**
  (what it adds + next plan), newest-first at top.
- History: `028ada1` v0.1 foundation → `5985b46` v0.3 core loop+quick wins → `fe94f21` v0.4 search/memories/map.
- `android/` is gitignored (CNG — regenerated by prebuild). Never commit it. `NEXT_SESSION.md`, `AGENTS.md`,
  `CHANGELOG.md` are tracked docs.
- Remaining roadmap: S7 restore-to-device · S8 auto-albums · S9 Telegram-group album sharing ·
  real Albums/Archive/Hidden screens · People&Pets (Phase 2 ML) · photo editor lite.

---

## 10. Known API-drift traps already solved (don't re-trip)

- expo-file-system: use `File` class (`exists`, `size`, `delete()`, `slice().arrayBuffer()`); `readAsStringAsync` is legacy-only
- expo-media-library: import from `expo-media-library/legacy` for the classic functional API
- react-native-mmkv v4: `createMMKV()`, `.remove()` — no `new MMKV`, no `.delete()`
- expo-video: `useVideoPlayer` + `VideoView` (props: `nativeControls`, `allowsPictureInPicture`; NO allowsFullscreen)
- expo-image: `transition={ms}`; `recyclingKey` exists
- FlashList v2: `masonry` boolean prop; NO `estimatedItemSize`; MasonryFlashList export doesn't exist in v2
- expo-crypto: `digest(algo, BufferSource)` for bytes; `digestStringAsync` for strings
- SaveFormat enum: `SaveFormat.JPEG` (not the string "jpeg")
- MediaRow.trashed_at exists in schema; keep TS interface in sync (queries.ts)
- StyleSheet: `absoluteFillObject` unavailable in this RN — use `absoluteFill`
