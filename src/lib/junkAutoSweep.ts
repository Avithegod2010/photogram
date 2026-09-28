import { runSweep } from "./junk";
import { useSettingsStore, mmkv } from "../store/settingsStore";

// F2 weekly auto-sweep — an in-app interval (no native background task; the
// expo-background-task path was deliberately deferred). Follows the
// autoBackup.ts pattern: started from App.tsx once auth is ready.

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // check once a day
const SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // sweep at most weekly
const LAST_SWEEP_KEY = "junk_last_sweep_at";
const FIRST_CHECK_DELAY_MS = 60_000;

let loopStarted = false;

async function checkAndSweep(): Promise<void> {
  if (!useSettingsStore.getState().junkSweeperEnabled) return;
  const last = Number(mmkv.getString(LAST_SWEEP_KEY) ?? 0);
  if (Number.isFinite(last) && Date.now() - last < SWEEP_INTERVAL_MS) return;
  try {
    await runSweep();
  } catch {
    return; // a failed auto-sweep must never crash the app loop
  }
  mmkv.set(LAST_SWEEP_KEY, String(Date.now()));
}

export function startJunkAutoSweepLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  // First check shortly after boot, then daily; the 7-day MMKV timestamp gate
  // decides whether an actual sweep runs.
  setTimeout(() => void checkAndSweep(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkAndSweep(), CHECK_INTERVAL_MS);
}
