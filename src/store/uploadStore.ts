import { create } from "zustand";
import { createMMKV } from "react-native-mmkv";

export interface UploadActiveItem {
  queueId: number;
  mediaId: number;
  fileName: string;
  byteSize: number;
  uploadedBytes: number;
}

// Shared `uploads` MMKV store — uploadSafety.ts reuses this exact instance for
// its persisted counters/pauses so all upload state lives in one place.
export const uploadsMmkv = createMMKV({ id: "uploads" });

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "Backed up today" survives app restarts, unlike the session counter.
function loadTodayBytes(): number {
  try {
    const stored = uploadsMmkv.getString("today");
    if (!stored) return 0;
    const parsed = JSON.parse(stored) as { key: string; bytes: number };
    return parsed.key === todayKey() ? parsed.bytes : 0;
  } catch {
    return 0;
  }
}

function saveTodayBytes(bytes: number): void {
  try {
    uploadsMmkv.set("today", JSON.stringify({ key: todayKey(), bytes }));
  } catch {}
}

interface UploadState {
  running: boolean;
  paused: boolean;
  throttledUntil: number | null;
  active: UploadActiveItem | null;
  pending: number;
  done: number;
  failed: number;
  sessionBytes: number;
  todayBytes: number;
  lastError: string | null;
  holdReason: string | null;
  setRunning: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setThrottledUntil: (t: number | null) => void;
  setActive: (a: UploadActiveItem | null) => void;
  setActiveProgress: (uploadedBytes: number) => void;
  setCounts: (c: { pending: number; done: number; failed: number }) => void;
  addSessionBytes: (n: number) => void;
  setError: (e: string | null) => void;
  setHoldReason: (r: string | null) => void;
}

export const THROTTLE_LIMIT_BYTES = 1_500_000_000;
export const THROTTLE_PAUSE_MS = 5_000;

export const useUploadStore = create<UploadState>()((set) => ({
  running: false,
  paused: false,
  throttledUntil: null,
  active: null,
  pending: 0,
  done: 0,
  failed: 0,
  sessionBytes: 0,
  todayBytes: loadTodayBytes(),
  lastError: null,
  holdReason: null,
  setRunning: (v) => set({ running: v }),
  setPaused: (v) => set({ paused: v }),
  setThrottledUntil: (t) => set({ throttledUntil: t }),
  setActive: (a) => set({ active: a }),
  setActiveProgress: (uploadedBytes) =>
    set((s) =>
      s.active
        ? { active: { ...s.active, uploadedBytes: Math.min(uploadedBytes, s.active.byteSize) } }
        : {}
    ),
  setCounts: (c) => set(c),
  addSessionBytes: (n) =>
    set((s) => {
      // loadTodayBytes resets to 0 when the stored day is no longer today.
      const today = loadTodayBytes() + n;
      saveTodayBytes(today);
      return { sessionBytes: s.sessionBytes + n, todayBytes: today };
    }),
  setError: (e) => set({ lastError: e }),
  setHoldReason: (r) => set({ holdReason: r }),
}));
