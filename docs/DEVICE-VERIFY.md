# Device verification runbook (v0.34.1 → v0.54)

Everything below verifies the **real app on a real phone**. Probe/static/tsc already cover
logic; this file only covers what Node cannot: native modules, OS surfaces, and the actual
Telegram round-trip.

Order matters: **cheap + read-only first, destructive (Free up space) LAST**, and never
while the bulk backup is uploading.

---

## 0. Preflight (automated)

1. Plug the phone in via USB with USB debugging on (or `adb connect <ip>:<port>` for the
   phone's *current* wireless-debug port — the old `192.168.29.97:35247` is stale).
2. Build the APK if needed (see §6 build notes). Two options now:
   - **Cloud (preferred, no PC needed):** `npx eas-cli@latest build --platform android
     --profile preview --non-interactive`, then download the APK from the build page and
     `adb install -r` it. The `preview` profile is a **standalone release APK** (JS bundled),
     signed with the same debug key, so it installs over the current app and keeps the data.
     It does **not** need Metro.
   - **Local debug build (dev client):** see §6. It needs Metro on port 8081, so start it in a
     second window before running the checks:

   ```
   cd "E:\Opencode CLI\Projects\photogram"
   npx expo start --dev-client --port 8081
   ```

   then run:

   ```
   powershell -ExecutionPolicy Bypass -File E:\Dev\verify-photogram.ps1
   ```

   The script auto-connects a paired wireless-debug device (mDNS) when USB is absent, sets
   `adb reverse tcp:8081`, deep-links `exp+photogram://expo-development-client/?url=…` so the
   app loads the bundle instead of the dev launcher, waits 30 s, and writes to
   `E:\Dev\device-verify\`:
   - `shot-<stamp>.png` — screenshot (eyeball the gallery renders, no red-box error overlay)
   - `logcat-<stamp>.txt` — grepped for `FATAL EXCEPTION` / `ReactNativeJS ... TypeError`
   - `db-<stamp>\photogram.db` — pulled with `run-as`, then summarised by
     `scripts/inspect-device-db.mjs` (schema version, state split, queue, bytes, freeable count)

3. Pass criteria: app launches to the gallery, screenshot shows photos (or the honest empty
   state), logcat has **no fatal/JS errors**, and the DB report shows `meta.schema_version`
   **20** (the app stores the version in `meta`, not in `PRAGMA user_version`, which stays 0)
   with a plausible `rows`/`bytes` count. A DB that was on 18 must migrate to 20 on first
   launch — that migration is part of this check.

> `run-as` only works on a debug build (ours). On a release build the DB section is skipped
> and the manual checks below still apply.

---

## 1. Auth + core backup (must pass before anything else)

- [ ] Login screen completes tap-to-confirm (or the existing session resumes to the gallery).
- [ ] Gallery shows the heartbeat line: `🔒 X/Y in Telegram` or `🔒 All N backed up`.
- [ ] Settings → Uploads shows a live queue or "No active upload" (not a spinner forever).
- [ ] One manual **Back up now**: pending count drops, and the DB report's
      `upload queue (not synced)` shrinks while `newest uploads` shows a fresh timestamp + `msg=` id.
- [ ] Kill the app mid-upload, reopen: no duplicate uploads (states return to `synced`/`pending`,
      never a stuck `uploading`).

---

## 2. People & Pets (v0.34 / v0.34.1) — native ML, heaviest risk

- [ ] Collections → **People & Pets** → model picker downloads FaceNet-128 (progress, then
      "downloaded"). Requires network; the file must land in app storage.
- [ ] Turn on **Find faces (People & Pets)** in Settings → Search.
- [ ] Let the backfill run (cursors in `meta`); the DB report's `meta` shows progress keys.
- [ ] People screen lists at least one cluster; rename one person; the name persists after restart.
- [ ] A photo that clearly has no face never lands in a cluster (spot-check 3–5).

If `react-native-fast-tflite` or the ML Kit detector is missing from the APK, this screen
throws instead of degrading — that is a rebuild problem, not a JS one.

---

## 3. Storage, integrity, export (v0.37 / v0.38 / v0.39)

- [ ] Settings → **Integrity report**: start a check; it resumes after backgrounding the app
      (kill + reopen → continues from its cursor, no restart-from-zero).
- [ ] Settings → **Export everything**: writes the manifest/bundle, share sheet opens, and the
      file is readable (open it once).
- [ ] Settings → **Junk sweeper**: "find junk" lists candidates; nothing is deleted without
      an explicit confirm.
- [ ] Trash → restore one item → it returns to the gallery and reappears in the DB report as
      `visibility=visible`.

---

## 4. Phase C features (v0.41 → v0.45)

- [ ] **Smart albums (v0.41)**: Collections → Build a smart album → stack 2+ filters (favorite
      + tag + date range) → save → results match the filters; reopen still runs the rules.
- [ ] **Anniversaries (v0.41)**: Settings → Notifications → Favorite anniversaries ON; the
      toggle persists after restart.
- [ ] **People search + pins (v0.42)**: type a person's name in gallery search → People chip
      appears → tap → that person's photos. Pin an album → it jumps to the top with "Pinned ·".
- [ ] **Upload window (v0.43)**: set a window that excludes *now* → uploads pause within ~1 min
      (queue stops shrinking) → widen the window → uploads resume. Turning it off always resumes.
- [ ] **Activity + requests (v0.44)**: open a shared album → "Recent activity" shows family
      adds newest-first; "📷 Ask" sends a request into the album's group chat (check Telegram).
- [ ] **Story (v0.45/v0.48)**: open a story → photos drift (Ken Burns), a video slide plays to
      its clip length, and quiet ambient music plays. Toggle Settings → Story background music
      OFF → reopen: no music (and no crash either way).
- [ ] **Wrapped v2 (v0.45)**: Collections → 2026 Wrapped → "Most-snapshotted person" and
      "Where the camera went" cards appear only when data exists.

---

## 5. Native OS surfaces + newest features (v0.46 → v0.54)

- [ ] **Widget (v0.46)**: long-press home screen → Widgets → Photogram → numbers appear
      ("bytes safe", "X of Y backed up", last upload, pending). Tap opens the app.
      *Numbers only — no file names, paths, album or contact names.*
- [ ] **Quick-settings tile (v0.46)**: edit the shade → add "Pause Photogram backup" → tap ON:
      the widget shows queuing paused and **new** queuing stops; tap OFF resumes. An upload
      already in flight finishes (the worker is untouched).
- [ ] **Onboarding checklist (v0.47)**: only on a fresh install with photos but zero uploads;
      the three steps reflect real state; Dismiss sticks after restart.
- [ ] **Album cover (v0.47)**: album → "🖼️ Cover" → pick a thumb → grid uses it; restart keeps it;
      if the chosen photo is later trashed, the album falls back without crashing.
- [ ] **Hindi (v0.52)**: Settings → Language → हिंदी → tab labels + gallery title/heartbeat +
      key Settings rows switch; any untranslated row stays English (never a raw `key.name`).
      Switch back to English.
- [ ] **Shortcuts (v0.53)**: long-press the launcher icon → "Open gallery" / "Albums" /
      "Settings" → each opens the right screen (cold start *and* warm start).
- [ ] **Merge duplicates (v0.54)**: Storage → "🧬 Merge duplicates" → groups render → tap a
      keeper → confirm → the rest move to Trash with reason `merge`; "restore merged" brings
      them back. **No permanent deletion.**

---

## 6. Free up space (v0.51) — LAST, and only after the rest passes

Preconditions: the ~8 GB bulk backup is **not** uploading, and you have verified a restore or
at least a few Telegram copies by hand.

- [ ] Storage → "🗑️ Free up space" shows a count/bytes. Confirm the number is plausible:
      favorites and anything younger than 7 days must be excluded.
- [ ] Note the phone's free space (Settings → Storage). Run **one small batch** (40 items). The
      gallery loses those files; Photogram shows them as cloud copies; the DB report shows
      `cloud_only` increased by exactly that batch and `state` still `synced`.
- [ ] The batch lands in the gallery's **Trash** (Android 11+ keeps deleted media for 30 days),
      so free space only returns after you empty it: gallery → Trash → Empty, or Files →
      Trash. Recheck Settings → Storage: the bytes should now be gone.
- [ ] Re-open Telegram Saved Messages: the batch's media is still downloadable.
- [ ] Trashed/hidden/archived rows never appear in the freeable list.

If a batch fails part-way, rows stay intact with their `local_uri` (safe to rerun) — that is
the designed behaviour, not a bug.

---

## 6b. Resume the bulk backup (after everything above)

- [ ] Settings → Uploads → resume; watch the pending count fall without new `FLOOD_WAIT` spikes
      (Settings → Diagnostics → "Last rate limit" stays empty/old).
- [ ] Do not install a new APK mid-upload (install kills the process).

---

## 7. Build notes for the person rebuilding

- Gradle needs the mirrors in `android/build.gradle` (aliyun/tencent) and long HTTP timeouts —
  see `docs/NATIVE-REAPPLY.md` §0.
- **Memory**: an 8 GB machine must not run WSL/Docker during the build. `android/
  gradle.properties` is tuned to `org.gradle.jvmargs=-Xmx1536m` +
  `kotlin.daemon.jvmargs=-Xmx1024m`; without that the Kotlin daemon dies with
  "paging file is too small".
- Build command (no daemon, avoids daemon bloat):

  ```
  cd android
  .\gradlew.bat :app:assembleDebug --no-daemon --console=plain
  ```

  APK lands at `android\app\build\outputs\apk\debug\app-debug.apk`.

---

## 7b. Run log — 2026-11-05 (SM-S942B, Android 17, debug dev-client APK)

Done and passing:
- 180,766,900-byte APK installed; cold start to the gallery, no red box.
- Heartbeat `🔒 1953/2186 in Telegram · last backup 18d ago`.
- **Schema migrated 18 → 20** on the live DB (`meta.schema_version`, ~2,199 rows,
  31.8 GB) — verified with `scripts/inspect-device-db.mjs` against a `run-as` pull.
- Session resumed without a QR (Account shows the Telegram name).
- Settings (upload queue live, storage stats, 6-month chart), Collections (Receipts 10,
  Documents 33), People & Pets all render.
- FaceNet-128 (~23 MB) downloaded → **SELECTED**, model at `files/models/facenet-128.tflite`;
  "Find faces in photos" ON; Step 3 shows `2312 photos left to detect · 0 faces to embed`.
- Uploads resumed by themselves: 734 pending / 2,215 done / 0 failed.

Found on the device and fixed in v0.54.2:
- **7 photos stranded in `uploading` since 2026-10-17** — orphaned `active` queue rows after a
  kill are never reset at boot, and `nextQueued()` only reads `pending`. Now swept at mount.
- People & Pets still claimed face grouping "arrives in the next update" (shipped in v0.34.1).
- Auto-backup folder picker said "No device albums found" when `getAlbumsAsync` threw.
  Check logcat for `[settings] getAlbumsAsync failed` to see the real error.

Still to check by hand: widget, quick-settings tile, onboarding card, album cover, Hindi
switch, launcher shortcuts, merge duplicates, integrity/export/junk/trash, and **free up space
last** (only after the upload queue drains). The debug build needs Metro running; if the app
is killed it opens the dev launcher until the bundle is served again.

---

## 8. Report template

For each unchecked box, note: screen, what you did, what you expected, what happened, and grab
a screenshot + `adb logcat -d > logcat.txt`. A failing native surface (widget/tile/faces/audio)
almost always means the APK predates that module — check `adb shell dumpsys package
com.photogram.app | Select-String versionName` against the CHANGELOG.
