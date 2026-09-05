// Upload rate-limit & account-safety hardening (docs/PLAN-RATE-LIMIT-SAFETY.md).
// Single home for every safety constant, the persisted counters (day/hour byte
// budgets, rate-limit hit log, pause until-timestamps) and the escalation
// ladder. All persisted state lives in the SAME `uploads` MMKV instance the
// uploadStore uses, so it survives app restarts (plan §5 E1).
//
// Ladder (owner-final numbers, 2026-09-05):
//   1st FLOOD_WAIT        → obey X + 3 min, worker-wide
//   2nd hit within 1 h    → obey X + 30 min + forced 2 s gap (while 1 h window active)
//   3rd hit within 24 h   → 6 h safety pause + warning + forced 4 s gap for 24 h
//   any single X > 1 h    → rest-of-local-day pause
//   PEER_FLOOD            → 24 h pause + loud warning + 4 s gap for 24 h

import { TdError } from "./tdlib";
import { useSettingsStore } from "../store/settingsStore";
import { uploadsMmkv } from "../store/uploadStore";

// ---------------------------------------------------------------------------
// Constants (plan §4 — owner FINAL numbers)
// ---------------------------------------------------------------------------

export const DAILY_BUDGET_BYTES = 25_000_000_000; // 25 GB — owner-set default
export const HOURLY_BUDGET_BYTES = 4_000_000_000; // 4 GB — runaway circuit-breaker
export const FLOOD_BUFFER_MS = 180_000; // obey X + exactly 3 extra minutes
export const MAX_OBEY_MS = 3_600_000; // waits > 1 h route to a rest-of-day pause
export const DEFAULT_UNPARSED_429_WAIT_S = 60; // code 429 without a parseable wait
export const SECOND_HIT_EXTRA_PAUSE_MS = 1_800_000; // 2nd hit within 1 h: +30 min
export const THIRD_HIT_PAUSE_MS = 21_600_000; // 3rd hit within 24 h: 6 h pause
export const PEER_FLOOD_PAUSE_MS = 86_400_000; // PEER_FLOOD: 24 h pause
export const SLOW_GAP_MS_AFTER_2ND = 2_000; // forced gap while the 1 h window is active
export const SLOW_GAP_MS_AFTER_3RD = 4_000; // forced gap for 24 h after a 3rd hit / PEER_FLOOD
export const FLOOD_LOG_CAP = 50; // ring buffer cap — enough for 24 h windowing
export const RATE_WINDOW_1H_MS = 3_600_000;
export const RATE_WINDOW_24H_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Persisted budget counters (day rolls at local midnight, hour on hour-of-epoch)
// ---------------------------------------------------------------------------

export function currentDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function currentHourKey(): string {
  return String(Math.floor(Date.now() / 3_600_000));
}

// Ms until the next local midnight / next hour-of-epoch boundary.
export function msUntilNextMidnight(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(60_000, midnight.getTime() - now.getTime());
}

export function msUntilNextHour(): number {
  const now = Date.now();
  return Math.max(60_000, (Math.floor(now / 3_600_000) + 1) * 3_600_000 - now);
}

export interface BudgetState {
  todayBytes: number;
  hourBytes: number;
  dailyBudgetGb: number; // 0 = no cap
  dailyBudgetBytes: number;
  dailyCapReached: boolean;
  hourlyCapReached: boolean;
}

// Day bytes use the SAME persisted "today" key uploadStore.addSessionBytes
// writes on every confirmed upload (single writer, same {key, bytes} shape);
// hour bytes live under "hour" and are written by recordBytes below.
function loadCounted(key: "today" | "hour"): { key: string; bytes: number } {
  try {
    const stored = uploadsMmkv.getString(key);
    if (!stored) return { key: "", bytes: 0 };
    const parsed = JSON.parse(stored) as { key: string; bytes: number };
    if (!parsed || typeof parsed.bytes !== "number") return { key: "", bytes: 0 };
    return { key: String(parsed.key ?? ""), bytes: Number(parsed.bytes) || 0 };
  } catch {
    return { key: "", bytes: 0 };
  }
}

