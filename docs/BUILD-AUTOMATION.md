# Building the APK without this PC

Two ways to turn a commit into an installable APK. Both produce a **standalone** binary
(`assets/index.android.bundle` inside, no Metro) signed with the debug keystore the app was
installed with, so `adb install -r` keeps the SQLite library, the TDLib session and the upload
queue.

| Path | Who runs it | Where the APK ends up | Cost |
| --- | --- | --- | --- |
| **EAS Update** (JS-only changes) | `eas update --branch preview` | nowhere — the installed app downloads the new JS | free tier |
| **EAS Build** (`preview` profile) | `eas build -p android --profile preview` | EAS build page download | 15 Android builds/month free |
| **GitHub Actions** (`.github/workflows/android-apk.yml`) | Actions tab → "Run workflow" | private `photogram-builds` release | free for public repos |

EAS Update only carries JavaScript. Anything that touches native code (a new module, a
`gradle.properties` change, `largeHeap`, the widget Kotlin) needs one of the two build paths.

---

## GitHub Actions pipeline

`.github/workflows/android-apk.yml` — runs on **manual dispatch** or on any `v*` tag. It does
what `E:\Dev\build-photogram-release.ps1` does, on a fresh Ubuntu runner:

1. `npm ci` (lockfile exact, so the `expo-asset` pin survives).
2. Writes `tdlib.secrets.json` from repository secrets — the APK embeds the credentials in
   `assets/app.config`, so they must be present or login cannot work.
3. Restores the signing keystore to `~/.android/debug.keystore`.
4. `node scripts/ci/patch-fast-tflite.cjs` (the `-O1 -g0` fix, see `NATIVE-REAPPLY.md` §0).
5. `npx expo prebuild --platform android --no-install` (CNG: `android/` is not in the repo, the
   widget/tile plugin re-applies itself).
6. Copies the restored keystore over `android/app/debug.keystore` — this is the step that makes
   the APK installable **over** the current app.
7. `./gradlew :app:assembleRelease` with `arm64-v8a` only.
8. Asserts the APK really contains `assets/index.android.bundle` and `assets/app.config`, then
   writes the SHA-256.
9. Publishes both files to a release in the **private** `Avithegod2010/photogram-builds` repo.

### Required secrets

Settings → Secrets and variables → Actions. All four are needed for a publishable build:

| Secret | Value |
| --- | --- |
| `TDLIB_API_ID` | the `api_id` from `tdlib.secrets.json` (a number) |
| `TDLIB_API_HASH` | the `api_hash` from the same file |
| `DEBUG_KEYSTORE_BASE64` | `base64 -w0 credentials/debug.keystore` |
| `BUILDS_REPO_TOKEN` | a token with `repo` scope on `photogram-builds` (a fine-grained PAT limited to that repo is enough: Contents → Read and write) |

The keystore is the one that signed the installed APK (`android/app/debug.keystore` md5
`4d3dbe54…` == `credentials/debug.keystore`). A build signed with anything else would be refused
by `adb install -r` and would force an uninstall — which erases the library and the upload queue.
The workflow fails fast if the secret is missing rather than producing such an APK.

### Why the APK is never a workflow artifact

This repository is public. Workflow artifacts on a public repository can be downloaded by anyone
with read access to it, and the APK contains the TDLib `api_id`/`api_hash` (same reason the
`v0.55.0` GitHub release is source-only). The upload step therefore goes to the private builds
repo and nothing is attached to the public repo.

### Is it sustainable?

Honest answer: workable, not free of upkeep.

- **Cost:** Actions minutes are free for public repositories, so the 25–40 minute build costs
  nothing but wall-clock time. Artifact storage in the private repo is tiny (one ~120 MB APK per
  release).
- **Upside:** no dependency on this PC (8 GB RAM, Kotlin daemon OOMs), no dependency on the Expo
  account or its token, and the build is reproducible from the commit alone.
- **Upkeep:** three things age badly and will need attention on an SDK upgrade —
  the NDK version AGP resolves, the `react-native-fast-tflite` flag patch (it is a node_modules
  edit, re-applied by the script), and the `expo-asset` pin. If `prebuild` starts emitting a
  different Android template, the keystore copy step is the first thing to re-check.
- **What it does not replace:** device verification. A green build only proves it compiles.

Use it as the fallback and as the "someone else's machine" path. EAS Build stays the primary
release path because it manages signing and produces the AAB for Play.

---

## Verifying a downloaded APK

```powershell
# 1. integrity
Get-FileHash .\photogram-0.55.0-arm64-v8a.apk -Algorithm SHA256   # compare with the .sha256 asset

# 2. never install while an upload is in flight
adb shell dumpsys activity services com.photogram.app | Select-String "upload"

# 3. install over the top (keeps data)
adb install -r .\photogram-0.55.0-arm64-v8a.apk
```

If `adb install` says `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the signing key differs — stop and
check `DEBUG_KEYSTORE_BASE64` instead of uninstalling.
