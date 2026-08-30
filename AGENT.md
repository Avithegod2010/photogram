# PHOTOGRAM — COMPLETE HANDOFF FOR NEXT AGENT

_Last updated: 2026-08-30 evening — v0.6 committed (`e80fe6a`), v0.7 coded but NOT committed/verified (shared phone). Read NEXT_SESSION.md §0 first for the current state; this file holds the full reference._

---

## 1. PROJECT ESSENCE

**Photogram** (`E:\Opencode CLI\Projects\photogram`) — Android app (Expo / React Native) that clones Google Photos / Immich but uses the **user's personal Telegram account as free unlimited cloud storage**.

### Core Product Rules (NON-NEGOTIABLE)
1. **TDLib user account, NOT Bot API.** Login is keyless for end users: QR scan or tap-to-confirm (`requestQrCodeAuthentication`), exactly like Telegram Desktop. Developer `api_id`/`api_hash` live hidden in a gitignored file — users never see them.
2. **Uploads go ONLY to the user's "Saved Messages" chat.**
3. **SQLite is the gallery's source of truth.** Never fetch the whole gallery from Telegram on load. Local thumbnails (320px) + metadata stored in `expo-sqlite`; Telegram is only the byte warehouse.
4. **Throttling is mandatory:** proactive pause of 5 s after 1.5 GB uploaded per session, plus reactive `FLOOD_WAIT_X` parsing (pause exactly X+1 s, retry ≤5 attempts).
5. **UI:** Material 3 dark theme, masonry gallery with Days/Months/Years pinch levels, Reanimated animations.

### User Interaction Style
- The owner is **not a professional developer**. Explain steps simply, ask permission before large installs or native-file edits, only commit when told (and then always update `CHANGELOG.md`).

---

## 2. SIBLING PROJECT — DO NOT TOUCH

`E:\Opencode CLI\Projects\photogram-bot` is a **DIFFERENT app** (Telegram **Bot API** version, package `com.photogrambot.app`) built by another agent. **Never read/write/delete anything inside it.** This project must never migrate to the Bot API (50 MB file cap makes it useless for photo backup).

---

## 3. ARCHITECTURE & DATA FLOW

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
- Telegram IDs exceed JS safe-integer range → **all ID columns are TEXT, bound as strings.**

---

## 4. TECH STACK (EXACT, AS INSTALLED)

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

## 5. ENVIRONMENT (ALL ON E: DRIVE — C: HAS NO SPACE)