// Loads and validates the persisted counters, rolling them over when the day /
// hour boundary has passed. Persisted values survive restarts (plan §5 E1).
export function budgetState(): BudgetState {
  const day = loadCounted("today");
  const todayBytes = day.key === currentDayKey() ? day.bytes : 0;
  const hour = loadCounted("hour");
  const hourBytes = hour.key === currentHourKey() ? hour.bytes : 0;
  const dailyBudgetGb = useSettingsStore.getState().dailyBudgetGb;
  const dailyBudgetBytes = dailyBudgetGb > 0 ? dailyBudgetGb * 1_000_000_000 : 0;
  return {
    todayBytes,
    hourBytes,
    dailyBudgetGb,
    dailyBudgetBytes,
    dailyCapReached: dailyBudgetBytes > 0 && todayBytes >= dailyBudgetBytes,
    hourlyCapReached: hourBytes >= HOURLY_BUDGET_BYTES,
  };
}

// Adds n bytes to the persisted hourly budget counter at the moment an upload
// is CONFIRMED (the day counter is written by uploadStore.addSessionBytes in
// the same success path).
export function recordBytes(n: number): void {
  if (!(n > 0)) return;
  try {
    const hour = loadCounted("hour");
    const hourBytes = (hour.key === currentHourKey() ? hour.bytes : 0) + n;
    uploadsMmkv.set("hour", JSON.stringify({ key: currentHourKey(), bytes: hourBytes }));
  } catch {}
}

// Returns the ms the caller must wait before sending (0 = clear) plus a
// human-readable reason. Budget gates are DERIVED from the persisted counters
// on every check, so a restart mid-gate keeps the hold without extra state.
export function waitForBudget(): { waitMs: number; reason: string } {
  const b = budgetState();
  if (b.dailyCapReached) {
    return {
      waitMs: msUntilNextMidnight(),
      reason: `Daily backup budget reached (${fmtGb(b.todayBytes)}) — resuming after midnight`,
    };
  }
  if (b.hourlyCapReached) {
    return {
      waitMs: msUntilNextHour(),
      reason: `Hourly upload cap reached (${fmtGb(b.hourBytes)}) — resuming next hour`,
    };
  }
  return { waitMs: 0, reason: "" };
}

