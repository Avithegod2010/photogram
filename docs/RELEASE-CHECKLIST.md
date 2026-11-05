# Release checklist

Everything here is an **owner action** except where marked (agent). Keep it in sync with
`docs/DEFERRED-NATIVE.md` and `docs/DEVICE-VERIFY.md`.

## 0. Before every build

- [ ] `npm run probe` prints ALL GREEN on the commit you are about to ship.
- [ ] `CHANGELOG.md` has an entry for the version (`app.config.ts` → `version`).
- [ ] Bump `version` when native code changed (the OTA runtime is the app version).
- [ ] Build: `npx eas-cli@latest build --platform android --profile preview`.
- [ ] Install with `adb install -r` (same signing key → data survives).
- [ ] Device pass: `docs/DEVICE-VERIFY.md` + `DEVICE-CHECKLIST.local.md` (free-up-space last).

## 1. Secrets and tokens

- [ ] **Rotate the Expo access token** (expo.dev → Settings → Access tokens) after any build that
      used a pasted token. Never commit it — it lives at `E:\Dev\expo-token.txt` on the dev PC.
- [ ] `tdlib.secrets.json` and `credentials/` are gitignored; confirm with `git status`.
- [ ] EAS **secret** env vars exist for `TDLIB_API_ID` / `TDLIB_API_HASH` (development + preview).

## 2. Play Store (first submission)

- [ ] Create the app in Play Console (`com.photogram.app`), enable **Play App Signing**.
- [ ] Upload the **AAB** (`--profile production`), not the APK.
- [ ] **Data safety form**: collects nothing; photos stay on the user's Telegram account; no
      analytics; no ads; data can be deleted by deleting the Telegram messages.
- [ ] **Privacy policy URL** (GitHub Pages) — `PRIVACY.md` §11 still needs the contact email.
- [ ] Store listing: short description, screenshots (gallery, health score, albums, people),
      feature graphic, content rating questionnaire.
- [ ] **Closed testing** with 5–10 people before production; keep the feedback loop in GitHub
      issues.

## 3. Dependency alerts

- GitHub reports Dependabot alerts on this repo. Known state: all in **build tooling**, none in
  the shipped APK except `brace-expansion` (patchable).
- [ ] Review the list once per release; document any accepted risk in `SECURITY.md`.
- [ ] **Never** run `npm audit fix --force` — it downgrades Expo/RN and breaks the native build.

## 4. After a release

- [ ] Tag the commit (`git tag v0.55.0 && git push --tags`).
- [ ] `npx eas-cli@latest update --branch preview --message "…"` only for **JS-only** fixes on the
      same runtime.
- [ ] Keep the previous APK — it is the fallback if a new build misbehaves.
