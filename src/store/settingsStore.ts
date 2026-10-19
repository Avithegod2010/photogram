import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";
import type { IntegritySchedule } from "../lib/integritySchedule";

export type { IntegritySchedule };

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
  // v0.23 Vibe search: opt-in on-device image labeling at scan time. Labels
  // live in media.ml_labels and only power search — nothing leaves the phone.
  smartTagsEnabled: boolean;
  // v0.33+ People & Pets: opt-in face detection at scan time (on-device).
  // faceModelId records which downloadable embedding model the user chose —
  // embeddings are only comparable within one model.
  peopleTagsEnabled: boolean;
  faceModelId: string | null;
  // v0.28 Album locks: album route keys ("camera", "shared-3", …) that demand
  // a biometric check before AlbumScreen shows any content. Local-only.
  lockedAlbumKeys: string[];
  // v0.42 pinned albums: album route keys shown first (with a pin) on the
  // Albums grid. Local-only.
  pinnedAlbumKeys: string[];
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
  // v0.16 Notifications (opt-in). Master gate + two sub-types; nothing fires
  // while the master is off.
  notificationsEnabled: boolean;
  notifyBackupFinished: boolean;
  notifyOnThisDay: boolean;
  notifyAnniversaries: boolean;
  // v0.37: how often the app auto-walks the library and verifies every
  // "synced" item against Telegram ("backup integrity"). An in-app loop
  // checks a few times a day; the interval gate decides when a pass runs.
  integritySchedule: IntegritySchedule;
  setIntegritySchedule: (v: IntegritySchedule) => void;
  // v0.38: export the manifest as compact one-line JSON instead of indented.
  exportMinifyJson: boolean;
  setExportMinifyJson: (v: boolean) => void;
  // v0.39: monthly "Wrapped-style" backup-health notification (notify master gates it).
  notifyHealthDigest: boolean;
  setNotifyHealthDigest: (v: boolean) => void;
  // v0.40: weekly automatic manifest snapshot in documents/export/snapshots/
  // (local files only; the newest 8 are kept). Default ON — pure safety net.
  snapshotExport: boolean;
  setSnapshotExport: (v: boolean) => void;
  setExifPreserve: (v: boolean) => void;
  setHiddenLockEnabled: (v: boolean) => void;
  setWifiOnlyUpload: (v: boolean) => void;
  setChargeOnlyUpload: (v: boolean) => void;
  setUploadQuality: (q: UploadQuality) => void;
  setPreviewReplyUploads: (v: boolean) => void;
  setSharedTimelineMaster: (v: boolean) => void;
  setOcrSearchEnabled: (v: boolean) => void;
  setSmartTagsEnabled: (v: boolean) => void;
  setPeopleTagsEnabled: (v: boolean) => void;
  setFaceModelId: (id: string | null) => void;
      setAlbumLocked: (key: string, locked: boolean) => void;
      setAlbumPinned: (key: string, pinned: boolean) => void;
  setAutoBackupEnabled: (v: boolean) => void;
  setAutoBackupFolders: (v: string[]) => void;
  setMigrationBannerShown: (v: boolean) => void;
  setShowDateOnPhotos: (v: boolean) => void;
  setJunkSweeperEnabled: (v: boolean) => void;
  setUploadGapSeconds: (v: number) => void;
  setDailyBudgetGb: (v: number) => void;
  setNotificationsEnabled: (v: boolean) => void;
  setNotifyBackupFinished: (v: boolean) => void;
  setNotifyOnThisDay: (v: boolean) => void;
  setNotifyAnniversaries: (v: boolean) => void;
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
      smartTagsEnabled: false,
      peopleTagsEnabled: false,
      faceModelId: null,
      lockedAlbumKeys: [],
      pinnedAlbumKeys: [],
      junkSweeperEnabled: false,
      autoBackupEnabled: false,
      autoBackupFolders: [],
      migrationBannerShown: false,
      showDateOnPhotos: false,
      uploadGapSeconds: 0,
      dailyBudgetGb: 25,
      notificationsEnabled: false,
      notifyBackupFinished: true,
      notifyOnThisDay: true,
      notifyAnniversaries: true,
      integritySchedule: "off",
      setIntegritySchedule: (v) => set({ integritySchedule: v }),
      exportMinifyJson: false,
      setExportMinifyJson: (v) => set({ exportMinifyJson: v }),
  notifyHealthDigest: false,
  setNotifyHealthDigest: (v) => set({ notifyHealthDigest: v }),
  snapshotExport: true,
  setSnapshotExport: (v) => set({ snapshotExport: v }),
      setExifPreserve: (v) => set({ exifPreserve: v }),
      setHiddenLockEnabled: (v) => set({ hiddenLockEnabled: v }),
      setWifiOnlyUpload: (v) => set({ wifiOnlyUpload: v }),
      setChargeOnlyUpload: (v) => set({ chargeOnlyUpload: v }),
      setUploadQuality: (q) => set({ uploadQuality: q }),
      setPreviewReplyUploads: (v) => set({ previewReplyUploads: v }),
      setSharedTimelineMaster: (v) => set({ sharedTimelineMaster: v }),
      setOcrSearchEnabled: (v) => set({ ocrSearchEnabled: v }),
      setSmartTagsEnabled: (v) => set({ smartTagsEnabled: v }),
      setPeopleTagsEnabled: (v) => set({ peopleTagsEnabled: v }),
      setFaceModelId: (id) => set({ faceModelId: id }),
      setAlbumLocked: (key, locked) =>
        set((s) => ({
          lockedAlbumKeys: locked
            ? s.lockedAlbumKeys.includes(key)
              ? s.lockedAlbumKeys
              : [...s.lockedAlbumKeys, key]
            : s.lockedAlbumKeys.filter((k) => k !== key),
        })),
      setAlbumPinned: (key, pinned) =>
        set((s) => ({
          pinnedAlbumKeys: pinned
            ? s.pinnedAlbumKeys.includes(key)
              ? s.pinnedAlbumKeys
              : [...s.pinnedAlbumKeys, key]
            : s.pinnedAlbumKeys.filter((k) => k !== key),
        })),
      setAutoBackupEnabled: (v) => set({ autoBackupEnabled: v }),
      setAutoBackupFolders: (v) => set({ autoBackupFolders: v }),
      setMigrationBannerShown: (v) => set({ migrationBannerShown: v }),
      setShowDateOnPhotos: (v) => set({ showDateOnPhotos: v }),
      setJunkSweeperEnabled: (v) => set({ junkSweeperEnabled: v }),
      setUploadGapSeconds: (v) => set({ uploadGapSeconds: v }),
      setDailyBudgetGb: (v) => set({ dailyBudgetGb: v }),
      setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
      setNotifyBackupFinished: (v) => set({ notifyBackupFinished: v }),
      setNotifyOnThisDay: (v) => set({ notifyOnThisDay: v }),
      setNotifyAnniversaries: (v) => set({ notifyAnniversaries: v }),
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
