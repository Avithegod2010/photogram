# Photogram — Upload Rate-Limit & Account-Safety Hardening

Status: PLAN ONLY (no code written). Prepared 2026-09-05.
Companion reading: `NEXT_SESSION.md` §0 (bulk backup in flight, ~8 GB done of ~14 GB, auto-resumes on every app restart), `docs/PLAN-FEATURES-v0.11-plus.md` (style/format precedent), `CHANGELOG.md` (version discipline), `AGENTS.md` (protected files).

---

## 0. The request (quoted)

> Write a plan document (PLAN ONLY — no code) for hardening Photogram's upload pipeline against
> Telegram rate limits and account-safety risks. The owner's top priority: **there should be almost
> no chance of the account getting banned or limited**. A bulk backup of ~14 GB is running by
> design, throttled at 1.5 GB/day. Produce: (1) current-state audit with gaps; (2) tiered hardening
> (Tier 1 correct FLOOD_WAIT obedience, Tier 2 conservative base rates, Tier 3 escalation &
> cool-downs, Tier 4 safety interlocks & transparency); (3) a numbers table with defaults + rationale;
> (4) edge cases; (5) files to touch / not touch (protected files untouched); (6) 8–12 device-testable
> acceptance checks + S/M/L effort per tier. Match the style of `docs/PLAN-FEATURES-v0.11-plus.md`.

---

## 1. Executive summary (plain language)

Photogram uploads the owner's photos to their own Telegram account (Saved Messages) through TDLib.
Telegram does not publish its rate limits, and pushing a personal account too hard can earn
FLOOD_WAIT pauses, temporary sending blocks (PEER_FLOOD), or in the worst case account
restrictions. Today's uploader has a throttle, but research for this plan found that its reactive
FLOOD_WAIT handling **cannot actually fire** (§2.1, gap G1 — the send call never delivers errors to
JS), the "1.5 GB per day" throttle is really per-app-session and forgets itself on every restart
(gap G3), and there is no per-minute message pacing, no escalation memory, and no persisted
safety state at all.

The hardening is four additive tiers, each independently shippable and device-testable:

1. **Tier 1** — actually SEE Telegram's "slow down" orders (via `updateMessageSendFailed`) and obey
   them fully, worker-wide, with a human-readable status.
2. **Tier 2** — replace the session throttle with a conservative, persisted budget (per-day bytes,
   per-hour bytes, jittered minimum gap between every sendMessage).
3. **Tier 3** — remember FLOOD_WAIT history and escalate: repeated hits earn progressively longer
   cool-downs; PEER_FLOOD earns a day-long pause and a loud warning.
4. **Tier 4** — a Settings "Upload safety" section (budget used, last FLOOD_WAIT, next auto-resume),
   a "Safe mode" toggle, and restart-proof persistence of every counter and pause.

All new logic lives in `src/lib/uploader.ts`, `src/lib/uploadSafety.ts` (new), `src/lib/uploadStore.ts`
(persisted counters), `src/store/settingsStore.ts` (toggles) and `src/screens/SettingsScreen.tsx`
(UI). No schema bump, no new native modules, no gradle rebuild, **no protected file touched**.

Guiding rule, as always in this repo: **add, don't rewrite** — the proven worker loop, queue, and
confirmation engine stay; we wrap them with pacing and safety gates.

---

## 2. Current-state audit (facts from code, with gaps)

All claims below were verified against the working tree on 2026-09-05. File/line references are to
the current uncommitted tree (v0.11.1 batch-1 polish is live; uploader logic is as committed in
v0.11 `1207bee`).

### 2.1 What the uploader does today

