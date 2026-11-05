# Photogram

A free, self-hosted alternative to Google Photos: your phone's photos are backed up to **your own
Telegram account** (Saved Messages and family groups/topics), so there is no subscription, no
third-party server and no lock-in. The gallery is a local SQLite index; Telegram is only the
byte warehouse.

Android · Expo SDK 57 · React Native 0.86 (New Architecture) · TDLib (real user account) · MIT.

## What it does

- **Backup** with preview-first uploads, EXIF preserved, a FLOOD_WAIT-safe rate ladder, Wi-Fi /
  charging / time-window rules, and a live heartbeat (`1953/2186 in Telegram`).
- **Trust tools**: backup health score, resumable integrity walk, restore drill that actually
  downloads random originals, SHA-256 checksums, re-upload of missing items, export of the whole
  index.
- **Organization**: albums, topic sub-albums, shared family albums with live group sync, smart
  albums (saved searches), duplicate merge, places, Scenes.
- **On-device intelligence**: ML Kit text/label/face detection, TensorFlow Lite face embeddings
  (People & Pets), pHash duplicate detection, OCR document albums, natural-language search
  ("beach 2024", "favorite videos").
- **Delight**: Memories, Wrapped, journal, highlights, stories with Ken Burns + ambient music,
  editor with versioned archive, widget, quick-settings tile, wallpaper rotation, share-sheet
  intake, launcher shortcuts.
- **Privacy by design**: no analytics, no cloud of ours, `allowBackup=false`, the biometric lock,
  and the option to keep family photos out of the timeline.

## Build it

Local tooling is documented in `docs/NATIVE-REAPPLY.md`. Cloud builds (no Android SDK needed):

```
npm install
npx eas-cli@latest build --platform android --profile preview
```

`preview` produces a standalone APK with the JS bundled; `development` produces a dev-client APK
that needs Metro. OTA updates for JS-only changes: `npx eas-cli@latest update --branch preview`.

Type-check and the full local test gate:

```
npm run probe   # esbuild bundle + 300+ data/ML checks + static guards + tsc
```

## Layout

```
src/screens/    one file per screen (gallery, viewer, albums, people, settings…)
src/lib/        the logic: uploader, scanner, integrity, people, search, wallpaper…
src/db/         schema.ts (append-only migrations) + queries.ts
plugins/        config plugins that re-apply native code on every prebuild
scripts/probe/  the review probe (runs the real app modules in Node)
docs/           design notes, device checklist, native re-apply, release process
```

## Privacy

`PRIVACY.md` explains exactly what is stored where. Short version: photos go to **your** Telegram
account; the index stays on the phone and is excluded from Android backups.

## License

MIT. TDLib and the bundled ML models have their own licenses (see `docs/NATIVE-REAPPLY.md`).
