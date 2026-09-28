# PLAN — F4 Heartbeat Card, Settings-only slice (v0.12.1)

**Spec source:** "F4 — Family-visible backup heartbeat (v0.14)" in `docs/PLAN-FEATURES-v0.11-plus.md` (line 211).
**Scope decision:** this plan ships the **Settings-only** entry point of F4 in **v0.12.1**. The GalleryScreen share icon is deferred (D6). Owner confirms the version label (D7).
**Effort: S.** Pure JS. No Gradle rebuild. No schema change. No new npm deps. No TDLib calls.

## Goal

One tap in Settings → Storage produces a numbers-only status line the owner can paste into the family group chat, matching the numbers already shown by the GalleryScreen heartbeat:

> Photogram: 14.2 GB safe — 2,431 of 2,431 backed up. Last upload 2h ago. 0 pending.

**Privacy hard rule:** aggregate numbers only. No file names, paths, thumbnails, album names, contact names — and **no album counts even optionally** (per spec; deferred until owner asks).

## Decisions

- **D1 — Data sources, read-only.** `src/lib/heartbeatCard.ts` calls only existing exports from `src/lib/stats.ts`: `getBackupHeartbeat()` (`{ total, synced, lastSyncedAt }`, excludes trashed + shared-album claims), `getStorageTotals()` (`syncedBytes`, `pendingCount` = queue pending+active+paused), `formatBytes()`. No uploader modification, no new SQL.
- **D2 — "N pending" figure.** Primary source is `pendingCount` (live queue truth). Fallback: if `pendingCount === 0` and `synced < total`, use `total - synced` (covers drained/failed queues so a partial backup never claims "0 pending" while items are missing). All-synced → `0 pending`, matching the spec example.
- **D3 — Staleness rule.** `lastSyncedAt` older than 48 h → absolute date (`toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })`, e.g. "Sep 4, 2026"). Under 48 h → relative ("2h ago"), phrased like GalleryScreen's `timeAgo()` (GalleryScreen.tsx:82) but reimplemented privately in heartbeatCard.ts — GalleryScreen is not touched (parallel-agent territory; ~8 lines of duplication accepted).
- **D4 — `lastSyncedAt === null`** (items exist, none ever synced): omit the "Last upload …" sentence entirely; still show "X of N backed up. N pending."
- **D5 — Empty DB (`getBackupHeartbeat()` returns null, total 0):** the Settings row is **hidden**, not a no-op. Rationale: spec's device check says "fresh install → no share button, no crash"; hiding needs one conditional already required for the preview text.
- **D6 — Entry point scoping.** Settings row only in v0.12.x. The committed plan also wanted a GalleryScreen share icon, but GalleryScreen is another agent's active territory (uncommitted changes in `git status`), so the icon is a documented follow-up for v0.14 proper. `heartbeatCard.ts` is written so the icon later reduces to one `Share.share` call.
- **D7 — Share mechanism: RN `Share.share({ message })`, not expo-sharing.** Rationale: `expo-sharing` shares file/URL handles (`shareAsync(uri)`); there is no file here — plain-text sharing on Android is the RN Share sheet (`Share.share({ message })` resolves to the system chooser). The mission brief mentioned expo-sharing; the committed plan doc already chose RN Share. **Owner may veto.**
- **D8 — Number formatting.** Use `toLocaleString()` grouping ("2,431") per the spec example. Note: the GalleryScreen heartbeat prints raw ungrouped numbers ("2431"); the acceptance check is that the **values** match, not the raw strings.

## Card text templates (all 4 states)

1. **All synced + recent** (`synced === total`, lastSyncedAt < 48 h):
   `Photogram: 14.2 GB safe — 2,431 of 2,431 backed up. Last upload 2h ago. 0 pending.`
2. **All synced + stale** (≥ 48 h):
   `Photogram: 14.2 GB safe — 2,431 of 2,431 backed up. Last upload Sep 4, 2026. 0 pending.`
3. **Partial:**
   `Photogram: 9.8 GB safe — 1,201 of 2,431 backed up. Last upload 2h ago. 1,230 pending.`
4. **Empty / never synced** (`lastSyncedAt === null`, items exist):
   `Photogram: 0 B safe — 0 of 12 backed up. 12 pending.`