| Aspect | Current behavior | Where |
|---|---|---|
| Worker loop | Single sequential `while(true)`: paused? → throttle-until? → hold gates? → `nextQueued()` → `runOne()` | `src/lib/uploader.ts:179-220` |
| Throttle (proactive) | After each successful upload, `addSessionBytes(byte_size)`; when `sessionBytes >= 1_500_000_000` → `setThrottledUntil(now + 5_000)` — a 5-second pause, then full speed again | `uploader.ts:389-395`, constants `src/store/uploadStore.ts:60-61` |
| Session bytes | In-memory zustand only — **lost on every app restart** | `uploadStore.ts` (`sessionBytes` has no MMKV load/save) |
| Today bytes | Persisted to the `uploads` MMKV instance with a local-date key; resets to 0 on date change — **but is display-only; the throttle gate never reads it** | `uploadStore.ts:14-35, 86-92` |
| FLOOD_WAIT (reactive) | `parseRetryAfterSeconds(err)` regexes `err.message` for `FLOOD…WAIT…(\d+)` / `retry after (\d+)`; TdError code 429 → hardcoded 10 s. On hit: worker-wide `throttledUntil = now + (X+1) s`, item back to `pending`, ≤ 5 attempts | `uploader.ts:74-83, 396-405` |
| Other errors | Any non-404 error: back to `pending` until 5 attempts, **no backoff between attempts**; then `failed` with stored message | `uploader.ts:406-411` |
| Hold gates | Wi-Fi-only and charge-only toggles; while holding, loop sleeps 4 s and re-checks | `uploader.ts:573-607` |
| Pause | Settings "Pause uploads" → `paused` flag + `resetActiveToPending()`; session-only (not persisted) | `uploader.ts:127-136` |
| Auto-resume | Queue auto-resumes on every app launch: `startWorker()` is called from `GalleryScreen.loadFirstPage()` | `src/screens/GalleryScreen.tsx:142` |
| Confirmation | `waitForUploadConfirmed()` via `updateMessageSendSucceeded` / `updateFile` events + 5 s history poll; 2 h timeout marks "failed — not confirmed" | `uploader.ts:462-534` |
| Message shape | With "Preview first, file as reply" ON, each item = **2 sendMessage calls** (preview + original) | `uploader.ts:296-343` |
| Queue | SQLite `upload_queue`, FIFO by `enqueued_at`; dedupe on enqueue; status CHECK includes an **unused** `'paused'` value | `src/db/schema.ts:54-65`, `src/db/queries.ts:554-646` |

### 2.2 Gap list

- **G1 — FLOOD_WAIT obedience is dead code (CRITICAL).** The send path is
  `TdLib.td_json_client_send(...)`. Native-side (verified in
  `node_modules/react-native-tdlib/android/.../TdLibModule.java`, `td_json_client_send`) this is
  fire-and-forget: `client.send(function, null, null)` with a **null result handler**, and the JS
  promise always resolves `"Request sent successfully"`. Therefore `JSON.parse(response)` throws,
  `parsed` stays null, and `if (parsed && parsed["@type"] === "error") throw new TdError(...)`
  (`uploader.ts:346-356`) **never executes**. A FLOOD_WAIT on sendMessage never reaches
  `parseRetryAfterSeconds`. (NEXT_SESSION §0.4 already flagged this branch as dead code.)
- **G2 — What actually happens on a FLOOD_WAIT today is the worst case.** TDLib emits
  `updateMessageSendFailed` (verified: `TdApi$UpdateMessageSendFailed` exists in the bundled jar
  with `message`, `oldMessageId`, nested `error{code,message}`) on the global `tdlib-update` fan-out —
  but the uploader has **no listener** for it. The queue item instead walks into
  `findSentMessage`, whose fallback returns the **latest history message even when the caption does
  not match** (`uploader.ts:444-449`) — it can bind the wrong remote id — then burns a 2-hour
  confirmation timeout and marks the item "failed / not confirmed". No wait is honored; the worker
  immediately sends the next item into the same flood wall.
- **G3 — The "1.5 GB/day" throttle is not daily.** The gate reads `sessionBytes` (memory, resets on
  restart), not `todayBytes` (persisted). A bulk backup that spans app restarts — which it does,
  since the queue auto-resumes on launch — is only ever limited to 1.5 GB **per process lifetime**,
  plus 5 s each time it crosses.
- **G4 — No per-minute message-rate limiting.** Nothing enforces a gap between sendMessage calls.
  Small photos (storage-saver recompressed, ~200–500 KB) can complete end-to-end in a few seconds;
  with preview-reply ON that is 2 messages per item, so bursts of dozens of messages/minute are
  possible — right at the community-reported ~30 msg/min per-chat boundary.
- **G5 — No escalation memory.** FLOOD_WAIT events are not counted or timestamped anywhere.
  Ten FLOOD_WAITs in an hour behave exactly like the first one: obey X, immediately resume poking.
- **G6 — No persisted safety state.** `throttledUntil` is in-memory: the app being killed
  mid-wait forgets the wait entirely. There is no distinction between "queue idle", "user paused",
  and "deliberately stopped for safety" — Settings shows "Uploads are paused" vs "Queue is idle"
  only (`SettingsScreen.tsx:213-218`).
