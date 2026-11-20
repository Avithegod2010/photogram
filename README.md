<div align="center">

<h1>Photogram</h1>

<p><strong>Back up your photos and videos to your own Telegram account.</strong></p>

<p><strong><a href="#build-it">🛠️ Build from source</a></strong> · <a href="#how-it-works">📷 How backup works</a> · <a href="https://github.com/Avithegod2010/photogram/releases/tag/v0.55.0">Release notes</a></p>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="readme-hero.png" />
  <img src="readme-hero.gif" width="820" alt="A warm illustration of photos moving from an Android library to Telegram Saved Messages" />
</picture>

<p><sub>Android · Telegram Saved Messages · Shared albums</sub></p>

</div>

<a name="what-it-does"></a>

## 📷 What it does

| 📷 Browse the gallery | 📤 Check backup health | ✅ Verify a restore |
| --- | --- | --- |
| Find photos by date, place or text. Group people and pets on-device, organize albums and find duplicates. | Back up previews and originals on your schedule and resend missing items. | The restore drill downloads a sample and checks its SHA-256 hashes. |

<a name="how-it-works"></a>

## 📤 How it works

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

<a name="build-it"></a>

## 🛠️ Build it

> [!NOTE]
> The [v0.55.0 release](https://github.com/Avithegod2010/photogram/releases/tag/v0.55.0) has release notes. Build the Android APK from source to install Photogram.

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

<a name="privacy"></a>

## 🔒 Privacy

Media goes to the Telegram destination you choose. The searchable index and settings stay on your phone, and the index is excluded from Android backups. Photos sent to a shared album are visible to that Telegram group’s members. [Read the privacy policy](PRIVACY.md).

## Project links

[UI design guide](docs/UI-SYSTEM.md) · [MIT license](LICENSE) · [PhotogramBot for a bot and private channel](https://github.com/Avithegod2010/photogrambot)
