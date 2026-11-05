import { runIntegrityPass, isIntegrityRunning } from "./integrity";
import { useSettingsStore, mmkv } from "../store/settingsStore";

export type IntegritySchedule = "off" | "weekly" | "monthly";

export const INTEGRITY_INTERVALS_MS: Record<IntegritySchedule, number> = {
  off: Infinity,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

// Set only when a scheduled pass reaches finishedAt — i.e. the WHOLE library
// was walked. A stopped/partial pass leaves the timestamp alone so the next
// check retries the same library instead of silently counting it verified.
const LAST_DONE_KEY = "integrity_last_auto_finished_at";

export function shouldRunScheduledIntegrity(
  schedule: IntegritySchedule,
  lastFinishedAt: number,
  now: number
): boolean {
  if (schedule === "off") return false;
  if (isIntegrityRunning()) return false;
  return now - lastFinishedAt >= INTEGRITY_INTERVALS_MS[schedule];
}

export async function checkScheduledIntegrity(): Promise<boolean> {
  const schedule = useSettingsStore.getState().integritySchedule;
  const raw = Number(mmkv.getString(LAST_DONE_KEY) ?? 0);
  const last = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  if (!shouldRunScheduledIntegrity(schedule, last, Date.now())) return false;
  try {
    // One pass per check; the check interval is daily, and the due-gate means
    // the next pass runs only after the library was fully walked once.
    const report = await runIntegrityPass(undefined, undefined, 200);
    if (report.finishedAt !== null) {
      mmkv.set(LAST_DONE_KEY, String(Date.now()));
      if (integrityNeedsAlert(report) && integrityProblemPoster) {
        try {
          await integrityProblemPoster(report.broken, report.checked);
        } catch {}
      }
      // v0.39 deep maintenance: while the prompt is here, let the junk sweep
      // take its weekly turn too (its own gate decides whether it actually
      // runs — "alongside" never means double-firing).
      void import("./junkAutoSweep")
        .then((m) => m.checkAndSweep())
        .catch(() => {});
      return true;
    }
  } catch {
    return false; // an auto-check must never crash the app loop
  }
  return false;
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 90_000;

// v0.55: a scheduled pass is silent when everything is fine and speaks up only
// when something is actually missing. Kept pure so the probe can check the
// "never alert on a partial or clean pass" rule without running a real walk.
export function integrityNeedsAlert(report: {
  broken: number;
  finishedAt: number | null;
}): boolean {
  return report.finishedAt !== null && report.broken > 0;
}

// Hook set by lib/notify.ts (avoids importing notifications here).
export let integrityProblemPoster:
  | ((broken: number, checked: number) => Promise<void>)
  | null = null;

export function setIntegrityProblemPoster(
  fn: (broken: number, checked: number) => Promise<void>
): void {
  integrityProblemPoster = fn;
}

let loopStarted = false;

export function startScheduledIntegrityLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  setTimeout(() => void checkScheduledIntegrity(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkScheduledIntegrity(), CHECK_INTERVAL_MS);
}