- **G7 — Parse fragility.** The regex path depends on error text arriving in `err.message` — but
  per G1 no error object ever arrives from the send; and if one did via another path, there is no
  cap on parsed X (a bogus "FLOOD_WAIT_86400" match would set a 24 h pause from one bad string).
  Code 429 is hardcoded to 10 s with no reading of a real `retry_after`.
- **G8 — No limit-shaped non-FLOOD handling.** PEER_FLOOD (serious on user accounts), 429 with
  `retry_after` JSON field, "Too Many Requests" text variants — none are recognized; they'd burn 5
  fast attempts and fail.
- **G9 — No retry backoff for plain errors.** A persistent transient error (e.g. file vanished
  mid-read, network flap) re-queues immediately and can burn all 5 attempts within seconds.

---

## 3. Proposed hardening — four additive tiers

Each tier is independent, additive, and lands green on its own. Order matters only in that Tier 1
makes FLOOD_WAIT visible, which Tiers 3–4 consume. **No tier touches a protected file, and no tier
requires a gradle rebuild** (pure JS + existing MMKV/zustand).

### Tier 1 — Correct FLOOD_WAIT obedience (fix the dead path)

**Goal (plain language).** When Telegram says "wait X seconds", the app must actually hear it and
stop everything for X — not discover it 2 hours later as a mysterious "not confirmed" failure.

**Design.**

1. **Hear the failure (replaces the dead branch, does not revive it):** add an `onUpdate` listener
   (registered in `startWorker`, alongside the existing `updateMessageSendSucceeded` listener at
   `uploader.ts:147-155`) for `update.type === "updateMessageSendFailed"`. Payload carries the
   failed message, `old_message_id`/`oldMessageId`, and a nested `error {code, message}` — read all
   fields through the established `firstDefined(camelCase, snake_case)` helper.
2. **Correlate:** the worker is single-item sequential, so while an item is active (`uploadStore.active != null`),
   any `updateMessageSendFailed` whose message chat matches the active item's `chat_id` is attributed
   to it. (Fire-and-forget means we never knew the pending id at send time; chat + recency is the
   reliable correlation. Documented race risk: an unrelated failed send in the same chat from another
   device — accepted; worst case is one extra backoff.)
3. **Obey worker-wide:** on attribution, keep the existing worker-wide `throttledUntil` gate but set it
   from the parsed wait: `now + (X + FLOOD_BUFFER_S) * 1000`. The item goes back to `pending`
   (attempt counted). **Guard:** skip `findSentMessage`'s latest-message fallback for this item
   (G2) — a failed send produced no message; mark remote ids untouched.
4. **Parse both shapes, cap sanely:** extend `parseRetryAfterSeconds` to take `(code, message)`
   and recognize: TDLib wire `FLOOD_WAIT_X` / `flood_wait_X`, Java-binding message `FLOOD_WAIT_X`,
   text "retry after N", code 420/429 with a numeric `retry_after` in the message, and plain
   "too many requests" (→ default wait, see numbers table). Clamp the parsed value to
   `[1, MAX_OBEY_SECONDS]`; anything above the cap is still honored but routed to the Tier 3
   escalation path instead of a naive `throttledUntil`.
5. **Human-readable status:** reuse/upgrade the existing error line: "Telegram asked us to slow
   down — pausing 32 min (resumes 14:05)". Set via `setError` (already displayed in Settings) and
   reflected in the Tier 4 status rows.

**Expected files:** `src/lib/uploader.ts` (listener + attribution + guard + parser), `src/lib/uploadSafety.ts` (new: parser + clamps, shared with Tier 3), `src/lib/uploadStore.ts` (no change needed; status strings flow through existing `setError`).

**Protected files touched: NO.** `tdlib.ts` untouched — the listener consumes the existing `onUpdate` fan-out.

**Risks:** the failed-update could theoretically be missed (app killed at that instant) — the existing 2 h confirmation timeout remains as the backstop, and the failed item's error message now names the likely cause. No new native code, so the currently-installed APK keeps working until the next Metro reload.

---

### Tier 2 — Conservative base rates (persisted budget + inter-message gap)

