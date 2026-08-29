# Photogram — Commit Notes

Each entry below documents what a commit adds and what comes next. Newest first.

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
