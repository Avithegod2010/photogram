// @ts-nocheck
// Probe stub for react-native-mmkv: settingsStore creates its MMKV instance
// at module load; zustand persist only uses get/set/remove.
const store = new Map<string, string>();
export function createMMKV(_opts?: unknown) {
  return {
    getString: (k: string) => store.get(k) ?? undefined,
    getNumber: (k: string) => {
      const raw = store.get(k);
      if (raw === undefined) return 0;
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    },
    set: (k: string, v: string) => void store.set(k, String(v)),
    remove: (k: string) => void store.delete(k),
    contains: (k: string) => store.has(k),
  };
}
export function toString(value: unknown) {
  return String(value);
}
export const MMKV = createMMKV;