- **Node** `E:\Dev\nodejs` (v24.19.0) · **JDK 17** `E:\Dev\jdk\jdk-17.0.20+8` · **Android SDK** `E:\Dev\android-sdk`
- Env vars (JAVA_HOME, ANDROID_HOME, GRADLE_USER_HOME=E:\Dev\.gradle, npm cache=E:\Dev\npm-cache) are in **user registry** — fresh terminals get them; tool-host shells may need manual injection.
- **Google's SDK-manager downloader STALLS on this network (0 KB/s).** Proven workaround: kill build, `curl.exe -C - --retry 8` the zip from `dl.google.com/android/repository/...`, extract manually:
  - NDK r27b → `android-sdk\ndk\27.1.12297006\` (source.properties must show Pkg.Revision = 27.1.12297006)
  - Platform 36 → `android-sdk\platforms\android-36\` (android.jar present)
  - CMake → `android-sdk\cmake\3.22.1\bin\cmake.exe`
- **Build script:** `E:\Dev\run-photogram-build.ps1` (log `E:\Dev\photogram-build.log`) — runs `npx expo run:android` with env injected. **Do not pass `--device <serial>`** (expo wants a name; omit flag).
- **Gradle build script:** `E:\Dev\run-photogram-gradle.ps1` (log `E:\Dev\photogram-gradle.log`) — runs `gradlew.bat :app:assembleDebug` inside `android/` folder. Use this for faster rebuilds when only native changes.
- **Metro script:** `E:\Dev\run-photogram-metro.ps1` (log `E:\Dev\photogram-metro.log`) — `expo start --dev-client --host lan --port 8083 --clear`. After starting Metro: `adb reverse tcp:8083 tcp:8083`, then relaunch app or tap "Fetch development servers" in the dev launcher.
- **Test device:** Samsung SM-S942B, adb id `<redacted-serial>`, USB-debugging authorized for this PC.
- **Port map (CRITICAL):** MU Weather (other chatbot's project) = 8081 · Photogram = 8083. Do NOT let them share Metro ports.

---

## 6. CODEBASE MAP (src/)

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
| `lib/biometrics.ts` | Biometric auth for hidden folder |
| `auth/authStore.ts` | Zustand phase machine: boot→choose→qr→phone→code→password→ready/fatal; drives from updateAuthorizationState; handles waitOtherDeviceConfirmation link |
| `db/schema.ts` + `db/index.ts` | Migrations v1 (tables) + v2 (tags, latitude, longitude, geo index); WAL, FK on |
| `db/queries.ts` | All typed SQL: insertMedia, pageVisibleMedia (keyset), queue ops, trash ops, search, geo list |
| `screens/LoginScreen.tsx` | M3 login: QR + "Open Telegram" handoff + phone/code/password fallbacks |
| `screens/GalleryScreen.tsx` | FlashList masonry, Days/Months/Years (segmented + pinch), search bar, Memories header, scan CTA, state dots |
| `screens/GalleryPlaceholderScreen.tsx` | Placeholder for future implementation |
| `screens/ViewerScreen.tsx` | Horizontal pager, zoom ScrollView, VideoView, meta sheet, Share/Archive/Hide/Delete |
| `screens/SettingsScreen.tsx` | Account, storage stats + chart, upload-quality chips, free-up-space, Wi-Fi/charging toggles, biometric toggle, live Uploads dashboard |
| `screens/TrashScreen.tsx`, `CollectionsScreen.tsx`, `MapScreen.tsx` | Trash grid with countdown; Collections hub; clustered map (graceful no-key notice) |
| `screens/CollectionsPlaceholderScreen.tsx` | Placeholder for future implementation |
| `components/MemoriesCarousel.tsx` | Reanimated FadeInDown cards |
| `store/settingsStore.ts` | MMKV-persisted: exifPreserve, hiddenLockEnabled, wifiOnly/chargeOnly, uploadQuality ('storage_saver' default) |
| `store/uploadStore.ts` | Reactive queue state for Settings UI; THROTTLE_LIMIT_BYTES = 1_500_000_000 |
| `navigation/RootTabs.tsx` | Bottom tabs: Gallery, Collections, Map, Trash, Settings |
| `navigation/index.tsx` | Root stack with tabs + nested screens (Viewer, etc.) |
| `app.config.ts` | Reads `tdlib.secrets.json` (api_id, api_hash, optional google_maps_api_key) → expoConfig.extra; package `com.photogram.app` |
| `theme.ts` | Material 3 dark theme tokens (colors, spacing, radius) |
| `CHANGELOG.md` | **Per-commit notes (required by owner):** what the commit adds + next plan |

---

## 7. CURRENT STATUS — v0.6/0.7: ALBUMS + SHARING-READY UPLOAD ENGINE (2026-08-30)

- ✅ **v0.6 committed** (`e80fe6a`): S8 Auto-albums, cloud storage counts, upload-completion
  confirmation (synced only after bytes reach Telegram), queue dedupe (double "Back up" presses can
  no longer duplicate), taken_at ms-unit repair (year-58629 fix), and the Days-mode grid visibility
  fix (tiles had no aspectRatio → zero-height). All verified live on the Samsung.
- ✅ **Bulk backup ran live**: 270+ items (~1.9 GB) in Saved Messages; ~1,843 still pending. The
  worker AUTO-RESUMES on app restart; Pause in Settings → Uploads is session-only.
- ✅ **v0.7 coded, NOT yet device-verified nor committed** (owner's phone is shared with another
  automation agent — coordinate first): real Archive + Hidden screens (Hidden gated by
  `unlockHiddenAlbum()` unless the Settings biometric toggle is off), scanner failed-file-names UX
  (tap the scan banner), Wi-Fi-only / charge-only upload enforcement (`uploadHoldReason()`; the
  Settings toggles were decorative before). Charging detection needs the NEXT gradle rebuild to
  bring expo-battery's native module in; until then it fails open. Days-mode day-section headers
  (Today/Yesterday/date, via FlashList v2 masonry span) + persisted "Backed up today" counter also
  await verification.
- ✅ S9 groundwork: `src/lib/chats.ts` (`listMyGroups()` via raw td_json_client_send getChats/getChat).
- ✅ SDK patch packages aligned (`expo install --fix`, all 57.0.x patches + RN 0.86.3; JS-side only —
  the APK picks them up at the next gradle build, which also brings expo-battery native in).
- ⚠️ **SHARED PHONE**: another automation agent also drives this Samsung via wireless adb — confirm
  with the owner before adb/ui work; expect connection collisions. Skip device steps if it's busy.
- ✅ App connects via **wireless adb** (no USB): mDNS lists the service even when adbd sleeps —
  `adb mdns services` → `adb connect <ip:port>` (refused = phone asleep; owner wakes it via
  Settings → Developer options → Wireless debugging). After reconnect ALWAYS re-run
  `adb reverse tcp:8083 tcp:8083`. Use `adb exec-out` for binary pulls (plain `adb shell cat`
  corrupts). Git Bash mangles `/sdcard/...` paths — set `MSYS_NO_PATHCONV=1`.
- ✅ Metro runs on **8083** via `E:\Dev\run-photogram-metro-fast.ps1` (no --clear). CI=1 = no file
  watching: **restart Metro after every code edit**; first boot after an npm install can take 4+
  minutes — don't kill it prematurely. Then force-stop + deep-link relaunch the app.
- ⚠️ Gotchas that cost hours (details in NEXT_SESSION.md §0): TDLib client poisoning after bundle
  reloads (clean process restart fixes), gson uses JAVA camelCase field names, MediaLibrary
  timestamps are MILLISECONDS on this stack, small MP4s can be classified `messageAnimation`,
  `getMessage()` 404s (use getChatHistory + openChat + retry), scoped storage blocks cross-app
  deletes (use MediaLibrary.deleteAssetsAsync), Days-mode masonry tiles need explicit aspectRatio.

**FIRST ACTIONS for the next session:**
1. Read NEXT_SESSION.md §0 + its FIRST ACTIONS — they supersede anything stale below.
2. Coordinate with the owner about the OTHER agent's phone use, then connect (steps above) and
   device-verify the uncommitted v0.7 work (Archive/Hidden + biometric gate, scan-fail banner,
   Wi-Fi-only hold reason, day headers), then commit as v0.7 with a CHANGELOG entry.
3. Draft the S9 design with the owner (one-way "claim family uploads from a Telegram group" vs
   two-way), then build the chat-picker + album-claim flow on top of `src/lib/chats.ts`.
4. A gradle rebuild is due eventually anyway: it brings expo-battery native AND the SDK patch
   bumps into the APK (plus the Google Maps key if the owner adds one to tdlib.secrets.json).

### Historical — the original red-error saga (kept for context)

- ✅ **Native build SUCCEEDED** (7m 24s for gradle assembleDebug after manual NDK/Platform36/CMake install)
- ✅ **APK (122.6 MB) installed on the Samsung**; dev client launches; Metro connects on port 8083; **JS bundle loads**
- ✅ **Red-error saga fully solved (3 separate bugs):**
  1. **"Cannot find native module 'CalendarNext'"** — was MU Weather's JS (other chatbot's project) served by MU Weather's Metro on port 8081 into Photogram's dev client. Not Photogram's bug. **Port map now: MU Weather = 8081 (theirs, do not touch) · Photogram = 8083 (ours).**
  2. **"TdLibModule not linked"** — react-native-tdlib was NEVER compiled into the APK. Its `react-native.config.js` used legacy keys (`sourceDir`, `packageImportPath`, `packageInstance`); the CLI v20+ schema rejects `sourceDir` and silently drops the whole `platforms` map → expo's autolinking skipped the module → no TdLibModule class, no libtdjni.so in APK. **Fix:** patched the config to declare only `packageImportPath`+`packageInstance` (schema accepts those; `sourceDir` auto-discovered). Verified: expo config command returns the correct import `com.reactnativetdlib.tdlibclient.TdLibPackage`.
  3. **tdlib pinned compileSdk 34** — Platform 34 not installed, and Google SDK downloads stall at 0 KB/s on this network (§5). **Fix:** patched `android/build.gradle` to compileSdk/targetSdk 36.
- ✅ Both patches persisted in `patches/` and auto-reapplied by `scripts/patch-tdlib.js` (npm postinstall). **Do not remove until upstream fixes react-native-tdlib (2.3.0 is latest as of 2026-08-26).**
- ✅ **New APK built & verified** (122.6 MB): `lib/arm64-v8a/libtdjni.so` (20.5 MB) present, 138 TdLib class refs in dex. `BUILD SUCCESSFUL in 7m 24s`, `EXITCODE=0`.
- ⚠️ **Build stability on this 8 GB machine:** a 4-ABI parallel C++ build OOM-killed clang once ("LLVM ERROR: out of memory" in :react-native-gesture-handler). `android/gradle.properties` now has `reactNativeArchitectures=arm64-v8a`, `org.gradle.parallel=false`, `org.gradle.workers.max=2`. **Keep these.** (android/ is CNG — re-apply after any prebuild.)

**FIRST ACTIONS for the next session:**
1. Connect Samsung via USB (debugging authorized) → `E:\Dev\android-sdk\platform-tools\adb.exe devices` → `adb install -r android\app\build\outputs\apk\debug\app-debug.apk` (debug keystore unchanged → in-place update). No-USB fallback: send the APK to the phone (Telegram/Drive) and sideload.
2. Owner opens the **Photogram** app (NOT Expo Go — Expo Go can never run Photogram: no TDLib native). It auto-connects to `http://192.168.x.120:8083` (Metro runs there, `CI=1`, no Fast Refresh — restart via `E:\Dev\run-photogram-metro.ps1` after code edits).
3. Expected: TDLib LoginScreen (QR / tap-to-confirm). Then continue roadmap (S7 restore-to-device next).
4. Rebuild anytime with `E:\Dev\run-photogram-gradle.ps1` (log `E:\Dev\photogram-gradle.log`, ends `EXITCODE=0`). Keep the PC awake during builds — a shutdown killed one run mid-build.

