import { pauseUploads, resumeUploads } from "./uploader";
import { useSettingsStore } from "../store/settingsStore";
import { useUploadStore } from "../store/uploadStore";

// v0.43 Time-window uploading — "upload only at night / while charging" is
// half-shipped (chargeOnly); this adds the clock window. It never touches the
// uploader internals: it drives the existing pauseUploads()/resumeUploads()
// exports from the outside, remembering whether the pause was OURS so a
// window change never overrides a rate-limit or a manual pause mid-flight.
//
// Semantics (documented in the Settings row):
//  - start === end  → the whole day counts as inside (upload anytime)
//  - start < end    → upload between start:00 and end:00 (same day)
//  - start > end    → overnight wrap (upload from start:00 until end:00 next day)

export interface WindowCheck {
  inside: boolean;
  wePaused: boolean;
}

let wePaused = false;

export function windowOpenFor(startHour: number, endHour: number, now = new Date()): boolean {
  const h = now.getHours() + now.getMinutes() / 60;
  if (startHour === endHour) return true;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

// Interval body — never throws. `now` is injectable for the probe.
export async function checkUploadWindow(now = new Date()): Promise<WindowCheck> {
  const s = useSettingsStore.getState();
  try {
    if (!s.uploadWindowEnabled) {
      if (wePaused) {
        wePaused = false;
        await resumeUploads();
      }
      return { inside: true, wePaused: false };
    }
    const inside = windowOpenFor(s.uploadWindowStart, s.uploadWindowEnd, now);
    if (inside) {
      if (wePaused) {
        wePaused = false;
        await resumeUploads();
      }
      return { inside: true, wePaused: false };
    }
    const state = useUploadStore.getState();
    if (!state.paused && !wePaused) {
      wePaused = true;
      await pauseUploads();
    }
    return { inside: false, wePaused };
  } catch {
    return { inside: insideSafe(now), wePaused };
  }
}

function insideSafe(now: Date): boolean {
  const s = useSettingsStore.getState();
  try {
    return !s.uploadWindowEnabled || windowOpenFor(s.uploadWindowStart, s.uploadWindowEnd, now);
  } catch {
    return true;
  }
}

let loopStarted = false;

// Called once from App.tsx (deferred with the other loops). Idempotent.
export function startUploadWindowLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  void checkUploadWindow();
  const t: unknown = setInterval(() => void checkUploadWindow(), 60_000);
  if (t && typeof t === "object" && "unref" in t) (t as { unref: () => void }).unref();
}
