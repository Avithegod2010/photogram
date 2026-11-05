# Deferred native work (needs a build + a device)

These items were designed but deliberately **not** coded yet. Each one changes the native
surface or the upload lifecycle, so it needs its own pass, a build, and on-device verification.
Nothing here is forgotten — it is the ordered queue.

Status of the big build (2026-11-06): the next build must include **`expo-updates`** (OTA
runtime), **schema v21** (checksum column), **widget v2** (memory photo), **wallpaper
rotation**, and the **share-sheet** intake. Bump `version` before building so the OTA runtime
matches.

---

## 1. In-app camera (grid + level) — next
- Deps: `expo-camera`, `expo-sensors` (DeviceMotion for the level).
- Screen: preview + 3×3 grid + horizon indicator; shutter, flash, front/back, tap-to-focus.
- Capture path: file → `MediaLibrary.createAssetAsync` → let the normal scanner import it
  (never insert into `media` directly; the scanner owns fingerprints/thumbnails/pHash).
- Verify: permission prompts, capture in both orientations, no duplicate row after scan,
  behaviour when the gallery permission is "selected photos" only.

## 2. Document scanner (perspective correction)
- Deps: ML Kit document scanner (`com.google.android.gms:play-services-mlkit-document-scanner`).
- Flow: launch the GMS scanner activity → returned page JPEGs → same MediaStore→scanner path.
- Risks: large native dependency, its own theming, and Play Services availability on the phone.
- Verify: scan a receipt with skew, confirm the corrected image lands in Documents.

## 3. WorkManager auto-backup + foreground service
- **Touches `src/lib/uploader.ts` (PROTECTED).** Design must be reviewed with the owner first.
- Goal: keep the upload alive when the screen sleeps, without duplicating the in-app worker.
- Sketch: a `CoroutineWorker` that starts the app's foreground service; the service only
  **holds the process** and posts progress — it must not implement a second queue.
- Hard rules: single writer to `upload_queue`; no new states; respect the FLOOD_WAIT ladder;
  never start while `pauseUploads` or the tile marker is active.
- Verify: 30-minute screen-off upload, kill/restart, queue counts identical, no duplicate
  Telegram messages.

## 4. Collage maker
- Needs `react-native-view-shot` (rasterise the composed view) + `expo-media-library` save.
- Layouts: 2×2, 3×3, 1+2; drag to reorder; export at a fixed long edge.
- Verify: output dimensions, no clipping, save→scan→backup round trip.

## 5. Year-in-review video
- Frame render (view-shot) → encoder (MediaCodec or ffmpeg-kit) → mp4 in cache → share sheet.
- Longest job of the list; only worth it after Collage proves view-shot on device.

## 6. Cast / DLNA to TV
- Separate project: SSDP discovery + a local HTTP server serving thumbnails/originals.
- Out of scope until the Play release is done.

## 7. Crash reporting (Sentry, privacy-scrubbed)
- `sentry-expo` + DSN in EAS secrets; scrub file paths, chat ids, names; opt-in toggle.
- Must be reviewed with the security pass before shipping.

---

## JS items still on the shelf (no build needed)
- **Light theme** — a real refactor: `theme` is imported as a constant by ~40 screens. Needs a
  context/provider and every `styles` object rebuilt. Do it as its own branch, not a tail-end.
- **Tablet / foldable two-pane layout** — gallery grid columns by width + a list pane.
- **Non-destructive history UI** — the version archive exists (`listVersionsFor`); needs a
  compare/revert screen.
- **Batch edit** — rotate is easy; crop/filter across a selection needs the editor refactored
  to accept a batch.
