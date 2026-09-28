# Photogram — Feature Plan v0.13 → v0.20 (eight features)

Status: PLAN ONLY (no code written). Prepared 2026-09-06.
Companion reading: `NEXT_SESSION.md` §0 + §10 (traps — binding), `CHANGELOG.md` v0.10 → v0.11.2, `docs/PLAN-FEATURES-v0.11-plus.md` (format precedent).

**How to read this:** every section below is self-contained — the owner can approve features one at a time; each feature = one version = one commit + one `CHANGELOG.md` entry, built and verified on the phone BEFORE its commit.

---

## 0. The request (quoted, condensed)

> Plan exactly these 8 features, in the owner's FIXED order, one per version v0.13 → v0.20:
> 1. Favorites (heart on media, a way to see all favorites, schema migration)
> 2. Gallery multi-select (long-press → tick tiles → bulk Back up / Archive / Hide / Delete, select-all + count)
> 3. Timeline scrubber (drag bar to jump months/years in the Days masonry, date under the finger)
> 4. Notifications (expo-notifications, strictly opt-in; "backup finished" + "on this day"; gradle rebuild)
> 5. Year-in-review "2026 Wrapped" (stats screen on `src/lib/stats.ts` + new aggregations, card UI)
> 6. Photo editor lite + versioned archive (crop/rotate/brightness/contrast/saturation; edited copy uploaded as a REPLY to the original's message; DB links via `edited_from`; must reuse the rate-limit ladder + `setMediaRemote` state machine; NO native rebuild unless unavoidable)
> 7. Quick "Send to album" from Viewer (send current photo into a linked shared-album group so the claimer picks it up cleanly)
> 8. Place-name search (offline reverse geocoding at scan time, NO network; city-level name alongside latitude/longitude; search matches it)
>
> Constraints: sibling agent's uncommitted Junk Sweeper (v0.12) is untouchable; schema changes are v8+, additive, tolerant of v7 landing first or never; protected files additive-only with owner approval; nothing bypasses the FLOOD_WAIT ladder / budgets / inter-message gap; the upload worker is off-limits while a bulk backup is mid-flight; every feature ships behind its own commit + CHANGELOG entry after owner device verification.

---

## 1. Executive summary

These eight versions make Photogram feel finished: mark the best photos (v0.13), fix mistakes in bulk (v0.14), fly through years of gallery (v0.15), get told when backup completes and when memories resurface (v0.16), celebrate the year (v0.17), edit photos without losing the original (v0.18), drop a photo into a family album with one tap (v0.19), and find photos by place name without any network (v0.20).

The guiding rule stays **add, don't rewrite**. Every feature is a new module or a new screen plus at most one additive migration; the proven engines (scanner, uploader, claimer, restorer, trash, search) are reused as-is. Only **one feature needs a gradle rebuild** (v0.16, expo-notifications). Only three features touch the database, all additive (v8, v9, v10).

### Order / gates table

| Version | Feature | Schema migration | Gradle rebuild | New dependency | Touches sibling-shared files* | Effort |
|---|---|---|---|---|---|---|
| v0.13 | Favorites | **v8** (additive) | NO | none | YES — `src/db/schema.ts`, `src/db/queries.ts`, `src/navigation/index.tsx` | **M** |
| v0.14 | Gallery multi-select | none | NO | none | no | **M** |
| v0.15 | Timeline scrubber | none | NO | none (reanimated already installed) | no | **M** |
| v0.16 | Notifications | none | **YES** (new native module) | expo-notifications (exact SDK-57 version via `npx expo install`) | YES — `App.tsx`, `package.json`, `package-lock.json` | **M** |
| v0.17 | 2026 Wrapped | none | NO | none | YES — `src/navigation/index.tsx` | **S** |
| v0.18 | Photo editor lite + versioned archive | **v9** (additive) | NO (JS-only approach) | none — `jpeg-js` is already in `package.json` | YES — `schema.ts`, `queries.ts`, `navigation/index.tsx`; plus **uploader.ts** (2 small hunks, owner-approved, worker idle) | **L** |
| v0.19 | Send to album | none | NO | none | YES — `queries.ts`; plus **uploader.ts** (1 guard hunk, owner-approved, worker idle) | **S** |
| v0.20 | Place-name search | **v10** (additive) | NO (bundled JS dataset) | none (dataset file bundled as an asset; final library picked before coding) | YES — `schema.ts`, `queries.ts` | **M** |

\* Sibling-shared files = files the sibling agent has modified-uncommitted right now (`App.tsx`, `package.json`, `package-lock.json`, `src/db/queries.ts`, `src/db/schema.ts`, `src/navigation/index.tsx`) plus their untracked files (`src/lib/imageAnalysis.ts`, `src/lib/junk.ts`, `src/lib/junkAutoSweep.ts`, `src/screens/JunkSweeperScreen.tsx` — never touched by this plan).

### Standing discipline for every feature (binding)

1. **Sibling coexistence.** Never revert, delete, or reformat the sibling's edits or untracked files. Our edits to shared files stay SMALL and LOCALIZED (appenditive migrations at the bottom of `schema.ts`; new query functions appended in their own labeled sections; route lines added as separate hunks). At commit time, **only our hunks get staged** (`git add -p` on shared files; the sibling's junk hunks stay unstaged/untracked). Never stage the whole file blindly.
2. **Schema versioning.** The sibling's uncommitted migration is **v7** (already written in `src/db/schema.ts` as `SCHEMA_V7`). Every migration in this plan is **v8 or later, additive only** (new columns / new indexes / new nullable columns), and independent of v7 — the runner in `src/db/index.ts` iterates `MIGRATIONS` filtered by `version > current`, so the chain works whether v7 lands first, later, or never. `src/db/index.ts` itself is NEVER modified (protected, and the runner is already generic).
3. **Protected files.** `src/lib/tdlib.ts`, `src/lib/qrLink.ts`, `src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`, `src/db/schema.ts` + `src/db/index.ts`, `app.config.ts` — additive changes only, and **every occurrence is flagged per feature for owner approval**. This plan touches only `src/db/schema.ts` (appenditive migrations). None of the others are touched by any feature.
4. **Upload worker safety.** Nothing may bypass the FLOOD_WAIT escalation ladder, the 25 GB/day + 4 GB/hour budgets, or the inter-message gap. All send paths go through the existing `upload_queue` → `runOne` machinery. Where v0.18/v0.19 need changes inside `src/lib/uploader.ts`, they are small guarded additive hunks, **implemented and committed only while the worker is idle** (owner confirms no bulk backup mid-flight; Pause in Settings stops the worker for the session).
5. **Expo SDK 57.** Exact APIs verified at https://docs.expo.dev/versions/v57.0.0/ before coding each feature. All NEXT_SESSION §10 traps stay binding: `File` class, `expo-media-library/legacy`, `createMMKV()`/`.remove()`, `useVideoPlayer`+`VideoView`, `transition={ms}`, FlashList v2 `masonry` bool (no `estimatedItemSize`), `SaveFormat.JPEG` enum, gson camelCase + wire snake_case via `firstDefined`, Telegram ids > 2^53 ⇒ TEXT columns bound as strings.
6. **Gradle rebuilds.** Declared per feature above; only v0.16 needs one (~10+ min). The rebuild installs a new APK which kills the app process — never mid-upload (check logcat first).
7. **Shipping.** Each version = one commit + `CHANGELOG.md` entry ("Added in this commit" + "Verify on device when free"), only after the owner verifies the feature on the device. No commit without owner approval.

