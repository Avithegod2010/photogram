import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";

export const mmkv = createMMKV({ id: "photogram-settings" });

export type UploadQuality = "original" | "storage_saver";

interface SettingsState {
  exifPreserve: boolean;
  hiddenLockEnabled: boolean;
  wifiOnlyUpload: boolean;
  chargeOnlyUpload: boolean;
  uploadQuality: UploadQuality;
  // Upload scheme: send a small preview photo first, then the original file as
  // a reply to that preview (keeps a light preview visible in Telegram while
  // the heavy original threads beneath it).
  previewReplyUploads: boolean;
  sharedTimelineMaster: boolean;
  ocrSearchEnabled: boolean;
  // F2 Junk Sweeper: opt-in. When on, a weekly in-app sweep analyzes thumbnails
  // and suggests junk in the review screen; nothing is ever auto-deleted.
  junkSweeperEnabled: boolean;
  autoBackupEnabled: boolean;
  autoBackupFolders: string[];
  // F1: the "Restore your backup" banner on GalleryScreen shows once per fresh
  // install until the owner taps it or dismisses it.
  migrationBannerShown: boolean;
  // Batch 3: when true, gallery photo tiles in Days mode also show the
  // per-tile capture-date badge (default off for a cleaner grid).
  showDateOnPhotos: boolean;
  // Danger zone (rate-limit & account-safety hardening): forced pause between
  // every sendMessage in seconds, 0 = off. Ladder windows can force more.
  uploadGapSeconds: number;
  // Daily upload budget in GB, 0 = no cap. The gate lives in uploadSafety.ts.
  dailyBudgetGb: number;
  setExifPreserve: (v: boolean) => void;
  setHiddenLockEnabled: (v: boolean) => void;
  setWifiOnlyUpload: (v: boolean) => void;
  setChargeOnlyUpload: (v: boolean) => void;
  setUploadQuality: (q: UploadQuality) => void;
  setPreviewReplyUploads: (v: boolean) => void;
  setSharedTimelineMaster: (v: boolean) => void;
  setOcrSearchEnabled: (v: boolean) => void;
  setAutoBackupEnabled: (v: boolean) => void;
  setAutoBackupFolders: (v: string[]) => void;
  setMigrationBannerShown: (v: boolean) => void;
  setShowDateOnPhotos: (v: boolean) => void;
  setJunkSweeperEnabled: (v: boolean) => void;
  setUploadGapSeconds: (v: number) => void;
  setDailyBudgetGb: (v: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      exifPreserve: true,
      hiddenLockEnabled: true,
      wifiOnlyUpload: false,
      chargeOnlyUpload: false,
      uploadQuality: "storage_saver",
      previewReplyUploads: true,
      sharedTimelineMaster: false,
      ocrSearchEnabled: false,
      junkSweeperEnabled: false,
      autoBackupEnabled: false,
      autoBackupFolders: [],
      migrationBannerShown: false,
      showDateOnPhotos: false,
      uploadGapSeconds: 0,
      dailyBudgetGb: 25,
      setExifPreserve: (v) => set({ exifPreserve: v }),
      setHiddenLockEnabled: (v) => set({ hiddenLockEnabled: v }),
      setWifiOnlyUpload: (v) => set({ wifiOnlyUpload: v }),
      setChargeOnlyUpload: (v) => set({ chargeOnlyUpload: v }),
      setUploadQuality: (q) => set({ uploadQuality: q }),
      setPreviewReplyUploads: (v) => set({ previewReplyUploads: v }),
      setSharedTimelineMaster: (v) => set({ sharedTimelineMaster: v }),
      setOcrSearchEnabled: (v) => set({ ocrSearchEnabled: v }),
      setAutoBackupEnabled: (v) => set({ autoBackupEnabled: v }),
      setAutoBackupFolders: (v) => set({ autoBackupFolders: v }),
      setMigrationBannerShown: (v) => set({ migrationBannerShown: v }),
      setShowDateOnPhotos: (v) => set({ showDateOnPhotos: v }),
      setJunkSweeperEnabled: (v) => set({ junkSweeperEnabled: v }),
      setUploadGapSeconds: (v) => set({ uploadGapSeconds: v }),
      setDailyBudgetGb: (v) => set({ dailyBudgetGb: v }),
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