**Goal (plain language).** Make the *default* pace one Telegram never complains about, regardless
of restarts, by budgeting bytes per day and per hour and leaving a jittered breathing gap between
every message send.

**Design.**

1. **New module `src/lib/uploadSafety.ts`** — the single home for every constant in §4 plus pure
   helper functions: `currentHourKey()`, `budgetState()` (loads/validates MMKV), `recordBytes(n)`,
   `waitForBudget()`, `interMessageDelayMs()`, `clampFloodWait()`, escalation record/decay (Tier 3).
   All persisted counters live in the existing `uploads` MMKV instance (`createMMKV({id:"uploads"})`,
   already used by `uploadStore.ts:12`).
2. **Persisted byte accounting (fixes G3):** on each successful item, `recordBytes(originalBytes)`
   adds to **both** `todayBytes` (existing day-keyed MMKV value — now actually consumed by the
   gate) and a new `hourBytes` (persisted with its hour-of-epoch marker; resets when the hour
   rolls). The worker checks the gates **before dequeuing** (same place as the old
   `throttledUntil` check): if `todayBytes >= DAILY_BUDGET_BYTES` → hold with status "Daily backup
   budget reached — resuming at midnight" (until-timestamp = next local midnight, persisted);
   else if `hourBytes >= HOURLY_BUDGET_BYTES` → hold until the next hour boundary. The old
   `sessionBytes`/`THROTTLE_LIMIT_BYTES`/`THROTTLE_PAUSE_MS` constants are retired (kept as
   deprecated aliases for one release to avoid import churn).
3. **Inter-message gap (fixes G4):** before **every** `td_json_client_send` of a sendMessage
   (preview AND original — two sends per item with preview-reply ON), await
   `interMessageDelayMs()` = `MIN_INTER_MESSAGE_GAP_MS + random(0, GAP_JITTER_MS)` since the last
   send. At the default 4 s + 0–2 s jitter, worst case is ~10–15 messages/minute including
   previews — comfortably under the ~30 msg/min community figure and ~20 uploads/min conservative
   figure.
4. **Small retry backoff (fixes G9):** non-FLOOD transient errors get
   `min(RETRY_BASE_S * 2^(attempts-1), RETRY_MAX_S)` before the item is eligible again — implemented
   as a per-item `notBefore` timestamp in MMKV checked by `nextQueued` consumption order in the
   worker (rows with `notBefore` in the future are skipped that pass, not reordered). Note:
   `queries.ts` is NOT modified — the skip is worker-side, preserving the preference to avoid
   touching queue SQL.

**Expected files:** `src/lib/uploadSafety.ts` (new), `src/lib/uploader.ts` (gates + gap + backoff), `src/lib/uploadStore.ts` (todayBytes now gate-read; expose hourBytes), `src/store/settingsStore.ts` (owner-adjustable daily budget — Tier 4 uses it; land the store field here since it's the constant's owner).

**Protected files touched: NO.**

**Risks:** the daily budget makes the 14 GB backup take ~10 days at 1.5 GB/day — that is the
owner's existing stated design ("1.5 GB/day throttle is BY DESIGN"), now made real and restart-proof.
Default numbers are deliberately conservative; §4 marks every one as tunable.

---

### Tier 3 — Escalation & cool-downs (the account-safety core)

**Goal (plain language).** One FLOOD_WAIT is Telegram clearing its throat. Repeated FLOOD_WAITs
are Telegram losing patience. The app must remember, escalate the response, and — above a threshold —
stop on its own for hours, telling the owner why.

**Design.**

1. **Event log (new, in `uploadSafety.ts`):** every limit-shaped event appends
   `{ at: epochMs, kind: "flood_wait" | "rate_429" | "peer_flood" | "slow_down" | "other_limit", waitS }`
   to an MMKV ring buffer (cap ~50 entries) plus derived counters: `floodCount1h`, `floodCount24h`,
   `lastFloodAt`, `lastFloodWaitS`. Survives restarts (fixes G5, G6 partially).
