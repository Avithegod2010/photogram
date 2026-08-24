import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";

export const mmkv = createMMKV({ id: "photogram-settings" });

interface SettingsState {
  exifPreserve: boolean;
  hiddenLockEnabled: boolean;
  wifiOnlyUpload: boolean;
  chargeOnlyUpload: boolean;
  setExifPreserve: (v: boolean) => void;
  setHiddenLockEnabled: (v: boolean) => void;
  setWifiOnlyUpload: (v: boolean) => void;
  setChargeOnlyUpload: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      exifPreserve: true,
      hiddenLockEnabled: true,
      wifiOnlyUpload: false,
      chargeOnlyUpload: false,
      setExifPreserve: (v) => set({ exifPreserve: v }),
      setHiddenLockEnabled: (v) => set({ hiddenLockEnabled: v }),
      setWifiOnlyUpload: (v) => set({ wifiOnlyUpload: v }),
      setChargeOnlyUpload: (v) => set({ chargeOnlyUpload: v }),
    }),
    {
      name: "photogram-settings",
      storage: createJSONStorage(() => ({
        getItem: (key) => mmkv.getString(key) ?? null,
        setItem: (key, value) => mmkv.set(key, value),
        removeItem: (key) => mmkv.remove(key),
      })),
    }
  )
);
