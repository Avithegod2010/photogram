# Photogram 📸 → 📨

**Your own Telegram account as free, unlimited photo backup.** Photogram is an Android gallery app
(Expo / React Native) that backs up your phone's photos and videos to *your* Telegram "Saved
Messages" via TDLib — then gives you a fast, private, offline-first gallery on top: memories,
albums, search, shared family albums, and more.

> **Status: personal project, in active development.** Features marked "not yet device-verified"
> in [CHANGELOG.md](CHANGELOG.md) are freshly coded and still need on-device testing.

## Why Telegram?

Telegram gives personal accounts effectively unlimited cloud storage for media. Photogram uses
your **own** account — no third-party server, no subscription. Your photos upload to a chat only
you can see, and a local SQLite index keeps browsing instant even offline.

## Features

- **Masonry gallery** (Days/Months/Years pinch zoom) with day headers, memories carousel, and
  "on this day" stories
- **Real backup engine:** persistent upload queue, upload-completion confirmation (items are only
  marked "synced" after Telegram confirms the bytes landed), storage-saver recompression,
  preview-first upload format (small preview instantly, original threaded as a reply)
- **Account safety:** real FLOOD_WAIT handling with a configurable escalation ladder, daily/hourly
  budgets, and a Settings "Danger zone"
- **Favorites ❤, multi-select bulk actions (backup/archive/hide/delete), timeline scrubber**
- **Photo journaling:** a note on any photo becomes its Telegram caption (visible everywhere,
  forever)
- **Auto-albums** (Camera / Screenshots / WhatsApp / Downloads / Videos), **shared family albums**
  from a Telegram group (with forum-topic sub-albums), **Archive + Hidden** (biometric gate)
- **Search** by date ("June 2026"), filename, tags, and text inside photos (on-device OCR, opt-in)
- **Trash with 30-day countdown**, restore-to-device, one-tap phone migration
- **Optional notifications** (backup finished / on this day), **shareable backup status card**,
  safety check, free-up-space with scoped-storage support

## Build it yourself

**Requirements:** Node 20+, JDK 17, Android SDK (Android 11+ device or emulator), a Telegram
developer account ([my.telegram.org](https://my.telegram.org) → `api_id` + `api_hash`).

```bash
npm install

# 1. Credentials — copy the example and fill in your own api_id/api_hash:
cp tdlib.secrets.example.json tdlib.secrets.json   # gitignored, never commit

# 2. Run on a device/emulator (creates the native Android project):
npx expo run:android
```

Daily development: `npx expo start --dev-client --host lan` (a Metro server; LAN host avoids
IPv6-only localhost binding issues on some setups).

## Privacy model

- Media uploads go **only** to your own Saved Messages (or a Telegram group you explicitly link
  as a shared album).
- The developer credentials (`api_id`/`api_hash`) live in a gitignored local file; end users of
  the app log in with their own account via QR / tap-to-confirm, keylessly.
- Aggregate-only features (e.g. the shareable backup status card) never include file names,
  paths, or album/contact names.

## Project docs

- [CHANGELOG.md](CHANGELOG.md) — per-version notes, newest first
- [NEXT_SESSION.md](NEXT_SESSION.md) — engineering handoff/state document
- [docs/](docs/) — feature plans and design decisions

## License

Released under the [MIT License](LICENSE) — free to use, modify, and build on, with attribution.
