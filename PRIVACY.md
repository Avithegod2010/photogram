---
title: Photogram — Privacy Policy
layout: default
last_updated: 2026-09-06
---

# Photogram — Privacy Policy

**Effective date: September 6, 2026**

Photogram is a photo-backup app that stores your photos and videos in **your own Telegram
account**. This policy explains what data the app handles, where it lives, and what the
developer can and cannot see.

**The short version: the developer collects nothing. There are no accounts, no analytics, no
advertising, and no developer-run servers. Your photos go from your phone to your own Telegram
account, and everywhere else the app works, it works on your device.**

## 1. Who we are

Photogram is published as an open-source project (MIT License) on GitHub. "We" / "the developer"
means the project maintainer — a single individual. There is no company, no backend service, and
no team with access to your data.

## 2. What the app does with your photos and videos

- Backups are uploaded **only to your own Telegram account** (the "Saved Messages" chat that
  only you can see), using the Telegram credentials you log in with.
- If you link a Telegram group as a **shared album**, photos you explicitly send to that album
  are uploaded to **that group** — visible only to its members, under Telegram's own rules.
- The developer has **no access** to your Telegram account, your messages, or your media. All
  uploads happen directly between your device and Telegram's servers, over Telegram's encrypted
  protocol (TDLib).
- Your use of Telegram itself is governed by **Telegram's own Terms of Service and Privacy
  Policy**, not this document.

## 3. What is stored on your device

Photogram keeps a local index so your gallery works instantly and offline:

- A SQLite database with photo metadata (file names, dates, sizes, dimensions, GPS coordinates,
  on-device OCR text, offline place names, favorite flags, notes).
- Small thumbnails (about 320 px) for the gallery grid.
- Settings (stored with the app's private storage).

Deleting the app's data or uninstalling removes all of it. None of this is transmitted to the
developer — it never leaves your phone except as described in section 2.

## 4. Data the developer receives

**None.** The app contains:

- No analytics SDKs (nothing tracks app usage, crashes are not reported to us).
- No advertising SDKs.
- No developer-run servers, webhooks, or telemetry endpoints.
- No accounts or registrations.

The app talks to exactly two things: **Telegram** (for backup and shared albums) and **your
device's own media library** (to scan and index it).

## 5. On-device processing

The following features run **entirely on your device** — the data they use never leaves the
phone:

- **OCR text search** (reading text inside photos), opt-in in Settings.
- **Place names** (nearest-city names computed from GPS, using a bundled offline dataset).
- **Junk Sweeper analysis** (blur/duplicate heuristics on thumbnails).
- **Biometric unlock** for the Hidden album (uses your device's fingerprint/face sensor; the app
  never sees or stores biometric data — Android handles it).

## 6. Permissions the app requests and why

| Permission | Why |
|---|---|
| Photos & videos (images, video, visual-user-selected) | To scan your library, display it, and back it up |
| ACCESS_MEDIA_LOCATION | To read GPS data embedded in your photos for the map and place names |
| Internet | To reach Telegram for uploads and shared albums |
| Biometric / fingerprint | To lock and unlock the Hidden album |
| Vibrate | Subtle feedback on actions (e.g. multi-select) |

The app requests **no audio access, no contacts, no microphone, no camera, no precise
always-on location, and no overlay permission**.

## 7. Data sharing

The developer does not sell, share, or transfer any data, because the developer does not receive
any. The only parties involved in your data are:

- **You** (your device),
- **Telegram** (your chosen backup destination, under their own privacy policy),
- **Google** (only if your device's own automatic backup includes the app — the app opts out of
  Android's backup service by default).

## 8. Deleting your data

- **From Telegram:** delete the messages in your Saved Messages / shared-album group using any
  Telegram client; the app's trash flow can also delete Telegram copies (30-day trash with
  purge).
- **From your device:** uninstall the app or clear its storage; the local index and thumbnails
  are removed.
- The developer cannot delete anything on your behalf and holds no copies.

## 9. Children

Photogram is not directed at children under 13, does not knowingly collect data from anyone
(including children), and has no account system.

## 10. Changes to this policy

This policy may be updated as features change. The current version is always available in the
app's source repository, with the effective date at the top.

## 11. Contact

Questions about this policy: open an issue on the project's GitHub repository
(`Avithegod2010/photogram`) or contact the publisher at **[contact email — insert before Play
submission]**.
