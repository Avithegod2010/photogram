<div align="center">

<img src="assets/icon.png" width="88" height="88" alt="" />

<h1>Photogram</h1>

<strong>Back up your photos and videos to your own Telegram account.</strong>

<p><strong><a href="#build-it">Build from source</a></strong> · <a href="https://github.com/Avithegod2010/photogram/releases/tag/v0.55.0">Release notes</a> · <a href="#privacy">Privacy</a></p>

<sub>Android · Telegram Saved Messages and shared albums</sub>

</div>

## What it does

- **Browse your library.** Find photos by date, place or text in an image. Group people and pets on-device, organize albums and find duplicates.
- **Back up on your schedule.** Upload previews and originals with Wi-Fi, charging or time-window rules. You can see how many items reached Telegram.
- **Check that originals restore.** The restore drill downloads a sample and checks it against SHA-256 hashes. Backup health helps you find missing items and send them again.

## How it works

1. Sign in with your Telegram account through TDLib.
2. Back up to **Saved Messages**, or send selected photos to a Telegram group you’ve linked as a shared album.
3. Browse and search the library index on your phone. Download an original from Telegram when you need it.

<details>
<summary>More library and backup tools</summary>

- Keep original EXIF metadata and send images from the Android share sheet.
- Use smart albums, family topics, OCR document albums, places and scene labels.
- Browse Memories, Stories and Wrapped, or use the journal, wallpaper rotation and photo widget.
- Run a resumable backup integrity check, export the library index or protect a hidden album with biometrics.

</details>

## Build it

The public [v0.55.0 release](https://github.com/Avithegod2010/photogram/releases/tag/v0.55.0) contains release notes. To install Photogram, build an APK from source.

Set up your own Telegram API ID and hash for TDLib. The preview profile builds a standalone APK with the JavaScript bundled.

```bash
npm ci
npx eas-cli@latest build --platform android --profile preview
```

<details>
<summary>Local build, checks and project layout</summary>

Use the [native setup checklist](docs/NATIVE-REAPPLY.md) for TDLib credentials and local Android builds. The [build automation guide](docs/BUILD-AUTOMATION.md) explains the available build paths.

Run `npm run probe` to bundle and check the app. The gallery lives in `src/screens/`, backup and integrity logic in `src/lib/`, and the SQLite schema in `src/db/`.

</details>

## Privacy

Media goes to the Telegram destination you choose. The searchable index and settings stay on your phone, and the index is excluded from Android backups. Photos sent to a shared album are visible to that Telegram group’s members. [Read the privacy policy](PRIVACY.md).

## Project links

[UI design guide](docs/UI-SYSTEM.md) · [MIT license](LICENSE) · [PhotogramBot for a bot and private channel](https://github.com/Avithegod2010/photogrambot)