2. **Escalation ladder** (evaluated on every new FLOOD_WAIT event):

   | Situation | Response |
  |---|---|
   | 1st FLOOD_WAIT in 24 h | Obey X + buffer (Tier 1 behavior) |
   | 2nd FLOOD_WAIT within 1 h | Obey X×2 + 5 min floor; status explains "second slow-down" |
   | 3rd FLOOD_WAIT within 24 h | **Safety pause: worker halted 6 h** — "Safety pause: Telegram limited us 3 times. Uploading resumes at HH:MM." |
   | Any FLOOD_WAIT with X > 1 h | **Safety pause for the rest of the local day** (until next midnight) |
   | PEER_FLOOD (code 420, message contains `PEER_FLOOD`) | **Safety pause 24 h** + loud owner warning text ("Telegram blocked this chat from sending — this is serious. Uploads stopped for 24 h; consider contacting Telegram support if it repeats.") |
   | 429 / "Too Many Requests" without X | Obey default 60 s (min), counts as a flood event at half weight |
   | `USER_DEACTIVATED` / account-restriction-shaped 401/403 | Stop worker permanently (not auto-resumable), full-screen-grade warning in Settings; owner action required |
3. **Safety pause mechanics:** a persisted `safetyPauseUntil` epoch in MMKV. The worker loop order
   becomes: `paused` (user) → `fatalStop` (Tier 3 last row) → `safetyPauseUntil` → budget gates →
   hold gates (Wi-Fi/charging) → inter-message gap → dequeue. `updateMessageSendFailed`
   attribution writes `safetyPauseUntil` when the ladder says so. Status rows (Tier 4) render the
   remaining time.
4. **Decay:** counters are windowed (1 h / 24 h from timestamps), so after a quiet day the ladder
   resets to "1st" behavior automatically. No manual reset UI in this tier.

**Expected files:** `src/lib/uploadSafety.ts` (ladder + log), `src/lib/uploader.ts` (loop order + attribution hooks), `src/lib/uploadStore.ts` (expose safety state for UI).

**Protected files touched: NO.**

**Risks:** over-eager escalation could stall a legitimate backup — mitigated by the 1 h/24 h
windowing and by Tier 4's explicit "resume now" override (§5 edge case E5). Under-eager is the
acceptable failure direction: the defaults err toward longer pauses.

---

### Tier 4 — Safety interlocks & transparency (Settings + persistence)

**Goal (plain language).** The owner must always be able to answer: "Is my account in trouble, and
when will uploads continue?" — and must be able to choose extra caution (Safe mode) or explicitly
override a safety pause.

**Design.**

1. **Settings → "Upload safety" section** (inside the existing Uploads section, above the pause
   button, reusing `Row`/`StatCard` patterns):
   - Budget used today / this hour (from persisted counters) vs the configured daily budget.
   - Last FLOOD_WAIT: kind + wait duration + when ("32 min wait, 14:02 today").
   - Next auto-resume time whenever any pause is active (throttle, safety pause, daily budget),
     or "—" when running freely.
   - Current mode: Normal / Safe mode / Safety pause / Stopped (fatal) — one visible word.
2. **Safe mode toggle** (`settingsStore.ts`, MMKV-persisted, default OFF): halves
   `DAILY_BUDGET_BYTES` and `HOURLY_BUDGET_BYTES`, doubles `MIN_INTER_MESSAGE_GAP_MS`. Applied at
   read-time inside `uploadSafety.ts` so the toggle takes effect on the very next item. Suggested
   to the owner (Alert) after any 3rd-tier safety pause fires.
3. **Never auto-resume from a safety pause early.** `safetyPauseUntil` is checked on every loop
   pass **and** on `startWorker()` — so the GalleryScreen auto-resume on app launch
   (`GalleryScreen.tsx:142`) cannot bypass it (fixes the G6 restart hole). User "Pause uploads"
   remains independent and session-scoped as today.
4. **Restart-proof counters:** `todayBytes` (already persisted), `hourBytes`, `safetyPauseUntil`,
   escalation log, and the daily-budget "day marker" all live in the `uploads` MMKV instance;
   `sessionBytes` stays as a display-only session figure. Date-rollover reset for `todayBytes`
   already exists (`todayKey()`); the same pattern covers `hourBytes`.
5. **Override ("resume now") on safety pause:** see edge case E5 — allowed via a two-step
   confirmation, logged, and without clearing escalation counters.

**Expected files:** `src/screens/SettingsScreen.tsx` (section), `src/store/settingsStore.ts` (safeMode + dailyBudgetOverride), `src/lib/uploadSafety.ts` (read-time mode application), `src/lib/uploader.ts` (loop re-check on start).

**Protected files touched: NO.**

---

## 4. Numbers table (all tunable; single home: `src/lib/uploadSafety.ts`)

