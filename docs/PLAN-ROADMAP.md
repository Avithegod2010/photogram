# Photogram — Master Roadmap (written 2026-10-19)

Plain-language plan of everything ahead, grouped so we always work **2 features at a time**
(the owner rule) and each batch ends green (probe + static + tsc). "JS-only" = no APK rebuild
needed — the change ships to the device via Metro as soon as the code is committed.
"Rebuild" = rides the pending gradle rebuild.

---

## Phase A — Finish what is already shipped (the phone pipeline)

Everything below is already coded and committed; it just hasn't touched the phone yet.

1. **Plug the phone in → gradle rebuild.** One combined build adds the pending native
   modules (expo-document-picker, Nitro/TFLite, face detector). Runner:
   `E:\Dev\run-photogram-gradle-assemble.ps1`.
2. **`adb install -r` the new APK** (never while a bulk upload is mid-flight).
3. **Verify checklist, v0.34.1 → v0.40** — per checklist at the top of CHANGELOG.md:
   Smart tags → rescan → FaceNet-128 → People v2 (merge/split/Not-X/sensitivity) →
   corrections Review screen → person candidates → slideshows → bulk favorite →
   Then & now → weekly snapshot.
4. **Safety-net export on real data**: getDoc importFile probe check (done in code), then on
   device: Export → write JSON snapshot → copy it to the PC. That is the first real-data
   out-of-app index backup.
5. **Resume the ~8 GB bulk backup** (was NOT uploading when we paused).

## Phase B — Play Store launch track (owner steps + small agent steps)

1. **PRIVACY.md §11** — owner supplies a contact email; agent inserts it.
2. **GitHub Pages** — turn PRIVACY.md into the public privacy page (needs `gh` login /
   Pages enable, owner action).
3. **Signing key** — generate the Play keystore (password custody is the owner's decision:
   agent-run with the owner choosing the password, or owner-run).
4. **Listing copy** — agent drafts `docs/PLAY-LISTING.md`: app title, short + full
   description, screenshot captions, content-ratings questionnaire answers, data-safety
   answers (no data collected off-device; Telegram storage is the user's own account).
5. **Closed testing** — owner creates the track; agent has no further work until review.

## Phase C — Feature batches (JS-only, 2 at a time, permission between batches)

Ordered by value per effort. ✅ = already done and shipped.

- ✅ Duplicate keeper merge (v0.36)
- ✅ Scheduled integrity + junk sweep + digest (v0.37–v0.39)
- ✅ Offline originals + manifest import/export (v0.39)
- ✅ Doc albums / OCR search (v0.39)
- ✅ People v2 leftovers + candidates (v0.39–v0.40)
- ✅ Then & now cards (v0.40)

**Batch C1 — saved-search rules v2 + anniversary reminders**
1. *Smart-album rules v2*: the rule builder — combined filters (favorites + person/label +
   date range) instead of one query string. One additive schema column if needed.
2. *Anniversary reminders*: "1 year ago today" notification for favorited photos, reusing
   the v0.40 on-this-day query + existing notify loop.

**Batch C2 — people-aware search + scene auto-albums**
3. *People-aware search*: "photos with mom" joins face clusters into search (P&P data
   already there; this is the UI plumbing).
4. *Scene auto-albums*: "beach days", "food" albums built straight on the v0.23 ML labels
   — no new ML, no rebuild.

**Batch C3 — backup rules v2**
5. *Folder picker screen*: per-folder include/exclude for auto-backup (folder storage
   exists; the UI is the gap).
6. *Time-window uploading*: "upload only 22:00–07:00 / while charging" — chargeOnly exists
   already; this adds the clock window.

**Batch C4 — family feed**
7. *Album activity feed*: family captions/comments shown as a per-album feed (groupSync
   already sees the messages; this is UI).
8. *Photo requests*: "ask the family for Diwali photos" — a Telegram message the app can
   match replies against.

**Batch C5 — delight**
9. *On-this-day story upgrade*: Story viewer gains video + Ken Burns + music (slideshow
   internals already built).
10. *Wrapped v2*: year-in-review gains people and places superlatives.

**Batch C6 — Android-home plumbing (Rebuild)**
11. *Home-screen widget*: backup status + "memory of the day".
12. *Quick-settings tile*: pause/resume backup from the notification shade.

## Phase D — My own new ideas (unplanned until approved)

- **Free-up-space mode (careful, opt-in)**: after an integrity-verified backup, offer to
  delete local copies of originals that pass verification — frees phone storage, keeps a
  re-download path via offlineExport. This is the big one for 64 GB phones, but it deletes
  things, so it ships last with confirm-both-times UI.
- **Localization (Hindi first)**: strings currently English-only. For an India-first Play
  audience this widens reach more than any single feature; do it after C1–C3 settle so we
  don't re-translate churn.
- **Long-press app shortcuts**: Favorites / Search / Backup-status as static shortcuts
  (config-plugin, likely rides the native batch).
- **Pin albums + best-of cover picker**: pin a few albums to the album grid's top, choose
  the cover frame instead of the automatic one.
- **First-run onboarding checklist**: a small scannable "3 steps to trust Photogram" card
  for new Play users (login → first upload → integrity check).
- **Playback polish**: slideshow transitions/music already exist; add slower pan for
  portrait photos and a global "ambient mode" toggle.

## Sun-setting / long-term

- Tablet/landscape two-pane layout (native-ish, big) — after Play launch.
- Map heatmap + date filter — needs the owner's Google Maps API key (config, not code).
- Export-everything-to-PC automation — offlineExport + snapshot already cover most of this;
  revisit only if owners ask.
