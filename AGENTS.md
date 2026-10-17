# Photogram — Agent Ownership Rules

This folder (`E:\Opencode CLI\Projects\photogram`) is **Photogram**, the TDLib-based app.

- Engine: `react-native-tdlib` — real user account via QR/tap-to-confirm login, media stored in the user's Saved Messages
- Package name: `com.photogram.app`
- Sibling folder: `..\photogram-bot` is a DIFFERENT app (Bot API version) owned by another agent

## Strict rules for ANY AI agent working in this folder

1. **Boundary:** Work ONLY inside this folder. Never read, write, move, or delete anything inside `E:\Opencode CLI\Projects\photogram-bot`.
2. **Protected core** — do not remove or redesign these without asking the user first:
   - `src/lib/tdlib.ts`, `src/lib/qrLink.ts`, `src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`
   - `src/db/schema.ts` + `src/db/index.ts` (SQLite foundation — append-only additive migrations)
   - `app.config.ts` (injects TDLib credentials from gitignored file)
3. **Secrets:** `tdlib.secrets.json` is gitignored on purpose. Never commit it, never copy its contents into code or docs.
4. **Architecture direction:** user account storage via TDLib/Saved Messages. Do NOT migrate this project to the Bot API.
5. **Expo SDK 57:** read exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.
6. **NEVER edit `src/lib/uploader.ts`** (safety-critical FLOOD_WAIT ladder / budgets) while the bulk backup could resume mid-flight.
7. **Commits ONLY when the owner explicitly approves**, and every commit must include a CHANGELOG.md entry (newest-first at top). The repo git identity is already the safe noreply one — never commit with any other email.
8. **Owner workflow rule (2026-10-05):** code **2 features at a time, then STOP and ask permission** before the next batch. The owner is not a professional developer — explain plainly.
9. **Public repo discipline:** https://github.com/Avithegod2010/photogram is PUBLIC (MIT, history was rewritten pre-public to scrub PII). No personal data in commits, ever. Dependabot's 4 high + 3 moderate alerts are all known build-toolchain packages (none ship in the APK); the only patchable one is brace-expansion (owner-run override). NEVER `npm audit fix --force` (it would downgrade expo/RN).

## Session handoff

10. **Read `NEXT_SESSION.md` at the start of every session** and follow its "FIRST ACTIONS" — it tracks in-flight state. `CHANGELOG.md` has per-version notes + device-verify checklists.

## Current state (2026-10-05 — read fully before coding)

**Project:** Expo SDK 57 / RN 0.86 Android app (New Architecture ONLY) that backs the phone's
photos up to the user's own Telegram (Saved Messages + family groups) — a free Google-Photos
alternative. SQLite (expo-sqlite, schema v18, WAL, additive MIGRATIONS array in schema.ts) is the
gallery's source of truth; Telegram is only the byte warehouse. MMKV + zustand for settings;
reanimated 4; FlashList v2 masonry.

**Committed & pushed (HEAD `dd13882`, master = origin/master):** v0.10 topic sub-albums →
v0.11 migration/preview-first → v0.11.2 upload safety (FLOOD_WAIT ladder) → v0.12 Junk Sweeper →
v0.12.1 heartbeat → v0.13 Favorites → v0.14 multi-select → v0.15 timeline scrubber → v0.16
notifications (native, needs rebuild) → v0.17 photo journaling (notes = Telegram captions) →
v0.18 Wrapped → v0.19 photo editor + versioned archive → v0.20 send-to-album → v0.21 place
search → v0.22 album organizer + live group sync → v0.23 vibe search (ML Kit smart tags,
opt-in) → v0.24–v0.29 find-similar/duplicates (persisted pHash), manual tags, slideshow, smart
albums (saved searches), per-album biometric locks, storage deep-dive → v0.30–v0.33 backup
integrity report (resumable TDLib verification), in-app diagnostics, journal, highlights
(sharpness best-of-month) → v0.34 People & Pets step 1 (model picker with in-app download,
face detection wiring). All probe-reviewed; commits `db6e9d0`/`54c90b7`/`4adc453`/`dd13882`.
Security audits: 2 external rounds done, all fixes committed; PRIVACY.md written (owner still
must insert contact email in §11 + enable GitHub Pages before Play submission).

**COMMITTED (2026-10-17, owner-approved):** v0.34.1, People & Pets step 2 — resumable library
backfill (detect + embed faces for ALREADY-scanned photos — cursors in meta), embeddings via
react-native-fast-tflite 3.0.1 + react-native-nitro-modules (both soft-required natives joining
the pending rebuild), preprocessing = per-image z-score verified from the model repo's own
source, cosine clustering (≥ 0.6, named people frozen), People screen (view/rename).
Probe-verified 93/93 + 48/48 static + tsc clean. NOTE: originally coded as v0.35; the owner
renumbered it to **v0.34.1** at commit time (folds step 2 into the v0.34 People & Pets family).
All "v0.35" references in older docs mean this v0.34.1.

**People & Pets model policy (owner-approved):** the app bundles NO model — the user picks and
downloads one in-app (FaceNet-128 default / FaceNet-512, both verified Apache-2.0 tflite files;
URLs host-allowlisted). InsightFace/EdgeFace/GhostFaceNet-class models are NON-COMMERCIAL
(weights) → kept out of the picker. Embeddings are only comparable within one model
(per-sample `model_id`; switching models re-embeds the library).

**The review probe (MANDATORY discipline):** `.expo/review-probe/` (gitignored) runs the REAL
app stack in Node — real migrations on node:sqlite, real queries/similar/stats/search/people
modules, real pHash/jpeg math on synthetic JPEGs, native modules stubbed via esbuild aliases.
It has caught 5 real shipped bugs tsc could never see (pHash64 dead since v0.12 — 8 vs 32 DCT
basis rows; integrity checked-counter; missing shared-album exclusion in listMissingAnalysis;
slideshow stall on cloud-only video; bytesToF32 integer-bits decoding). After coding anything,
run: the esbuild bundle command (recorded in NEXT_SESSION §0 — alias targets must be absolute)
then
`node .expo/review-probe/probe.cjs` + `node .expo/review-probe/static-checks.cjs` + `npx tsc
--noEmit` — all must be green before reporting done. Extend the probe when you add data/ML code.

**Pending owner-side steps (not agent work):** COMMITTED & BUILT — the ONE combined gradle
rebuild ran 2026-10-17 as a COMPILE-ONLY build (no device attached; assemble-only runner
`E:\Dev\run-photogram-gradle-assemble.ps1` with the same env; log `E:\Dev\photogram-build.log`,
`GRADLE-EXITCODE=0`, APK ~174 MB with libNitroTflite/libNitroModules/libface_detector_v2_jni/
libtdjni confirmed inside). REMAINING: plug the phone in via USB →
`adb install -r android\app\build\outputs\apk\debug\app-debug.apk` (install kills the app
process — never mid-upload) → device verification per CHANGELOG checklists (v0.12 → v0.36)
→ resume bulk backup (~8 GB, NOT uploading) → Play Store track (privacy email + Pages,
signing, closed testing).

## Future planning

- `docs/IDEAS-BACKLOG.md` — curated next-feature menu (JS-only vs native marked).
- `docs/PLAN-PEOPLE-PETS.md` — People & Pets design; §2b has the model table + owner decisions.
- People & Pets v2 ideas: merge/split clusters, per-person threshold, "this is not X" history.
- Longer-term: scheduled integrity checks, export-everything, duplicate merge tool, scene
  auto-albums (all JS-only, in the backlog doc).

