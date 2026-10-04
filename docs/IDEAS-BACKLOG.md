# Photogram — Ideas Backlog (owner menu, 2026-10-05)

Curated next-feature menu. Everything marked **JS-only** needs no gradle rebuild; **native**
items ride the next combined rebuild. People & Pets v1 (approved, in progress) and the pending
rebuild (v0.16/v0.17/v0.23 + hardening) are tracked in NEXT_SESSION.md, not repeated here.

## Backup & trust (the product's soul)
- **Scheduled integrity checks** — auto-run the v0.30 integrity walk weekly in the background
  (in-app loop like the junk sweep), notify only on breakage. JS-only, small.
- **Export everything** — bulk download the whole library out of Telegram to a folder
  (trust/exit ramp; heavy on phone storage; resumable like the integrity cursor). JS-only.
- **Auto-backup rules v2** — per-folder include/exclude lists with a folder picker screen
  (auto-backup already has folder storage; the UI is the gap). JS-only.
- **Backup speed scheduler** — "upload only at night / while charging" already half-exists
  (chargeOnly exists); add a time window. JS-only, small.

## Organization & search
- **Smart-album rules v2** — combined filters (favorites + label + date range) with a small
  rule builder; saved searches already store a query string, this extends the schema by one
  JSON column. JS-only.
- **Duplicate merge tool** — from Find duplicates: pick the keeper, one tap deletes the rest
  (local + optionally Telegram via the junk sweep's proven delete path). JS-only, needs care.
- **People-aware search** — once P&P v1 lands: "photos with mom" joins face clusters into
  search like every other field. JS-only after P&P.
- **Map improvements** — heatmap mode, date-filtered map (needs the owner's Google Maps key —
  config, not code).

## Family & sharing (S9 direction)
- **Album activity feed** — show family captions/comments as a per-album feed (groupSync
  already sees the messages; this is UI). JS-only.
- **Photo requests** — "ask the family for photos from Diwali" as a Telegram message the app
  can match replies against. JS-only, medium.

## Delight
- **On-this-day story upgrade** — the existing Story viewer gains video + Ken Burns + music
  (slideshow internals are already built). JS-only.
- **Anniversary reminders** — "1 year ago today" notifications for favorited photos
  (notifications + memories infra exist). JS-only, small.
- **Year-in-review v2** — Wrapped gains people (P&P) and places (place search) superlatives.
  JS-only after P&P.

## Intelligence
- **People & Pets v2** — merge/split clusters, per-person threshold, "this is not X" history.
  JS-only after v1.
- **Scene auto-albums** — "beach days", "food" smart albums built directly on the v0.23
  ML labels (no new ML). JS-only, small.
- **Receipt/text search UI** — OCR text is already indexed; a "Documents" view for
  screenshot/receipt-heavy rows. JS-only, small.

## Platform (native — batch into a rebuild)
- **Home-screen widget** — backup status + "memory of the day" (glanceable; native).
- **Quick-settings tile** — pause/resume backup from the notification shade (native, small).
- **Tablet/landscape layout** — two-pane gallery. Native-ish, medium.
