import { getMeta, setMeta } from "../db/queries";

// v0.55 startup budget.
//
// A cold start is the first thing the owner feels; without a number, "the
// gallery got slow" is unfalsifiable. BOOT_AT is captured when this module is
// first imported (App.tsx imports it at the top), and the first effect records
// how long the app took to reach the ready phase. The last 10 samples live in
// meta and are shown in Diagnostics.

export const BOOT_AT = Date.now();
export const STARTUP_KEY = "startup_samples";
export const STARTUP_KEEP = 10;

export interface StartupSample {
  at: number;
  ms: number;
  version: string;
}

// Pure: append, keep the newest N, drop obviously bogus samples.
export function appendStartupSample(
  existing: StartupSample[],
  sample: StartupSample,
  keep = STARTUP_KEEP
): StartupSample[] {
  const clean = existing.filter(
    (s) => Number.isFinite(s?.ms) && s.ms >= 0 && s.ms < 10 * 60 * 1000
  );
  if (!Number.isFinite(sample.ms) || sample.ms < 0) return clean;
  return [...clean, sample].slice(-keep);
}

export function medianStartupMs(samples: StartupSample[]): number | null {
  const values = samples.map((s) => s.ms).filter((ms) => Number.isFinite(ms)).sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? Math.round((values[mid - 1] + values[mid]) / 2)
    : Math.round(values[mid]);
}

export async function loadStartupSamples(): Promise<StartupSample[]> {
  try {
    const raw = await getMeta(STARTUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s) => s && typeof s.ms === "number" && typeof s.at === "number")
      : [];
  } catch {
    return [];
  }
}

export async function recordStartup(version: string): Promise<StartupSample[]> {
  const ms = Date.now() - BOOT_AT;
  try {
    const samples = appendStartupSample(await loadStartupSamples(), {
      at: Date.now(),
      ms,
      version,
    });
    await setMeta(STARTUP_KEY, JSON.stringify(samples));
    return samples;
  } catch {
    return [];
  }
}