| Constant | Default | Rationale |
|---|---|---|
| `DAILY_BUDGET_BYTES` | 25_000_000_000 (25 GB) | Owner-set: large enough that the full ~14 GB backup finishes well within a day; FLOOD_WAIT obedience (Tier 1) is the real protection |
| `HOURLY_BUDGET_BYTES` | 4_000_000_000 (4 GB) | Owner-set: effectively unlimited for this use-case; exists purely as a runaway circuit-breaker |
| `MIN_INTER_MESSAGE_GAP_MS` | 0 (OFF by default) | Owner-set: disabled by default for fastest uploads; Settings "Danger zone" row lets the owner enable 0–4 s |
| `GAP_JITTER_MS` | 0 (off while gap is OFF) | Jitter only applies when the gap setting is enabled (uniform 0–min(2000, gap) added on top) |
| `FLOOD_BUFFER_MS` | 180_000 (3 min) | Owner-set: obey X plus exactly 3 extra minutes (1st-hit response) |
| `MAX_OBEY_MS` | 3_600_000 (1 h) | Direct `throttledUntil` obedience is capped at 1 h; larger X routes to the rest-of-day safety pause |
| `DEFAULT_UNPARSED_429_WAIT_S` | 60 | Conservative floor when code 429 arrives without a parseable wait |
| `SECOND_HIT_EXTRA_PAUSE_MS` | 1_800_000 (30 min) | Owner-set: 2nd hit within 1 h = obey X + 30 min extra pause + forced slow uploads (2 s gap) |
| `THIRD_HIT_PAUSE_MS` | 21_600_000 (6 h) | Owner-set: 3rd hit within 24 h = 6 h safety pause + warning + slow uploads (4 s gap) for 24 h after |
| `SAFETY_PAUSE_BIG_X` | rest of local day | Any single wait > 1 h is a strong signal; midnight boundary is an understandable resume point |
| `PEER_FLOOD_PAUSE_MS` | 86_400_000 (24 h) | Owner-set: PEER_FLOOD is the classic pre-ban signal; 24 h pause + loud warning + 4 s gap on resume |
| `SLOW_GAP_MS_AFTER_2ND` | 2_000 | Forced inter-message gap while a 2nd-hit window (1 h) is active |
| `SLOW_GAP_MS_AFTER_3RD` | 4_000 | Forced inter-message gap for 24 h after a 3rd hit / PEER_FLOOD |
| `RETRY_BASE_S` / `RETRY_MAX_S` | 30 / 900 | Exponential backoff for plain transient errors (30 s → 1 → 2 → 4 → 8 min), instead of burning 5 attempts in a minute |
| `FLOOD_LOG_CAP` | 50 entries | Tiny ring buffer; enough for 24 h windowing forever |
| Escalation windows | 1 h / 24 h | Rolling windows for counting hits |

Owner-adjustable surface (Tier 4): `DAILY_BUDGET_BYTES` (Settings row), Safe mode toggle. Everything

**Owner decision (2026-09-05, FINAL — overrides all earlier conservative defaults):** 25 GB/day budget, 4 GB/hour cap, inter-message gap OFF by default with a Settings "Danger zone" row (0–4 s, default 0 = disabled). Ladder: 1st hit = obey X + 3 min; 2nd within 1 h = obey X + 30 min + forced 2 s gap; 3rd within 24 h = 6 h pause + warning + forced 4 s gap for 24 h; PEER_FLOOD = 24 h pause + warning + 4 s gap. All ladder settings adjustable in a Settings "Danger zone" section.
else is a constant — deliberately, so safety numbers can't be casually loosened.

---

## 5. Edge cases (decisions, not open questions)

- **E1 — App killed mid-wait.** Every until-timestamp (`throttledUntil` for flood waits,
  `safetyPauseUntil`, daily/hour gates) is persisted in MMKV **at the moment it is set**. On
  relaunch the loop re-checks MMKV before its first dequeue, so a 32-min wait survives a kill at
  minute 3 and resumes with 29 min remaining.
- **E2 — Clock changes / timezone travel.** Waits are stored as epoch-ms and compared to
  `Date.now()`: a backward clock jump only *extends* a wait (safe direction); a forward jump can
  shorten it, but escalation windows (1 h/24 h) use recorded event timestamps, so a forward jump
  makes the app *more* cautious, never less. Day/hour markers use the existing local
  `todayKey()` pattern; a DST shift at worst resets an hour counter once (safe direction: budget
  resets are always permissive-neutral, never frequency-increasing).