Edge variants handled by the same rules: partial + stale (date swaps in), partial + never-synced (no upload sentence), partial + `pendingCount === 0` (D2 fallback prints the remainder).

## Files touched

| File | Change (one line) |
|---|---|
| `src/lib/heartbeatCard.ts` | **NEW.** `composeBackupCard(): Promise<string \| null>` — null when heartbeat is null; composes the D2–D4 rules with `formatBytes`; private `relativeTime()` + `formatDate()` helpers. No other exports needed. |
| `src/screens/SettingsScreen.tsx` | In Storage `Section` (line 332): one self-contained `Pressable` row before `</Section>` — label "Share backup status", sub-text = live card preview (greyed style like `styles.rowSub`), `onPress` → `composeBackupCard()` → `Share.share({ message })`, dismissedAction → silent no-op. Row hidden when composed card is null. Requires: one `useState` for the preview + one `getBackupHeartbeat()` call added alongside the existing `getStorageTotals()` load (line ~116) + one import of `Share`. No restructuring. |
| `CHANGELOG.md` | Entry drafted at commit time (not before owner approval). |

Not touched: everything else — including all PROTECTED files (`src/lib/tdlib.ts`, `src/lib/qrLink.ts`, `src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`, `src/db/*`, `app.config.ts`) and `GalleryScreen.tsx`.

## Settings row design

Reuse the existing "Free up device space" row anatomy (SettingsScreen.tsx:386–413): `<Pressable style={styles.row}>` → `<View style={styles.toggleText}>` → `styles.rowLabel` ("Share backup status") + `styles.rowSub` (card preview, `numberOfLines={2}`). No new styles, no new components; theme object only. Placement: last item inside the Storage section, after the 6-month chart — a single contiguous insertion, so a sibling agent adding a Junk Sweeper toggle to this screen later cannot conflict structurally.

## Edge cases

- Heartbeat null (fresh/empty DB) → row hidden (D5); no crash, no share sheet.
- Share sheet cancel → `Share.share` resolves with `dismissedAction: true` → return without feedback (no Alert).
- Zero bytes synced but items exist → template 4; `formatBytes(0)` already returns "0 B".
- Clock skew / `lastSyncedAt` in the future → treat as "just now" (relative branch), same as GalleryScreen.
- Settings screen opened before load completes → row renders only after heartbeat state resolves (preview null = hidden during load).
- No TDLib calls, no DB writes anywhere in the flow.

## Implementation order

1. Create `src/lib/heartbeatCard.ts` (pure function; `tsc --noEmit` clean).
2. Insert the Settings row + heartbeat load in `SettingsScreen.tsx`.
3. Owner device verification (checklist below) → CHANGELOG + commit on approval.

## Device acceptance checklist (owner runs; Samsung, adb serial RZGL3039AAA; Metro `--host lan` port 8083)

- [ ] Settings → Storage → "Share backup status" shows the live preview; tapping opens the Android share sheet with exactly that text.
- [ ] Sheet text numbers match the GalleryScreen heartbeat line (values, per D8).
- [ ] Shared to WhatsApp/Telegram: text contains only numbers and the fixed phrasing — no names, paths, albums.
- [ ] Partial state (pause an upload): "X of N backed up" + correct pending figure.
- [ ] Stale state: touch nothing for 48 h OR temporarily lower the threshold locally to verify the absolute date renders.
- [ ] Fresh install, 0 items: row absent, no crash.
- [ ] Cancel in share sheet: nothing happens, no error.
- [ ] `npx tsc --noEmit` clean. `git status` shows only the two intended files (plus CHANGELOG at commit).

## Open questions for the owner

1. **Version label:** v0.12.1 as proposed, or hold for v0.14 as originally slotted? (v0.12 belongs to the sibling Junk Sweeper.)
2. **RN `Share` vs expo-sharing:** confirm D7 (RN Share chosen; expo-sharing is for file/URI shares and is the wrong API for plain text).
3. **Entry point scoping:** confirm Settings-only for v0.12.x, GalleryScreen icon deferred to v0.14 (D6).
4. **Pending figure semantics (D2):** queue-based with remainder fallback, or always `total - synced`?
5. **Number grouping (D8):** "2,431" in the card vs "2431" on Gallery — acceptable mismatch, or format both later?