function fmtGb(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Persisted pause (safety ladder) — checked by the worker loop on every pass,
// so an app restart mid-pause resumes the remaining wait (plan §5 E1).
// ---------------------------------------------------------------------------

export function setSafetyPause(until: number, reason: string): void {
  // Never shorten an already-active pause (a bigger wait always wins).
  if (until > (uploadsMmkv.getNumber("safetyPauseUntil") ?? 0)) {
    uploadsMmkv.set("safetyPauseUntil", until);
    uploadsMmkv.set("safetyPauseReason", reason);
  }
}

// The first active blocking gate for the worker loop, or null when free.
// Order (plan §5 E6): safety pause → daily budget → hourly budget.
export function activeSafetyGate(): { until: number; reason: string } | null {
  const now = Date.now();
  const safety = uploadsMmkv.getNumber("safetyPauseUntil") ?? 0;
  if (safety > now) {
    const reason = uploadsMmkv.getString("safetyPauseReason") ?? "Uploads paused for account safety";
    return { until: safety, reason };
  }
  const budget = waitForBudget();
  if (budget.waitMs > 0) return { until: now + budget.waitMs, reason: budget.reason };
  return null;
}

// ---------------------------------------------------------------------------
// Error parsing — both TDLib gson camelCase payloads and wire snake_case,
// code 429, "slow down" text and PEER_FLOOD patterns.
// ---------------------------------------------------------------------------

export type RateLimitKind = "flood" | "peer" | "other";

export interface ParsedRateLimit {
  kind: RateLimitKind;
  waitMs: number; // 0 for "other" / unparseable non-429 payloads
}

// `payload` is the updateMessageSendFailed payload (nested error{code,message};
// fields may arrive gson camelCase or wire snake_case); `err` an optional
// thrown error from another path. Recognizes: FLOOD_WAIT_X (any shape),
// "retry after N", code 429/420 without text (→ 60 s default), "slow down",
// "too many requests" and PEER_FLOOD.
export function parseRateLimitError(
  payload?: Record<string, unknown> | null,
  err?: unknown
): ParsedRateLimit {
  const texts: string[] = [];
  const codes: number[] = [];

  const collect = (obj: Record<string, unknown> | null | undefined) => {
    if (!obj) return;
    const message = firstDefined(obj.message, obj.error_message, obj.text);
    if (typeof message === "string") texts.push(message);
    const code = firstDefined(obj.code, obj.error_code);
    if (typeof code === "number") codes.push(code);
  };
  collect(payload?.error as Record<string, unknown> | undefined);
  collect(payload ?? null);
  if (err instanceof TdError) {
    texts.push(err.message);
    codes.push(err.code);
  } else if (err instanceof Error) {
    texts.push(err.message);
  }

  const joined = texts.join(" | ");
  if (/PEER[_ ]FLOOD/i.test(joined)) return { kind: "peer", waitMs: 0 };

  // FLOOD_WAIT_X / flood_wait_X / FLOOD WAIT X / "retry after N" / "wait N s"
  const floodMatch = joined.match(/FLOOD(?:_WAIT)?[_ ]?(?:WAIT)?[_ ]?(\d+)/i);
  const waitMatch = joined.match(/(?:retry after|wait)\s+(\d+)\s*(?:s\b|sec|second)?/i);
  const rawSeconds = floodMatch
    ? parseInt(floodMatch[1], 10)
    : waitMatch
    ? parseInt(waitMatch[1], 10)
    : null;

  const code = codes.find((c) => c > 0) ?? 0;
  const limitShaped = code === 429 || code === 420 || /slow down|too many requests/i.test(joined);

  if (rawSeconds !== null && rawSeconds > 0 && (floodMatch !== null || limitShaped)) {
    // Clamp to [1 s, 24 h] as a sanity cap against bogus strings (plan §2.1 G7).
    // Waits above MAX_OBEY_MS keep their size so the LADDER can route them to
    // the rest-of-day pause instead of a naive direct obedience.
    const waitMs = Math.min(Math.max(rawSeconds * 1000, 1_000), RATE_WINDOW_24H_MS);
    return { kind: "flood", waitMs };
  }
  if (limitShaped) return { kind: "flood", waitMs: DEFAULT_UNPARSED_429_WAIT_S * 1000 };
  return { kind: "other", waitMs: 0 };
}

function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

// ---------------------------------------------------------------------------
// Hit log (ring buffer) + escalation ladder
// ---------------------------------------------------------------------------

interface HitRecord {
  at: number;
  kind: RateLimitKind;
  waitMs: number;
}

function loadHitLog(): HitRecord[] {
  try {
    const stored = uploadsMmkv.getString("hitLog");
    if (!stored) return [];
    const parsed = JSON.parse(stored) as HitRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((h) => h && typeof h.at === "number")
      .map((h) => ({
        at: h.at,
        kind: h.kind === "peer" || h.kind === "flood" ? h.kind : "other",
        waitMs: Number(h.waitMs) || 0,
      }));
  } catch {
    return [];
  }
}

function saveHitLog(log: HitRecord[]): void {
  try {
    uploadsMmkv.set("hitLog", JSON.stringify(log.slice(-FLOOD_LOG_CAP)));
  } catch {}
}

// Appends the hit, then evaluates the ladder. Called for EVERY parsed
// limit-shaped failure (real or simulated) so all hits walk the same path.
export function recordHit(kind: RateLimitKind, waitMs: number): LadderResponse {
  const log = loadHitLog();
  log.push({ at: Date.now(), kind, waitMs });
  saveHitLog(log);
  return escalationFor(log);
}

export interface LadderResponse {
  pauseMs: number; // total worker-wide pause from now
  gapMs: number; // forced inter-message gap while the window is active
  gapUntil: number | null;
  isPeerFlood: boolean;
  reason: string; // human-readable for Settings / the error row
  warn: boolean; // show a loud Alert once (per hit)
}

// Pure ladder evaluation over the hit log — no side effects. The rungs are a
// PRECEDENCE list (owner-final, plan §4): each hit falls to exactly one rung,
// and every rung still obeys the current wait X.
export function escalationFor(log: HitRecord[]): LadderResponse {
  const now = Date.now();
  const last = log[log.length - 1] ?? null;
  if (!last) {
    return {
      pauseMs: 0,
      gapMs: 0,
      gapUntil: null,
      isPeerFlood: false,
      reason: "",
      warn: false,
    };
  }

  const waitMs = last.waitMs;
  const inLast1h = log.filter((h) => now - h.at <= RATE_WINDOW_1H_MS).length;
  const inLast24h = log.filter((h) => now - h.at <= RATE_WINDOW_24H_MS).length;
  const bigWait = waitMs > MAX_OBEY_MS;

  // PEER_FLOOD (any rung): 24 h pause + loud warning + 4 s gap for 24 h.
  if (last.kind === "peer") {
    return {
      pauseMs: PEER_FLOOD_PAUSE_MS,
      gapMs: SLOW_GAP_MS_AFTER_3RD,
      gapUntil: now + RATE_WINDOW_24H_MS,
      isPeerFlood: true,
      reason:
        "PEER_FLOOD: Telegram blocked sending — this is serious. Uploads stopped for 24 h to protect your account.",
      warn: true,
    };
  }

  // Any single wait > 1 h: rest-of-local-day pause + 4 s gap for 24 h after.
  // The pause must always cover the flood wall itself (X + buffer) even when
  // midnight is closer than X (e.g. FLOOD_WAIT 7200 at 23:00 → rest-of-day is
  // only 60 min), and must never undercut the 3rd-hit rung when that condition
  // also holds (a 3rd hit at 22:00 with a 2 h wait still earns ≥ 6 h).
  if (bigWait) {
    let pauseMs = Math.max(msUntilNextMidnight(), waitMs + FLOOD_BUFFER_MS);
    if (inLast24h >= 3) {
      pauseMs = Math.max(pauseMs, THIRD_HIT_PAUSE_MS);
    }
    return {
      pauseMs,
      gapMs: SLOW_GAP_MS_AFTER_3RD,
      gapUntil: now + RATE_WINDOW_24H_MS,
      isPeerFlood: false,
      reason: `Telegram asked us to wait ${Math.round(waitMs / 60_000)} min — pausing for the rest of the day to stay safe.`,
      warn: true,
    };
  }

  // 3rd hit within 24 h: 6 h safety pause + warning + 4 s gap for 24 h.
  // (6 h always covers X + buffer since X ≤ 1 h here, so X is still obeyed.)
  if (inLast24h >= 3) {
    return {
      pauseMs: THIRD_HIT_PAUSE_MS,
      gapMs: SLOW_GAP_MS_AFTER_3RD,
      gapUntil: now + RATE_WINDOW_24H_MS,
      isPeerFlood: false,
      reason:
        "Safety pause: Telegram limited us 3 times in 24 h. Uploads stop for 6 h and resume slowly.",
      warn: true,
    };
  }

  // 2nd hit within 1 h: obey X + 3 min + 30 min + 2 s gap while the window is active.
  if (inLast1h >= 2) {
    return {
      pauseMs: waitMs + FLOOD_BUFFER_MS + SECOND_HIT_EXTRA_PAUSE_MS,
      gapMs: SLOW_GAP_MS_AFTER_2ND,
      gapUntil: now + RATE_WINDOW_1H_MS,
      isPeerFlood: false,
      reason: "Second slow-down within an hour — pausing 30+ min and slowing uploads.",
      warn: false,
    };
  }

  // 1st hit: obey X + 3 min, worker-wide.
  return {
    pauseMs: waitMs + FLOOD_BUFFER_MS,
    gapMs: 0,
    gapUntil: null,
    isPeerFlood: false,
    reason: `Telegram asked us to slow down — pausing ${Math.max(
      1,
      Math.round((waitMs + FLOOD_BUFFER_MS) / 1000)
    )} s.`,
    warn: false,
  };
}

// ---------------------------------------------------------------------------
// Forced inter-message gap — settings gap first, active ladder window overrides
// ---------------------------------------------------------------------------

// Reads the current forced-gap override, if any ladder window is still live.
function activeForcedGap(now: number): number {
  const gapUntil = uploadsMmkv.getNumber("forcedGapUntil") ?? 0;
  if (gapUntil <= now) return 0;
  return uploadsMmkv.getNumber("forcedGapMs") ?? 0;
}

// Applies the ladder's forced gap (2 s / 4 s) for its window.
export function setForcedGap(gapMs: number, until: number | null): void {
  if (!gapMs || !until) return;
  uploadsMmkv.set("forcedGapMs", gapMs);
  uploadsMmkv.set("forcedGapUntil", until);
}

// Total pre-send delay before EVERY sendMessage call: the Settings gap with a
// forced ladder window taking precedence (the larger of the two applies), plus
// a 0–min(2000, gap) jitter whenever a gap is active.
export function interMessageDelayMs(now: number = Date.now()): number {
  const settingsGap = (useSettingsStore.getState().uploadGapSeconds ?? 0) * 1000;
  const forced = activeForcedGap(now);
  const base = Math.max(settingsGap, forced);
  if (base <= 0) return 0;
  const jitter = Math.min(2_000, base);
  return base + Math.floor(Math.random() * (jitter + 1));
}

// ---------------------------------------------------------------------------
// Simulate (dev/testing) — routes through the REAL ladder path
// ---------------------------------------------------------------------------

// Injects a FAKE 30 s FLOOD_WAIT through recordHit so the whole ladder,
// persistence and status rows can be exercised without a real rate limit.
export function simulateHit(waitMs: number = 30_000): LadderResponse {
  return recordHit("flood", waitMs);
}

// ---------------------------------------------------------------------------
// Settings status snapshot
// ---------------------------------------------------------------------------

export interface SafetyStatus {
  mode: "Normal" | "Cooling down" | "Safety pause";
  modeDetail: string; // "" / "Cooling down until HH:MM" / "Safety pause until HH:MM"
  lastHit: string; // "FLOOD_WAIT 30 s · 14:05" or ""
  hits1h: number;
  hits24h: number;
  todayBytes: number;
  hourBytes: number;
  dailyBudgetGb: number;
}

export function formatResumeTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDuration(ms: number): string {
  if (ms >= 3_600_000) {
    const h = Math.round(ms / 1_800_000) / 2;
    return `${h % 1 === 0 ? String(h) : h.toFixed(1)} h`;
  }
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.max(1, Math.round(ms / 1000))} s`;
}

export function safetyState(): SafetyStatus {
  const now = Date.now();
  const pauseUntil = Math.max(
    uploadsMmkv.getNumber("safetyPauseUntil") ?? 0,
    0
  );
  const isSafety = pauseUntil > now;
  const gate = activeSafetyGate();
  const isBudget = !isSafety && gate !== null;
  const coolingUntil = isBudget ? gate!.until : pauseUntil;

  const log = loadHitLog();
  const hits1h = log.filter((h) => now - h.at <= RATE_WINDOW_1H_MS).length;
  const hits24h = log.filter((h) => now - h.at <= RATE_WINDOW_24H_MS).length;
  const lastHit = log.length > 0 ? log[log.length - 1] : null;

  const b = budgetState();
  let modeDetail = "";
  if (isSafety) modeDetail = `Safety pause until ${formatResumeTime(pauseUntil)}`;
  else if (isBudget) modeDetail = `Cooling down until ${formatResumeTime(coolingUntil)}`;

  return {
    mode: isSafety ? "Safety pause" : isBudget ? "Cooling down" : "Normal",
    modeDetail,
    lastHit: lastHit
      ? `${lastHit.kind === "peer" ? "PEER_FLOOD" : "FLOOD_WAIT"} ${fmtDuration(
          Math.max(lastHit.waitMs, 1_000)
        )} · ${formatResumeTime(lastHit.at)}`
      : "",
    hits1h,
    hits24h,
    todayBytes: b.todayBytes,
    hourBytes: b.hourBytes,
    // Already in GB (settingsStore keeps the raw GB number) — return as-is.
    dailyBudgetGb: b.dailyBudgetGb,
  };
}
