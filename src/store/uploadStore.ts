import { create } from "zustand";

export interface UploadActiveItem {
  queueId: number;
  mediaId: number;
  fileName: string;
  byteSize: number;
  uploadedBytes: number;
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
  lastError: string | null;
  setRunning: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setThrottledUntil: (t: number | null) => void;
  setActive: (a: UploadActiveItem | null) => void;
  setActiveProgress: (uploadedBytes: number) => void;
  setCounts: (c: { pending: number; done: number; failed: number }) => void;
  addSessionBytes: (n: number) => void;
  setError: (e: string | null) => void;
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
  lastError: null,
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
  addSessionBytes: (n) => set((s) => ({ sessionBytes: s.sessionBytes + n })),
  setError: (e) => set({ lastError: e }),
}));
