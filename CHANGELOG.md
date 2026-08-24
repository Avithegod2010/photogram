# Photogram — Commit Notes

Each entry below documents what a commit adds and what comes next. Newest first.

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