- **E3 — FLOOD_WAIT during an in-flight upload.** The worker is single-item sequential, so the
  only thing "in flight" when a send fails is that item itself. Rule: attribute the failure to the
  active item, mark it `pending` (attempt bumped), set the wait, and let the byte-upload of any
  already-accepted message finish being confirmed in the background (its `updateFile` progress
  events are passive, not new sends). No NEW sendMessage happens until the wait elapses. The
  preview send's failure is already swallowed by design (`uploader.ts:323-326`) but now ALSO feeds
  the escalation log if it carries a limit-shaped error.
- **E4 — 2,000-item queue under a 6 h safety pause.** Nothing about the queue changes: rows keep
  statuses and order; the loop just idles checking MMKV (cheap — reuse the existing 1–4 s sleep
  cadence). On resume, `nextQueued()` returns the oldest pending row exactly as before; dedupe and
  attempt counters are untouched. The one trap — `resetActiveToPending()` on user-pause mid-item —
  already exists and is unchanged; safety pauses additionally never touch row status at all.
- **E5 — Owner force-continues despite a safety pause.** DECISION: **allow, with a two-step
  explicit warning** ("Telegram asked Photogram to stop for N h. Continuing now raises the risk of
  your account being limited. Continue anyway?"). Justification: the owner owns the account; a
  lockout with no override invites worse workarounds (reinstalling the app wipes the persisted
  counters and loses the safety memory entirely, which is strictly more dangerous). Mitigations:
  the override is logged as an MMKV event, it does **not** clear escalation counters (the next
  FLOOD_WAIT re-escalates immediately, from wherever the ladder was), and Settings suggests Safe
  mode as the middle path.
- **E6 — Composed holds.** The gate order is fixed and idempotent: user pause → fatal stop →
  safety pause → daily budget → hourly budget → Wi-Fi/charging hold → inter-message gap. Each
  hold renders its own reason; Settings shows the *first* blocking reason plus, for pauses, the
  resume time. Compositions like "safety pause + not on Wi-Fi" simply show the earlier gate and
  then the next one as it clears.
- **E7 — Mid-bulk-backup deployment.** All changes are JS-only (no gradle rebuild, no new native
  modules). Deploy while the queue is paused; per NEXT_SESSION's standing rule, never force-stop
  the app while an upload is in flight. After Metro reload the queue auto-resumes under the new,
  stricter gates.

---

## 6. Files to touch / not touch

**Touched:**

| File | Change |
|---|---|
| `src/lib/uploadSafety.ts` | **NEW** — all constants (§4), persisted counters (today/hour/safety/escalation log), parser + clamps, gap calculator, ladder |
| `src/lib/uploader.ts` | `updateMessageSendFailed` listener + attribution; failed-send guard in `findSentMessage` path; loop gate order (safety → budgets → holds → gap); per-send gap; retry backoff; status strings. Worker architecture, queue consumption, confirmation engine unchanged |
| `src/lib/uploadStore.ts` | `todayBytes` becomes the gate input; add `hourBytes`; retire `THROTTLE_LIMIT_BYTES`/`THROTTLE_PAUSE_MS` (deprecated aliases one release); expose safety state for UI |
| `src/store/settingsStore.ts` | `safeModeEnabled` toggle, optional `dailyBudgetOverrideBytes` (MMKV-persisted, existing zustand persist pattern) |
| `src/screens/SettingsScreen.tsx` | "Upload safety" rows inside the existing Uploads section; Safe mode toggle; override confirm flow |
| `src/db/queries.ts` | **PREFERRED: no change.** Only if implementation proves a worker-side skip awkward would a queue field be considered — and then via the existing `meta` table or MMKV, NOT a schema bump (avoid touching `schema.ts`, which is protected) |

**Explicitly NOT touched (protected per AGENTS.md):** `src/lib/tdlib.ts`, `src/lib/qrLink.ts`,
`src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`, `src/db/schema.ts`, `src/db/index.ts`,
`app.config.ts`. Also untouched: `src/db/queries.ts` (preferred), the sibling `photogram-bot`
folder (never), `tdlib.secrets.json` (never).

No new npm dependencies. No gradle rebuild. Metro-only iteration.

---

## 7. Acceptance checks (device-testable) + effort

**Testability note:** real FLOOD_WAITs can't be summoned on demand. `uploadSafety.ts` therefore
reads optional MMKV overrides (e.g. `safetyOverride` JSON with tiny budgets / `simulateFloodWaitS`)
used ONLY during verification, clearly dev-only, and removable. All checks below run on the
Samsung SM-S942B with Metro on 8083.

- [ ] **T1-a** With the simulate flag set (e.g. 8 s), a queued upload fails → Settings shows
  "Telegram asked us to slow down — pausing 8 s…", the worker sends nothing for ≥ 8 s + 60 s
  buffer, then the SAME item retries and completes (queue order preserved).
- [ ] **T1-b** No status regression: a normal upload (no simulate) still completes, marks `synced`
  after confirmation, and budget counters advance.
- [ ] **T2-a** Set a tiny daily budget override (e.g. 2 MB) → after ~2 MB uploads, worker holds
  with "Daily backup budget reached"; force-stop + relaunch the app → the hold is STILL active
  (persisted), auto-resume did not bypass it.
- [ ] **T2-b** Observe logcat (or DB timestamps of consecutive `done` rows): ≥ 4 s between every
  sendMessage, including between an item's preview and its original.
- [ ] **T2-c** Hourly gate: tiny hourly override → hold message names the next hour; counter
  resets when the hour rolls.
- [ ] **T3-a** Simulate a 2nd FLOOD_WAIT within 1 h → applied wait is 2×X + 5 min floor, status
  says "second slow-down".
- [ ] **T3-b** Simulate a 3rd within 24 h → 6 h safety pause, Settings shows "Safety pause" +
  resume time; killing and relaunching the app does not clear it.
- [ ] **T3-c** Simulate PEER_FLOOD → 24 h pause + the serious-tone warning text appears.
- [ ] **T3-d** After a quiet simulated day (clear the log via dev override), the ladder is back to
  1st-level behavior.
- [ ] **T4-a** Settings "Upload safety" shows today/hour bytes matching reality, last FLOOD_WAIT
  kind/time, and next auto-resume only while a pause is live ("—" when running).
- [ ] **T4-b** Safe mode ON → gaps double and budgets halve immediately on the next item (verify
  via T2-b timing), toggle persists across restart.
- [ ] **T4-c** Override flow: from an active safety pause, "Resume now" → two-step warning →
  uploads continue; escalation counters NOT reset (a further simulated flood re-escalates).

**Effort per tier:**

| Tier | Effort | Shape |
|---|---|---|
| Tier 1 — FLOOD_WAIT obedience | **M** | ~1 session: listener + attribution + parser + guard + status, device-verified with simulate flag |
| Tier 2 — Base rates | **M** | ~1 session: `uploadSafety.ts` module, gates, gap, backoff, store field |
| Tier 3 — Escalation | **M** | ~1 session: log, ladder, safety-pause mechanics |
| Tier 4 — Interlocks & UI | **S–M** | ~½–1 session: Settings section, Safe mode, override flow, persistence polish |

Total ≈ 3–4 sessions including device verification. Recommended ship order is exactly 1 → 2 → 3 →
4 (each is independently releasable with its own CHANGELOG entry and owner approval; tiers 2+3 can
share one version if the owner prefers).

---

## 8. Assumptions to confirm with the owner before execution

1. **1.5 GB/day becomes real and restart-proof** (today it is effectively per-session — G3). The
   14 GB backup therefore takes ~10 days. This matches the owner's stated design, but the honest
   behavior change should be confirmed.
2. **Default numbers in §4** — especially the 4 s minimum gap and 300 MB/h cap. Owner may prefer
   even slower ("Safe mode as default" is one toggle away).
3. **Override-despite-safety-pause is allowed** (E5: two-step warning, counters preserved). If the
   owner prefers a hard lockout, Tier 4's override row is simply removed — one-line decision.
4. **No schema bump, ever, in this plan** — all persistence is MMKV; if MMKV is ever cleared the
   counters restart from zero (fail-safe direction: a fresh, cautious budget).
5. **Deployment waits for a paused-queue moment** mid-bulk-backup (E7), and each tier ships
   separately with owner-approved CHANGELOG entries per repo convention.
6. The simulate-override testing hook is acceptable as a dev-only MMKV flag, removed or left
   dormant (default absent) after verification.