---

## 8. SECRETS & CONFIG

- `tdlib.secrets.json` (gitignored, **NEVER commit, never paste values into code/docs**) holds: `api_id`, `api_hash` (owner's own, registered at my.telegram.org), optional `google_maps_api_key`.
- If the file is missing: copy `tdlib.secrets.example.json`. Values are recoverable from the owner (chat history).
- Map tab is optional; without key it shows a setup notice instead of crashing.

---

## 9. GIT & WORKFLOW CONVENTIONS

- **Commits ONLY when owner approves.** **Every commit must include an updated `CHANGELOG.md` entry** (what it adds + next plan), newest-first at top.
- History: `028ada1` v0.1 foundation → `5985b46` v0.3 core loop+quick wins → `fe94f21` v0.4 search/memories/map.
- `android/` is gitignored (CNG — regenerated by prebuild). Never commit it. `NEXT_SESSION.md`, `AGENTS.md`, `CHANGELOG.md` are tracked docs.
- Remaining roadmap: S7 restore-to-device · S8 auto-albums · S9 Telegram-group album sharing · real Albums/Archive/Hidden screens · People&Pets (Phase 2 ML) · photo editor lite.

---

## 10. KNOWN API-DRIFT TRAPS ALREADY SOLVED (DON'T RE-TRIP)

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

---

## 11. PROTECTED CORE FILES (DO NOT REMOVE OR REDESIGN WITHOUT ASKING)

- `src/lib/tdlib.ts`
- `src/lib/qrLink.ts`
- `src/auth/authStore.ts`
- `src/screens/LoginScreen.tsx`
- `src/db/schema.ts` + `src/db/index.ts` (SQLite foundation)
- `app.config.ts` (injects TDLib credentials from gitignored file)

---

## 12. QUICK REFERENCE — KEY COMMANDS

```powershell
# Start Metro (dev client) — runs on port 8083
E:\Dev\run-photogram-metro.ps1

# Reverse proxy for Metro
adb reverse tcp:8083 tcp:8083

# Launch app on device
adb shell am start -n com.photogram.app/.MainActivity

# Get JS errors from logcat
adb logcat -d -t 400 ReactNativeJS:* AndroidRuntime:E *:S

# Pull screenshots from phone
adb pull /sdcard/DCIM
adb pull /sdcard/Pictures/Screenshots

# Full native rebuild (only when native code changes)
E:\Dev\run-photogram-build.ps1

# Fast gradle-only rebuild (after patches, gradle.properties, build.gradle changes)
E:\Dev\run-photogram-gradle.ps1

# Install APK directly (debug keystore)
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

---

## 13. WHAT THE NEXT AGENT SHOULD DO IMMEDIATELY

1. **Read NEXT_SESSION.md §0** — the current state (v0.5, everything verified). This section below
   is the OLD first-build checklist, kept only for the historical commands.
2. **Connect the phone**: wireless adb (see §7) — or via USB (`adb devices` shows `<redacted-serial>`).
3. **Run the Metro script**, reverse proxy, launch app:
   ```powershell
   E:\Dev\run-photogram-metro-fast.ps1
   adb reverse tcp:8083 tcp:8083
   adb shell am start -a android.intent.action.VIEW -d "exp+photogram://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8083" com.photogram.app
   ```
4. The app should reach the Gallery directly (TDLib session persists on the phone). If login
   errors appear, force-stop the app once and relaunch before debugging anything.
5. **Then continue roadmap** — S8 auto-albums is next (see §0 / §9).

---

## 14. OWNER'S PREFERENCES (CRITICAL)

- **Explain simply** — owner is not a pro dev
- **Ask before** large installs, native file edits, or anything that could break the build
- **Only commit when explicitly told** — and always update CHANGELOG.md
- **Never touch** `photogram-bot` folder
- **Never commit** `tdlib.secrets.json` or any secrets
- **Never migrate** to Bot API

---

## 15. FILES YOU SHOULD READ NEXT (IN ORDER)

1. `NEXT_SESSION.md` — this exact content in a different format
2. `AGENTS.md` — strict rules for any AI agent
3. `app.config.ts` — see how secrets are injected
4. `src/lib/tdlib.ts` — TDLib initialization
5. `src/auth/authStore.ts` — auth state machine
6. `src/screens/LoginScreen.tsx` — login UI
7. `src/db/schema.ts` — database schema
8. `package.json` — exact dependencies
9. `scripts/patch-tdlib.js` + `patches/` — understand the native build fixes
10. `android/gradle.properties` — build stability settings

---

## 16. PATCH DETAILS (FOR FUTURE PREBUILD RE-RUNS)

If `npx expo prebuild` or `expo run:android` regenerates the android folder, you MUST re-apply these patches:

### Patch 1: `patches/react-native-tdlib.react-native.config.js`
Fixes CLI v20+ schema that rejects `sourceDir` and silently drops autolinking config. Only declares `packageImportPath` + `packageInstance`.

### Patch 2: `patches/react-native-tdlib.android.build.gradle`
Changes compileSdk/targetSdk from 34 → 36 because Platform 34 is not installed and Google SDK downloads stall on this network.

Both applied automatically by `scripts/patch-tdlib.js` (npm postinstall hook).

---

## 17. PORT MAP & METRO CONFLICT PREVENTION

**CRITICAL:** Two separate projects share this PC:
- **MU Weather** (other chatbot): Metro on port **8081**, adb reverse `tcp:8081`
- **Photogram** (this project): Metro on port **8083**, adb reverse `tcp:8083`

If you see "CalendarNext" or other unrelated errors, check `adb logcat` for the Metro port — it means the wrong Metro is being connected to. Always use `run-photogram-metro.ps1` which explicitly sets `--port 8083`.

---

**You now have the full context. The immediate next step is to install the APK, run Metro on port 8083, and verify the TDLib LoginScreen appears. Then we continue building features (S7 restore-to-device is next).**