---

## 2. Feature sections

### v0.13 — Favorites ❤

**What the user gets.** A heart on any photo or video marks it as a favorite. Favorited tiles show a small filled heart right on the gallery grid, and a "Favorites" row in Collections shows every favorite in one grid. Favorites survive rescan, backup, and phone migration (they live in the local index, not in Telegram).

**Design.**

- **DB (schema v8, appenditive in `src/db/schema.ts`):**
  ```sql
  ALTER TABLE media ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_media_favorite ON media (is_favorite) WHERE is_favorite = 1;
  ```
  Partial index keeps the unfavored 99 % of rows out of it. Independent of the sibling's v7 (different table objects; order of application does not matter).
- **Queries (`src/db/queries.ts`, new labeled section `// --- F: Favorites ---`):**
  - `setMediaFavorite(id, fav)` — single UPDATE.
  - `listFavorites(limit = 600)` — `SELECT * FROM media WHERE is_favorite = 1 AND visibility = 'visible' ${EXCLUDE_ALL_SHARED} ORDER BY taken_at DESC` (own media only, matching the Memories/heartbeat rule; family-claimed media excluded).
  - Extend the `MediaRow` interface with `is_favorite: number` (SELECT * already returns the column; the TS interface is the only sync needed).
- **UI touchpoints:**
  - **Viewer** (`src/screens/ViewerScreen.tsx`): one more `ActionChip` — Ionicons `heart` / `heart-outline` — toggling `setMediaFavorite`; reflects the current row's state and updates when swiping (derive from `rows[currentIndex]`).
  - **Gallery tiles** (`src/screens/GalleryScreen.tsx`): a small heart **button** in each tile's top-left corner (nested `Pressable` — inner pressable wins, so tapping the heart does NOT open the Viewer; the tile body keeps opening the Viewer). Outline when off, filled when on. Date badge sits bottom-left, state dot top-right — no collisions. The heart button is always visible at reduced opacity (a hidden-until-press gesture is reserved territory: long-press becomes multi-select in v0.14).
  - **Collections** (`src/screens/CollectionsScreen.tsx`): new enabled row "Favorites" → route.
  - **New screen** `src/screens/FavoritesScreen.tsx`: 3-column `FlashList masonry` of favorites (pattern copied from `AlbumScreen.tsx`'s grid), tapping opens the Viewer with the favorites id list.
  - **Route** (`src/navigation/index.tsx`): `Favorites: undefined` in `RootStackParamList` + one `Stack.Screen`.
- **Trade-offs / alternatives considered:**
  - *Gallery filter chip vs Collections entry* — **Collections entry recommended**: the header already has 5 controls (scan, back-up, dice, search, segmented zoom); a filter chip would crowd it, and a Collections row matches the existing Archive/Hidden pattern exactly. A gallery "Favorites" filter can be added later additively.
  - *Double-tap tile to favorite* — rejected: single tap must open the Viewer, so double-tap needs a tap-delay that makes the grid feel laggy, and double-tap in the Viewer is expected to zoom.
  - *Storing the flag in Telegram (caption/reaction)* — rejected: would couple a UI preference to TDLib writes and the rate-limit ladder for zero backup value; local-only is instant and survives restore (flag persists in the DB across migration because F1 rehydrate rebuilds rows locally... note: a fresh F1 migration rebuild does NOT restore favorites — accepted; favorites are per-device state, stated in the CHANGELOG).

**Task breakdown (ordered).**
1. Schema v8 appended in `src/db/schema.ts` (SCHEMA_V8 + MIGRATIONS entry). *Acceptance: `npx tsc --noEmit` clean; launch on device → `meta.schema_version` = 8 (or 7→8 with sibling's tree), `PRAGMA table_info(media)` shows `is_favorite`, existing rows unchanged.*
2. Query functions + `MediaRow` field in `src/db/queries.ts`. *Acceptance: tsc clean; toggling a row via the Viewer flips the value in a pulled DB.*
3. Viewer heart chip in `src/screens/ViewerScreen.tsx`. *Acceptance: heart reflects state, tap toggles instantly, survives swipe to next photo (state follows the current row).*
4. Tile heart button + badge in `src/screens/GalleryScreen.tsx` renderItem. *Acceptance: tapping the heart toggles WITHOUT opening the Viewer; tapping the tile body still opens the Viewer; heart survives Fast Refresh / scroll recycling (`recyclingKey` unchanged).*
5. FavoritesScreen + Collections row + route in `src/navigation/index.tsx`. *Acceptance: Collections → Favorites shows exactly the hearted items; empty state shows a plain "No favorites yet" text.*
6. CHANGELOG entry + `git add -p` staging of only our hunks. *Acceptance: `git diff --cached` shows no junk-sweeper lines; owner device pass done.*

**Verify on device (owner).**
- [ ] Heart a photo in the Viewer → tile shows the filled heart; un-heart → gone.
- [ ] Collections → Favorites shows the hearted set; open one → Viewer works.
- [ ] Favorite a video too — same behavior.
- [ ] Rescan the library → hearts survive (rows are duplicates, not re-created).
- [ ] No regression: date badges, state dots, backup pill all render as before.

**PROTECTED-FILES-TOUCHED: YES — `src/db/schema.ts` only** (appenditive v8). **Rebuild: NO.**

---

### v0.14 — Gallery multi-select

**What the user gets.** Long-press any gallery tile and the gallery switches into selection mode: a bar at the top shows "N selected" with Select all and a cross; every tile gets a tick circle; tapping tiles toggles them. A bar at the bottom offers Back up / Archive / Hide / Delete. Delete puts everything into the existing 30-day Trash (nothing is destroyed immediately). Tap "✕" (or press back) to leave selection mode.

**Design.**

- All UI work in `src/screens/GalleryScreen.tsx` (the file is NOT sibling-shared — free to edit):
  - State: `selectionMode: boolean`, `selectedIds: Set<number>` (useState; `extraData` gains both so FlashList re-renders ticks).
  - Tile `Pressable` gains `onLongPress` → enter selection mode with that tile selected. In selection mode `onPress` toggles the tick instead of navigating.
  - Tick overlay: top-left circle (Ionicons `checkmark-circle` / `ellipse-outline`); the v0.13 heart button hides while in selection mode (one gesture layer at a time).
  - Header swaps to the selection bar: "N selected" + "Select all" (selects every loaded row — see trade-offs) + "✕".
  - Bottom action bar (fixed, mirrors the Viewer's `actionsBar` styling): Back up (enabled when ≥ 1 selected row is `local`/`failed`), Archive, Hide, Delete (danger).
  - Actions:
    - **Back up** → for each selected `local`/`failed` row, existing `enqueueForUpload(id)` (`src/lib/uploader.ts` — no changes; it already dedupes the queue). Confirm Alert with the count, same as the header pill.
    - **Archive / Hide** → existing `setMediaVisibility(id, 'archived' | 'hidden')` per row (`src/db/queries.ts` — no changes).
    - **Delete** → confirm Alert ("Move N items to Trash? They are deleted forever after 30 days.") → existing `setMediaVisibility(id, 'trashed')` per row — the exact trash flow the Viewer uses; purge-after-30-days, Telegram-side delete at purge, all unchanged.
  - After any bulk action: clear selection, remove affected rows from local state (or `loadFirstPage()`), refresh heartbeat.
- No schema, no new queries, no uploader changes.

**Trade-offs / alternatives considered:**
- *Select-all scope* — the gallery is keyset-paged (120 rows per page), so "Select all" selects **all loaded rows** and shows "N selected (of ~total)" if cheap to compute. Loading the whole library into state just for select-all would balloon memory for ~2k rows and break the paging cursor model — rejected.
- *Multi-select in AlbumScreen/Archive/Hidden too* — deferred; v0.14 is the main timeline only. The pattern localizes in GalleryScreen and can be copied later.
- *Delete bypassing trash* — rejected by default (see Assumptions #2); Trash is the safety net the owner already trusts.
- *Rubber-band selection (drag across tiles)* — nice but a custom gesture over FlashList v2 masonry; rejected for MVP effort, tick-tapping is proven UX.

**Task breakdown (ordered).**
1. Selection state + long-press entry + tick overlay + header bar in GalleryScreen. *Acceptance: long-press enters mode with that tile ticked; tap toggles; ✕/back exits cleanly; heart button hidden while selecting.*
2. Bottom action bar with Back up / Archive / Hide / Delete wired to existing queries. *Acceptance: tsc clean; each action fires the right confirm dialog.*
3. Bulk action execution + state refresh (rows removed, selection cleared, heartbeat refreshed). *Acceptance: archive 3 items → they leave the grid and appear in Collections → Archive; delete 2 → they appear in Trash with countdown.*
4. Select-all + count display + empty-selection edge (actions disabled when 0 selected). *Acceptance: select all → count equals loaded rows; actions disabled at 0.*
5. CHANGELOG entry. *Acceptance: owner device pass done before commit.*

**Verify on device (owner).**
- [ ] Long-press → selection mode; ticks follow taps; scroll + tick more (recycled tiles keep state).
- [ ] Select all → header count right; Back up N items → Settings → Uploads queue count grows by N, no duplicates in queue (dedupe intact).
- [ ] Archive / Hide bulks land in the right Collections screens.
- [ ] Delete bulk → Trash screen shows them with 30-day countdown; Restore one works.
- [ ] Pinch zoom (Days→Months→Years) still works while NOT selecting; long-press does not trigger it.

**PROTECTED-FILES-TOUCHED: NO. Sibling-shared files: NONE. Rebuild: NO.**

---

### v0.15 — Timeline scrubber

**What the user gets.** A slim bar on the right edge of the gallery (Days mode). Drag a handle down it and a bubble under your finger shows the month/year you're pointing at ("Mar 2025"); release and the gallery jumps so that month is at the top. Scroll position is never lost accidentally — a tiny "Top" chip appears after a jump to get back to now.

**Design.**

- **Jump-to-date, not pixel-scroll** — the load-bearing decision. Continuous dragging would need absolute pixel offsets for every variable-height masonry tile across all loaded pages; FlashList v2's ref API for that is a known risk. Instead: the rail maps a timestamp range, and release triggers a fresh paged query starting AT that month — reusing the existing keyset machinery exactly (`pageVisibleMedia(beforeTakenAt)` in `src/db/queries.ts`, no query change needed for the jump itself).
- **Range:** one new tiny query in `src/db/queries.ts` — `getTimelineRange(): { min, max }` (`SELECT MIN(taken_at), MAX(taken_at) FROM media WHERE visibility = 'visible' ${EXCLUDE_ALL_SHARED}`). The rail is linear in time between max (top) and min (bottom).
- **UI (`src/screens/GalleryScreen.tsx`, Days mode only):**
  - A reanimated rail (~28 px wide, full grid height) docked to the right edge, plus a draggable handle and a floating bubble showing `MMM YYYY` while dragging (`Gesture.Pan` with `runOnJS(true)` updating a shared value — matches the existing pinch gesture's style).
  - On release: compute the target month's first-ms-of-next-month → `loadPageAt(ts)` (a small refactor of `loadFirstPage` that takes `beforeTakenAt` and seeds `cursorRef` the same way). Show the "Top" chip; tapping it calls `loadFirstPage()`.
  - Searching state hides the rail (search results are not a timeline).
  - Bubble labels snap to month boundaries for readability; year boundaries render bolder ("2025").
- No schema. No rebuild. Reanimated + gesture-handler are already installed and built.

**Trade-offs / alternatives considered:**
- *Continuous fast-scroll (FlashList `scrollToOffset` math)* — rejected: variable tile heights + paged loading make offset math unreliable, and FlashList 2.0.2's ref-scroll surface needs verification anyway; jump-to-date is deterministic and uses only proven paths.
- *Scrubber on Months/Years modes too* — deferred; the ask scopes it to Days masonry. The rail component is built standalone so it can be re-docked later.
- *Loading the full date list for the rail* — unnecessary; MIN/MAX + linear time mapping is enough for month-accurate jumping.

**Task breakdown (ordered).**
1. `getTimelineRange()` in `src/db/queries.ts` + `loadPageAt(ts)` refactor of `loadFirstPage` in GalleryScreen. *Acceptance: tsc clean; calling loadPageAt(month X) on a debug button starts the grid at X and paging backward continues correctly (cursor seeded right).*
2. Rail + handle + bubble component (reanimated) in GalleryScreen. *Acceptance: drag shows month/year under the finger; labels snap to months; no jank while the grid is idle.*
3. Release → jump + "Top" chip + rail position reflects current head-of-grid month. *Acceptance: jump to "Mar 2025" → first tile(s) are March 2025; day headers correct; jump to the very top → identical to loadFirstPage.*
4. Edge cases: empty library (rail hidden), search open (rail hidden), range < 2 months (rail hidden). *Acceptance: each state verified.*
5. CHANGELOG entry. *Acceptance: owner device pass done.*

**Verify on device (owner).**
- [ ] Drag the rail slowly: bubble tracks months across years, ends at your oldest month.
- [ ] Release on a far-back month → grid starts there; scroll up from it continues into older months.
- [ ] "Top" returns to Today/Yesterday.
- [ ] Jump does not disturb uploads or heartbeat; no crash after jumping repeatedly.
- [ ] Months/Years zoom modes unaffected.

**PROTECTED-FILES-TOUCHED: NO. Sibling-shared files: NO. Rebuild: NO.**

---

### v0.16 — Notifications (strictly opt-in)

**What the user gets.** After the owner turns notifications on in Settings, Photogram may post two kinds of Android notifications: "Backup finished — 214 items uploaded" when the upload queue drains, and "On this day — 3 years ago you took 12 photos" once a day. Nothing is ever sent without the toggle; off = no notifications, full stop.

**Design.**

- **Dependency:** `npx expo install expo-notifications` (exact SDK-57 version resolved by expo). **New native module ⇒ ONE gradle rebuild needed** (`E:\Dev\run-photogram-build.ps1`). Local notifications only — **no Firebase/FCM setup, no push**, which is why `app.config.ts` stays untouched. Android 13+ runtime `POST_NOTIFICATIONS` permission is requested **only when the owner enables the toggle** (`requestPermissionsAsync`).
- **Settings UI (`src/screens/SettingsScreen.tsx`, new "Notifications" Section, placed after Auto-backup):**
  - Master toggle `notificationsEnabled` (opt-in gate; turning it on requests the OS permission and shows a one-line explainer "Photogram notifies you on this phone only. Turn off anytime.").
  - Two sub-toggles shown only when master is on: `notifyBackupFinished` (default ON), `notifyOnThisDay` (default ON).
  - Keys added to `src/store/settingsStore.ts` (MMKV-persisted, `set*` actions — existing pattern).
- **Notification engine — new `src/lib/notify.ts`:**
  - Channel setup once at enable-time: `backup` + `memories` channels, default importance.
  - **Backup finished:** subscribe to `useUploadStore` (zustand `subscribe` on `counts`) — when `pending + done-in-flight` transitions to 0 with `done` having increased since the last notification (MMKV `last_notified_done`), post a local notification "Backup finished · N items uploaded". This needs **ZERO changes to `src/lib/uploader.ts`** — the store already receives counts from `refreshCounts()`.
  - **On this day:** a daily in-app check following the proven `autoBackup.ts` / `junkAutoSweep.ts` loop pattern (started from `App.tsx` once auth phase = ready; hourly `setInterval`; MMKV `last_onthisday_notified` day-key prevents doubles). Query = prior-years same-month-day count over own visible media (same shape as `getMemories()` in `src/lib/memories.ts`, keyed to the owner's local calendar); fires a local notification at the first check after 09:00 local. Tap → opens the app (gallery); the "On this day" Stories card is already on the gallery header — tapping through to the exact Story via a navigation ref is an explicit non-goal for v0.16 (kept simple).
  - Honest limits stated in the CHANGELOG: backup-finished fires only while the app is running (the worker lives in-app); the daily on-this-day check fires on app open / while running, so a phone untouched all day may deliver nothing until the next open (scheduled OS triggers are possible later — deferred; Samsung aggressively defers third-party scheduled alarms when the app is killed, and honesty beats a flaky promise).
- **`App.tsx` change (small hunk — sibling-shared file):** `startNotifyLoop()` import + one call in the existing `phase === "ready"` effect block, next to `startAutoBackupLoop()` / `startJunkAutoSweepLoop()`.
- **Rebuild + install sequence:** build via the standing script → verify no in-flight uploads in logcat → `adb install -r` → relaunch (schema unchanged; no migration).

**Trade-offs / alternatives considered:**
- *expo-notifications vs react-native-push-notification* — expo-notifications is the SDK-57-native choice with the documented Android API; the older library is unmaintained.
- *Scheduled daily trigger (calendar trigger) for on-this-day* — more "real" notification behavior, but OEM deferral makes it unreliable when the app is killed; the in-app loop guarantees delivery whenever the app runs, which is when the owner is actually looking at their phone. Deferred, not rejected.
- *Deep-link tap → Story screen* — needs a navigation ref exposed globally; deferred to keep v0.16 surface small.

**Task breakdown (ordered).**
1. Install expo-notifications (`npx expo install`), add settingsStore keys + Settings section. *Acceptance: tsc clean; toggles persist across restart (MMKV).*
2. `src/lib/notify.ts`: channels + permission request + backup-finished watcher (store subscription). *Acceptance: with toggle on, queue ~3 photos → on drain one "Backup finished" notification appears; second drain without new completions → no duplicate.*
3. On-this-day daily check + App.tsx hook. *Acceptance: with a prior-year same-day photo in the DB and toggle on, notification fires once; MMKV day-key blocks a second; toggle off → nothing.*
4. Gradle rebuild + APK install (worker idle). *Acceptance: app boots; enabling the toggle shows the OS permission dialog once; denying it leaves toggles off but app stable.*
5. CHANGELOG entry (include the honest delivery limits). *Acceptance: owner device pass done.*

**Verify on device (owner).**
- [ ] Notifications OFF (fresh state) → zero notifications ever appear.
- [ ] Toggle on → OS permission prompt once; grant → backup-finished arrives after the queue drains.
- [ ] On-this-day arrives at most once per day; tapping opens Photogram.
- [ ] Toggle everything off → silence restored; restart app → still silent.
- [ ] Reboot the phone → no notification spam on boot.

**PROTECTED-FILES-TOUCHED: NO.** **Rebuild: YES (the only one in this plan).** Sibling-shared hunks: `App.tsx`, `package.json`, `package-lock.json`.

---

### v0.17 — Year-in-review "2026 Wrapped"

**What the user gets.** A "2026 Wrapped" screen: a stack of tasteful cards — "You took 1,842 photos and 133 videos this year", "17.4 GB safely backed up", "May was your busiest month (312 photos)", "Your top day: 14 Aug (48 photos)" with three thumbnails, "You captured 214 different days", "N favorites ❤". Entry via a Collections row.

**Design.**

- **New aggregation module `src/lib/wrapped.ts`** (read-only SQL, same style as `src/lib/stats.ts` — direct `getDb()` queries; `stats.ts` itself is NOT modified, keeping the Settings dashboard untouched):
  - `getWrapped(year: number)` returning: photos, videos, GB backed up (`state='synced'` bytes, `taken_at` in year), busiest month (`strftime('%Y-%m', taken_at/1000,'unixepoch')` group, own visible media), top 3 days (count + up to 3 thumb_uris each), days captured (distinct local dates), favorites count (`is_favorite = 1` — a v0.13 tie-in; query written so it works even if v0.13 is somehow absent — column exists after v8 ships, which v0.17 ordering guarantees).
  - All own-media scoped: `visibility != 'trashed'` + `${EXCLUDE_ALL_SHARED}` (consistent with every stats surface).
- **Screen `src/screens/WrappedScreen.tsx`:** vertical stack of Material-3 dark cards (theme tokens; `MemoriesCarousel`'s FadeInDown entrance pattern, staggered), a small year switcher chip row if more than one year has data (MVP: current year + prior years present in DB; default 2026).
- **Entry:** Collections row "2026 Wrapped" (`src/screens/CollectionsScreen.tsx`) + route in `src/navigation/index.tsx`.
- No schema, no rebuild, no new deps.

**Trade-offs / alternatives considered:**
- *Wrapped vs extending stats.ts* — new module chosen so the Settings dashboard stays byte-identical (sibling discipline: fewer shared-file hunks).
- *Streaks / "longest run of consecutive days"* — fun but fiddly date math for marginal delight; cut from MVP (can be one more card later).
- *Auto-showing the card on the gallery in December* — deferred; Collections row is the v0.17 entry point.
- *Sharing a Wrapped image* — deferred (would need view-shot rendering); numbers-only screens share badly anyway.

**Task breakdown (ordered).**
1. `src/lib/wrapped.ts` aggregations. *Acceptance: tsc clean; spot-check two numbers against a pulled-DB SQL query (e.g. busiest month, GB).*
2. WrappedScreen cards + stagger animation. *Acceptance: renders with real data; zero-item year renders an honest "Nothing here yet" card (no crash, no div-by-zero).*
3. Collections row + route. *Acceptance: Collections → 2026 Wrapped opens; back works.*
4. CHANGELOG entry. *Acceptance: owner device pass done.*

**Verify on device (owner).**
- [ ] Numbers match reality for a month you remember (spot-check busiest month, top day).
- [ ] Favorites count on the card matches the Favorites screen count.
- [ ] Cards animate in order; scrolling smooth; dark theme consistent.
- [ ] Empty-ish year (e.g. 2019) → graceful zeros, no crashes.

**PROTECTED-FILES-TOUCHED: NO. Sibling-shared hunks: `navigation/index.tsx` only. Rebuild: NO.**

---

### v0.18 — Photo editor lite + versioned archive

**What the user gets.** Open a photo, tap Edit, and fix it: rotate in 90° steps, crop with a draggable rectangle, and slide brightness / contrast / saturation. Save creates a SECOND version: the original photo stays untouched everywhere; the edit appears in Telegram **as a reply to the original's message** (the versioned-archive idea from the owner's backlog), and the Viewer's info sheet gains a "Versions" row linking original ↔ edits. All of it goes through the existing upload queue, ladder, and state machine.

**Design — editor approach (the "no rebuild" decision).**

- **Crop / rotate / flip: `expo-image-manipulator` chain API** (already installed, already built into the APK): `ImageManipulator.manipulate(uri).rotate(deg).crop({x,y,w,h}).renderAsync().saveAsync({format: SaveFormat.JPEG})`.
- **Brightness / contrast / saturation: pure-JS pixel pass with `jpeg-js`** (already in `package.json` — the Junk Sweeper's dependency, reused, no install): decode at a capped working resolution (long edge ≤ 2048 px — decode via the manipulator's `resize` first, then `jpeg-js.decode`), apply a per-pixel color-matrix pass (brightness offset, contrast factor, saturation via luminance lerp — ~10 lines of math each), re-encode with `jpeg-js.encode({quality})`. 2048-px encode ≈ 1–3 s on the device — shown as "Saving…" progress text, one-time cost.
  - Live preview: the SAME pixel math runs on the 320 px scan thumbnail (~30–60 ms per slider tick, debounced) so what you see is what you save.
- **Zero new native modules ⇒ zero gradle rebuilds.** `jpeg-js` decode/encode is pure JS; `expo-image-manipulator` is already compiled in.

**Design — versioned archive.**

- **DB (schema v9, one appenditive migration in `src/db/schema.ts`, independent of v7/v8):**
  ```sql
  ALTER TABLE media ADD COLUMN edited_from INTEGER REFERENCES media(id) ON DELETE CASCADE;
  CREATE INDEX IF NOT EXISTS idx_media_edited_from ON media (edited_from) WHERE edited_from IS NOT NULL;
  ALTER TABLE upload_queue ADD COLUMN reply_to_message_id TEXT;
  ```
  An edit is its own `media` row (so the existing `setMediaRemote` state machine — local → queued → uploading → synced — applies to it unchanged), pointing back at its original. `reply_to_message_id` on the queue row tells the worker to send THIS upload as a reply to an existing Telegram message instead of doing the preview-first dance.
- **Edit row construction (new `src/lib/imageEdit.ts`):** file saved under `Directory(Paths.document, "edits")`; `makeThumbnail` reused; `insertMedia` with `file_name` = the ORIGINAL's file name (deliberate: the uploader's caption-matching `findSentMessage` matches on fileName — keeping it identical keeps every existing path working), `taken_at` = original's, `state 'local'`, fresh fingerprint (different bytes → unique). Then `enqueueUploadWithReply(editRowId, uri, size, replyToMessageId = original.remote_message_id)` (new small query wrapper appended in `src/db/queries.ts`; `enqueueUpload` itself unchanged).
- **Uploader hunks (2 small ones in `src/lib/uploader.ts` — owner-approved, worker idle):**
  1. In `runOne`, when `item.reply_to_message_id` is set: skip the preview-first block (condition gains `&& !item.reply_to_message_id`) and set `sendPayload.reply_to = { "@type": "inputMessageReplyToMessage", message_id: Number(item.reply_to_message_id) }`. Everything else — budget gate, inter-message gap, `findSentMessage`, `waitForUploadConfirmed`, ladder — runs unchanged.
  2. `QueueRow` interface in `queries.ts` gains `reply_to_message_id: string | null` (SELECT * already returns it).
  Nothing bypasses the ladder; the send is a normal queued item with one extra field.
- **Keeping edits out of the main surfaces (queries.ts hunks, each one line `AND edited_from IS NULL`):** `pageVisibleMedia`, `searchMediaRaw`, `searchByDateRange`, `getRandomMedia`, `listGeoTagged`, `getSafetyReport` filter; `getBackupHeartbeat` + `getStorageTotals` in `src/lib/stats.ts`; `getMemories` in `src/lib/memories.ts`. Edits stay reachable ONLY via the original's Versions row (and Free-Up-Space/restore lists, where treating them as real files is correct). The sibling's `pageSweepCandidates` is deliberately NOT touched (a junk finding on an edit row is harmless noise, and that file is theirs).
- **UI:**
  - **New screen `src/screens/EditScreen.tsx`** (route `Edit { mediaId }`): image with rotate button, draggable crop rect (corner handles; free aspect — presets 1:1 / 4:3 / 16:9 as chips), three sliders, live preview, "Save" → creates the edit row + enqueues the reply-upload → back to Viewer. Original required to be `synced` (`hasRemoteCopy` from `src/lib/restorer.ts`) and have a `local_uri` — otherwise the Edit chip is disabled with a hint ("Back up this photo first" / "Save to device first").
  - **Viewer (`src/screens/ViewerScreen.tsx`):** "Edit" ActionChip (photos only, `mime_type` starts `image/`); info sheet gains a "Versions" MetaRow when `listVersionsFor(originalId)` (new query) returns rows — tapping opens the Viewer with `[originalId, ...editIds]` so the pager flips between versions.
  - Optional polish (one subquery + one badge): original tiles show a tiny "v2" badge when versions exist (EXISTS subquery in `pageVisibleMedia`). Cut first if time-boxed.
- **Delete semantics:** deleting an edit row = the normal trash flow (its Telegram message is purged by the existing trash purge). Hard-purging an ORIGINAL cascades to its edit rows (FK) — the edit's Telegram message may linger in Saved Messages as an orphan (harmless; noted in CHANGELOG).

**Trade-offs / alternatives considered:**
- *Native image editor library (e.g. react-native-image-editor kits, color-matrix native modules)* — all need gradle rebuilds and add maintenance; rejected per the "no rebuild unless unavoidable" constraint.
- *RN style `filter` prop for live preview* — still flagged experimental on this RN line; the JS-thumbnail preview gives bit-identical results with the final render instead of an approximation. Rejected.
- *Single-row edits (columns `edited_*` on the original)* — rejected: it breaks the `setMediaRemote` single-remote-link model and would need uploader branches writing to alternate columns; a separate row reuses the whole machine untouched.
- *Multi-level version chains (edit of an edit)* — `edited_from` always points at the ROOT original for v0.18 (an edit of an edit re-uses the root's remote message as reply target), giving a flat version list; a full tree is a later, additive change.
- *Working resolution 2048 px* — the storage-saver uploader already targets ≤ 2048 px; capping the editor there keeps memory (~13 MB buffers) safe on the 8 GB dev machine's target device. "Original" quality owners lose the ability to edit at full 12 MP — stated limitation.

**Task breakdown (ordered).**
1. Schema v9 + `MediaRow`/`QueueRow` interface fields + `listVersionsFor`, `enqueueUploadWithReply` in `src/db/queries.ts`. *Acceptance: tsc clean; device launch migrates to v9 (or 7→9), columns present, zero data loss.*
2. Exclusion hunks (`edited_from IS NULL`) in the nine listed queries. *Acceptance: a manually inserted fake edit row disappears from timeline/search/memories/heartbeat while remaining in `getMediaByIds`.*
3. `src/lib/imageEdit.ts` pixel pipeline (preview math + full-res save). *Acceptance: a unit-style check on device — brighten a test photo, save, pull the file, visually verify; encode time logged.*
4. EditScreen (rotate/crop/sliders/save) + Viewer Edit chip + route. *Acceptance: full edit round-trip on device; cancel discards everything.*
5. Uploader reply-to hunk + skip-preview condition (worker idle; owner approval). *Acceptance: edit of a synced photo lands in Saved Messages as a REPLY to the original's message (verified visually in the Telegram app); queue row goes done; edit row flips synced via the normal confirmation path.*
6. Versions row in the Viewer info sheet. *Acceptance: info sheet lists "Version 2 (edited)" for an edited photo; pager shows both.*
7. CHANGELOG entry (includes the 2048-px limitation + orphan-message note). *Acceptance: owner device pass done.*

**Verify on device (owner).**
- [ ] Edit a synced photo: rotate + crop + one slider → Save → "Saving…" completes; Viewer shows the edit in Versions.
- [ ] In the Telegram app: the edited photo appears as a reply under the original; original untouched.
- [ ] Gallery grid shows ONE tile for the photo (no duplicate row); Settings → Storage GB does not double-count.
- [ ] Delete the edit → gone from Versions; Trash shows it; original unaffected.
- [ ] Edit chip disabled (with hint) on a cloud-only photo and on a not-yet-synced photo.
- [ ] Regression: back up a NEW normal photo → preview-first format unchanged; heartbeat numbers correct.

**PROTECTED-FILES-TOUCHED: YES — `src/db/schema.ts` only** (appenditive v9). **Uploader touched: YES — 2 flagged hunks, worker-idle rule applies. Rebuild: NO.**

---

### v0.19 — Quick "Send to album" from Viewer

**What the user gets.** Viewing any photo that exists on this device, a "Send" chip lets you drop it straight into one of your linked shared-album Telegram groups. Family sees it in the group instantly; the photo also appears in that album inside Photogram. No re-uploading gymnastics — it rides the existing queue, ladder, and budgets.

**Design — matching what `claimer.ts` expects (read carefully; this drives everything):**

- The claimer accepts plain media messages (`messagePhoto` / `messageDocument` / `messageVideo` / `messageAnimation`) in group history — exactly what the worker's standard send produces.
- **Own-sender duplicates are safe:** our own message fingerprint-matches the existing row → claimer outcome "duplicate" → NO new library row ever appears (no double-post problem).
- **Single message per photo:** queue rows targeting a group (`chat_id` set) already skip the preview-first block (`!item.chat_id` condition in `runOne`) — the claimer never sees double posts. No change needed.
- **Caption = file name:** the worker already sends `caption = fileName`; the claimer's `extractMedia` reads document filenames from TDLib metadata and synthesizes `photo-<id>.jpg` for photos — all fine.

**Implementation.**

- **New `src/lib/sendToAlbum.ts`:**
  - `sendToAlbum(mediaId, albumId)`: validates the row has `local_uri` → `getSharedAlbum(albumId)` for `chat_id` → `enqueueUpload(mediaId, localUri, byteSize, chatId)` (the S9 phase-2 hook, already in `src/db/queries.ts`) → `dedupeUploadQueue()` → `refreshCounts()` → `startWorker()` — all existing exports; **no new queue plumbing**.
  - **Best-effort album link after send:** subscribe to `onUpdate` (`updateMessageSendSucceeded`) filtered to `chatId === album.chat_id` and caption containing fileName → `linkMediaToAlbum(albumId, mediaId, ownUserId, messageId, null)` (existing query). If matching misses, the photo simply stays unlinked in Photogram (the group still has it; the next "⟳ Claim new" treats it as a clean own-duplicate) — degraded, never broken.
- **One uploader guard hunk (`src/lib/uploader.ts`, owner-approved, worker idle — REQUIRED, not optional):** in `runOne`, before `setMediaRemote`: when the media row already has a remote link AND the target chat differs (`media.remote_chat_id && media.remote_chat_id !== chatId`), do NOT overwrite the Saved-Messages link — `setMediaState(id, 'synced')` instead. Without this, sending an already-synced photo to a group would clobber `remote_chat_id`/`remote_message_id` (breaking restore and F1's `findMediaIdByRemoteMessage`). Re-uploads to the same chat and fresh uploads (remote NULL) take the unchanged path.
- **One `queries.ts` hunk (small):** `dedupeUploadQueue` groups surplus pending rows by `media_id` only today — a photo pending for Saved Messages AND targeted at a group would lose one row. Change both GROUP BYs to `(media_id, COALESCE(chat_id,''))`.
- **UI (`src/screens/ViewerScreen.tsx`):** "Send" ActionChip (`paper-plane-outline`), shown when `current.local_uri` exists. Tap → bottom-sheet picker listing `listSharedAlbums()` (existing query; albums with their group titles) → confirm → send + "Sent to <album>" feedback. Topic-enabled groups: the message lands in General (no topic targeting in v0.19 — the claimer's opportunistic topic backfill will attribute it later; noted).

**Trade-offs / alternatives considered:**
- *Direct `sendMessage` outside the queue* — rejected by constraint (must reuse queue/worker so the ladder + budgets govern every send).
- *Duplicating the photo as a NEW media row targeted at the group* — rejected: creates a second library row for the same bytes; fingerprint chaos.
- *Skipping the uploader guard by not caring about remote ids* — rejected: silent restore breakage.

**Task breakdown (ordered).**
1. Uploader guard hunk + dedupe hunk (worker idle; owner approval). *Acceptance: tsc clean; re-send an already-synced photo to a test group → DB keeps the Saved-Messages remote link intact; queue row done; no duplicate library row.*
2. `src/lib/sendToAlbum.ts` + best-effort link subscription. *Acceptance: send one photo → it appears in the group in the Telegram app; album_media gains a row (or the documented fallback applies).*
3. Viewer "Send" chip + album picker sheet. *Acceptance: chip hidden for cloud-only rows; picker lists exactly the linked albums; cancel = no-op.*
4. CHANGELOG entry. *Acceptance: owner device pass done.*

**Verify on device (owner).**
- [ ] Send a photo to the "Photogram" test group → visible in the Telegram group; album "⟳ Claim new" reports it as duplicate/known — no second row in the library.
- [ ] The photo appears in the shared-album grid inside Photogram (link worked).
- [ ] The photo's "Back up" state and restore path still work exactly as before (remote link intact).
- [ ] Send while uploads are paused → item sits pending; resume → sends through the normal ladder.

**PROTECTED-FILES-TOUCHED: NO. Uploader touched: YES — 1 flagged guard hunk. Sibling-shared hunks: `queries.ts`. Rebuild: NO.**

---

### v0.20 — Place-name search (offline)

**What the user gets.** Every photo with GPS gets a place name (city/town level, e.g. "Pune, India") computed entirely on the phone at scan time — no network calls, ever. Typing "Pune" in the gallery search finds those photos, alongside the existing date/filename/tag/OCR matches. The Viewer info sheet shows "Place: Pune, India".

**Design.**

- **Approach: bundled offline dataset + nearest-neighbor in JS** (as directed; the exact library is being researched separately — the plan is written against this interface so the final pick slots in):
  - A bundled cities dataset (GeoNames-class, cities ≥ ~15 000 population ≈ 25–30 k entries; ~1.5–3 MB as compact JSON in `assets/geo/`, git-tracked, loaded lazily with `require()` on first GPS row).
  - New `src/lib/places.ts`: on first use, bucket all cities into a lat/lon grid (~0.5° cells — O(1) neighbor lookup per photo, ~26 k inserts once ≈ tens of ms; a k-d tree works too but grid buckets are simpler and equally correct for city-level accuracy). `nearestCity(lat, lon)` → `{ city, country }` → stored as `"Pune, India"`.
  - **Accuracy/size trade-offs (stated up front):** rural/wilderness photos resolve to the nearest city which may be 50+ km away (the place is a hint, not an address); small towns under the population cutoff inherit their nearest big city; dataset adds ~2 MB to the APK and the repo. These are accepted for v0.20; a higher-resolution dataset can be swapped later behind the same module interface.
- **DB (schema v10, appenditive, independent of v7–v9):**
  ```sql
  ALTER TABLE media ADD COLUMN place_name TEXT;
  CREATE INDEX IF NOT EXISTS idx_media_place ON media (place_name) WHERE place_name IS NOT NULL;
  ```
- **Scan-time integration (`src/lib/scanner.ts`, additive — mirrors the OCR pattern exactly):**
  - New rows: after `insertMedia` success, if `latitude`/`longitude` present → `setMediaPlace(id, nearestCity(...))` (new query in `src/db/queries.ts`).
  - Existing rows: the duplicates path already revisits rows on rescan (OCR backfill precedent) — add the same-shaped place backfill when `place_name` IS NULL and GPS exists. No App.tsx loop, no new settings toggle (the work is microseconds per photo; no cost to hide behind an opt-in).
- **Search integration (`src/lib/search.ts` + one line in `searchMediaRaw`, `src/db/queries.ts`):** the raw query gains `OR place_name LIKE ?` with the existing escaped-LIKE parameter; `parseDateQuery` untouched (a non-date term like "pune" already falls through to `searchMediaRaw`). Case-insensitivity: SQLite LIKE is ASCII-case-insensitive — sufficient for city names.
- **Viewer info sheet (`src/screens/ViewerScreen.tsx`):** `MetaRow k="Place" v={place_name}` when present.
- **Library pick gate (per the ask):** the final dataset/library is chosen BEFORE coding starts; the module boundary in `places.ts` (`loadIndex()` + `nearestCity(lat, lon)`) is the only thing the rest of the code sees, so a dataset swap never touches scanner/search.

**Trade-offs / alternatives considered:**
- *Android platform Geocoder* — rejected: its backend is network-dependent (violates the NO-network constraint) and inconsistent across OEMs.
- *Online reverse-geocoding APIs* — rejected outright (privacy + network).
- *Full street-level offline geocoder (e.g. offline protobuf tile lookup)* — hundreds of MB and heavy native parsing; absurd overkill for city-level search. Rejected.
- *Storing place at upload time instead of scan time* — scan time is where GPS EXIF is already read (`getAssetInfoAsync` with `ACCESS_MEDIA_LOCATION`); no reason to touch the uploader.

**Task breakdown (ordered).**
1. Pick the dataset (research gate — download, license check, size check) and vendor it into `assets/geo/`. *Acceptance: dataset + provenance + license recorded in the CHANGELOG; size ≤ ~3 MB.*
2. Schema v10 + `MediaRow` field + `setMediaPlace` in queries. *Acceptance: device migrates to v10 cleanly; column + partial index present.*
3. `src/lib/places.ts` (grid index + nearestCity) + dataset loading. *Acceptance: nearestCity for 3 known coordinates returns the expected cities in a quick device/debug check; cold index build < 200 ms.*
4. Scanner integration (new rows + rescan backfill). *Acceptance: rescan populates `place_name` for GPS rows; non-GPS rows stay NULL; scan progress unaffected.*
5. Search `OR place_name LIKE ?` + Viewer Place row. *Acceptance: search "pune" (lowercase) finds Pune photos; existing date/filename/tag searches unchanged.*
6. CHANGELOG entry (accuracy trade-offs stated). *Acceptance: owner device pass done.*

**Verify on device (owner).**
- [ ] Rescan → spot-check 3 photos' Place values against reality (a city you photographed in).
- [ ] Search the city name → those photos appear; search garbage → empty, no crash.
- [ ] Airplane mode → scan + search still work end-to-end (proof of offline).
- [ ] Viewer info sheet shows Place; photos without GPS show no Place row.
- [ ] Scan duration unchanged within noise (~1,850-item rescan).

**PROTECTED-FILES-TOUCHED: YES — `src/db/schema.ts` only** (appenditive v10). **Rebuild: NO (JS dataset bundled as an asset).**

---

## 3. Rules reminder (binding for every task in this plan)

1. **Sibling's work is untouchable.** Junk Sweeper v0.12 files (`App.tsx`, `package.json`, `package-lock.json`, `src/db/queries.ts`, `src/db/schema.ts`, `src/navigation/index.tsx` modifications + the four untracked `junk`/`imageAnalysis`/`JunkSweeperScreen` files) are never reverted, deleted, or committed by us. Shared-file edits stay small/localized; commits use `git add -p` so only our hunks land.
2. **Additive schema only, v8+.** `SCHEMA_V8` (Favorites), `SCHEMA_V9` (editor), `SCHEMA_V10` (places) appended in `src/db/schema.ts`; `src/db/index.ts` never modified; every migration independent of the sibling's v7.
3. **Protected files** (`src/lib/tdlib.ts`, `src/lib/qrLink.ts`, `src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`, `src/db/schema.ts` + `src/db/index.ts`, `app.config.ts`): this plan touches only `src/db/schema.ts`, appenditively, in v0.13 / v0.18 / v0.20 — each flagged above for owner approval. All other protected files: untouched.
4. **Upload worker safety:** every send path runs through `upload_queue` → `runOne` with the ladder, budgets, and inter-message gap intact. The v0.18/v0.19 uploader hunks are additive guards, implemented only while the worker is idle (owner confirms), and never weaken a gate.
5. **API drift traps (NEXT_SESSION §10)** remain binding everywhere: `File` class, `expo-media-library/legacy`, `createMMKV()`/`.remove()`, `useVideoPlayer`+`VideoView`, expo-image `transition={ms}`, FlashList v2 `masonry` bool (no `estimatedItemSize`), `SaveFormat.JPEG` enum, gson camelCase + wire snake_case via `firstDefined`, Telegram ids > 2^53 ⇒ TEXT columns bound as strings.
6. **Expo SDK 57:** verify exact module versions at https://docs.expo.dev/versions/v57.0.0/ before coding (esp. expo-notifications in v0.16).
7. **Shipping:** one feature = one version = one commit + CHANGELOG entry, only after the owner verifies on device. No commit without owner approval. v0.12 remains the sibling's slot; nothing here starts until the owner green-lights v0.13.

---

## 4. Assumptions to confirm with the owner

1. **Favorites lives as a Collections row** (not a gallery filter chip), with an always-visible small heart button on each tile (top-left) plus the heart chip in the Viewer. OK?
2. **Multi-select Delete goes through the 30-day Trash** (same as single delete) — no immediate-forever bypass. OK?
3. **Multi-select "Select all" covers all loaded rows** (the gallery pages 120 at a time), not the entire library. OK?
4. **Scrubber = drag-and-release jump to a month** (a bubble shows the month under your finger; the grid jumps on release), Days mode only — not continuous scrolling. OK?
5. **Notifications:** both sub-types default ON once the master toggle is on; "on this day" fires on app open/while running after 09:00 local (not a guaranteed scheduled alarm); tapping a notification just opens the app. OK?
6. **Wrapped scope:** current year (2026) by default with prior years browsable if data exists; entry via a Collections row; no streak card, no share-image in v0.17. OK?
7. **Editor:** MVP = rotate 90° steps + draggable crop + brightness/contrast/saturation sliders; edits render at up to 2048 px long edge (full-resolution originals are NOT re-encoded); edited copies upload as replies to the original's message; edited rows are hidden from the timeline/search and reached via the Viewer's Versions row. OK?
8. **Uploader hunks (v0.18 reply-to + v0.19 remote-link guard) are approved in principle**, to be implemented only while uploads are idle/paused — you pick the moment. OK?
9. **Send to album links your sent photo into the Photogram album grid** after the group send is confirmed; for topic groups the message lands in General. OK?
10. **Place search accepts the accuracy trade-off** (nearest-city resolution, ~2 MB dataset in the APK, towns under the cutoff inherit the nearest big city), with the final dataset/library picked before coding starts. OK?
