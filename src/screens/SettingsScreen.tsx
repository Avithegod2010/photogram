import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import TdLib from "react-native-tdlib";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fetchProfile } from "../lib/tdlib";
import { formatBytes, getMonthlyBuckets, getStorageTotals, type MonthBucket, type StorageTotals } from "../lib/stats";
import { composeBackupCard } from "../lib/heartbeatCard";
import { canUseBiometrics } from "../lib/biometrics";
import { countFreeableBytes } from "../lib/trash";
import { freeUpDeviceSpace } from "../lib/space";
import { restoreMediaToDevice } from "../lib/restorer";
import { getSyncedWithoutLocal, type RestorableRow, getHealthSnapshot } from "../db/queries";
import { computeHealth, type HealthGrade, type HealthResult } from "../lib/healthScore";
import { runRestoreDrill, DEFAULT_DRILL_COUNT } from "../lib/restoreDrill";
import { pauseUploads, refreshCounts, resumeUploads, simulateRateLimitForTesting } from "../lib/uploader";
import { useUploadStore } from "../store/uploadStore";
import { safetyState, type SafetyStatus } from "../lib/uploadSafety";
import { useSettingsStore, type UploadQuality } from "../store/settingsStore";
import { enableNotifications } from "../lib/notify";
import { useAuthStore } from "../auth/authStore";
import { theme } from "../theme";
import { t, getLocale, setLocale, type Locale } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Badge,
  Button,
  Chip,
  Input,
  ListRow,
  OfflineNotice,
  ProgressBar,
  Screen,
  Section,
  Skeleton,
  Stat,
  ToggleRow,
  alertDialog,
  confirmDialog,
  type BadgeTone,
} from "../ui";

type SettingsNav = NativeStackNavigationProp<{
  Migrate: undefined;
  JunkSweeper: undefined;
  Storage: undefined;
  Diagnostics: undefined;
  Export: undefined;
}>;

function gradeTone(grade: HealthGrade): BadgeTone {
  switch (grade) {
    case "excellent":
      return "success";
    case "good":
      return "accent";
    case "fair":
      return "warning";
    default:
      return "error";
  }
}

export function SettingsScreen() {
  const navigation = useNavigation<SettingsNav>();
  const [totals, setTotals] = useState<StorageTotals | null>(null);
  const [buckets, setBuckets] = useState<MonthBucket[]>([]);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [bioInfo, setBioInfo] = useState<{ hardware: boolean; enrolled: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [freeable, setFreeable] = useState<{ count: number; bytes: number }>({ count: 0, bytes: 0 });
  const [freeing, setFreeing] = useState(false);
  const [restorable, setRestorable] = useState<RestorableRow[]>([]);
  const [restoringText, setRestoringText] = useState<string | null>(null);
  // Danger zone status rows — re-read on mount, pull-to-refresh and simulate.
  const [safety, setSafety] = useState<SafetyStatus>(() => safetyState());
  // v0.55 backup health score (recomputed on every load/pull-to-refresh).
  const [health, setHealth] = useState<HealthResult | null>(null);
  // v0.55 restore drill (downloads a few originals, verifies them, deletes them).
  const [drillRunning, setDrillRunning] = useState(false);

  const exifPreserve = useSettingsStore((s) => s.exifPreserve);
  const hiddenLockEnabled = useSettingsStore((s) => s.hiddenLockEnabled);
  const wifiOnlyUpload = useSettingsStore((s) => s.wifiOnlyUpload);
  const chargeOnlyUpload = useSettingsStore((s) => s.chargeOnlyUpload);
  const wallpaperRotation = useSettingsStore((s) => s.wallpaperRotation);
  const setWallpaperRotation = useSettingsStore((s) => s.setWallpaperRotation);
  const setExifPreserve = useSettingsStore((s) => s.setExifPreserve);
  const setHiddenLockEnabled = useSettingsStore((s) => s.setHiddenLockEnabled);
  const setWifiOnlyUpload = useSettingsStore((s) => s.setWifiOnlyUpload);
  const setChargeOnlyUpload = useSettingsStore((s) => s.setChargeOnlyUpload);
  const uploadQuality = useSettingsStore((s) => s.uploadQuality);
  const setUploadQuality = useSettingsStore((s) => s.setUploadQuality);
  const previewReplyUploads = useSettingsStore((s) => s.previewReplyUploads);
  const setPreviewReplyUploads = useSettingsStore((s) => s.setPreviewReplyUploads);
  const sharedTimelineMaster = useSettingsStore((s) => s.sharedTimelineMaster);
  const setSharedTimelineMaster = useSettingsStore((s) => s.setSharedTimelineMaster);
  const ocrSearchEnabled = useSettingsStore((s) => s.ocrSearchEnabled);
  const setOcrSearchEnabled = useSettingsStore((s) => s.setOcrSearchEnabled);
  const smartTagsEnabled = useSettingsStore((s) => s.smartTagsEnabled);
  const setSmartTagsEnabled = useSettingsStore((s) => s.setSmartTagsEnabled);
  const peopleTagsEnabled = useSettingsStore((s) => s.peopleTagsEnabled);
  const setPeopleTagsEnabled = useSettingsStore((s) => s.setPeopleTagsEnabled);
  const junkSweeperEnabled = useSettingsStore((s) => s.junkSweeperEnabled);
  const setJunkSweeperEnabled = useSettingsStore((s) => s.setJunkSweeperEnabled);
  const autoBackupEnabled = useSettingsStore((s) => s.autoBackupEnabled);
  const uploadWindowEnabled = useSettingsStore((s) => s.uploadWindowEnabled);
  const setUploadWindowEnabled = useSettingsStore((s) => s.setUploadWindowEnabled);
  const uploadWindowStart = useSettingsStore((s) => s.uploadWindowStart);
  const setUploadWindowStart = useSettingsStore((s) => s.setUploadWindowStart);
  const uploadWindowEnd = useSettingsStore((s) => s.uploadWindowEnd);
  const setUploadWindowEnd = useSettingsStore((s) => s.setUploadWindowEnd);
  const setAutoBackupEnabled = useSettingsStore((s) => s.setAutoBackupEnabled);
  const autoBackupFolders = useSettingsStore((s) => s.autoBackupFolders);
  const setAutoBackupFolders = useSettingsStore((s) => s.setAutoBackupFolders);
  const showDateOnPhotos = useSettingsStore((s) => s.showDateOnPhotos);
  const setShowDateOnPhotos = useSettingsStore((s) => s.setShowDateOnPhotos);
  const storyMusic = useSettingsStore((s) => s.storyMusic);
  const setStoryMusic = useSettingsStore((s) => s.setStoryMusic);
  const [, setLocaleTick] = useState(0);
  const uploadGapSeconds = useSettingsStore((s) => s.uploadGapSeconds);
  const setUploadGapSeconds = useSettingsStore((s) => s.setUploadGapSeconds);
  const dailyBudgetGb = useSettingsStore((s) => s.dailyBudgetGb);
  const setDailyBudgetGb = useSettingsStore((s) => s.setDailyBudgetGb);
  // v0.16 Notifications (opt-in).
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const notifyBackupFinished = useSettingsStore((s) => s.notifyBackupFinished);
  const setNotifyBackupFinished = useSettingsStore((s) => s.setNotifyBackupFinished);
  const notifyOnThisDay = useSettingsStore((s) => s.notifyOnThisDay);
  const setNotifyOnThisDay = useSettingsStore((s) => s.setNotifyOnThisDay);
  const notifyAnniversaries = useSettingsStore((s) => s.notifyAnniversaries);
  const setNotifyAnniversaries = useSettingsStore((s) => s.setNotifyAnniversaries);

  // Turning the master on asks the OS for the Android 13+ notification
  // permission (channels are created first inside enableNotifications);
  // a denial reverts the toggle so settings never lie.
  const toggleNotifications = useCallback(
    (v: boolean) => {
      if (!v) {
        setNotificationsEnabled(false);
        return;
      }
      void (async () => {
        const granted = await enableNotifications();
        if (granted) {
          setNotificationsEnabled(true);
        } else {
          setNotificationsEnabled(false);
          void alertDialog({
            title: "Notifications blocked",
            message:
              "Android denied notification permission. You can allow it in system settings → Apps → Photogram → Notifications.",
          });
        }
      })();
    },
    [setNotificationsEnabled]
  );

  // Device albums for the auto-backup folder picker.
  const [deviceAlbums, setDeviceAlbums] = useState<Array<{ id: string; title: string }>>([]);
  const [albumsError, setAlbumsError] = useState<string | null>(null);
  useEffect(() => {
    if (!autoBackupEnabled || deviceAlbums.length > 0) return;
    void (async () => {
      try {
        const MediaLibrary = await import("expo-media-library/legacy");
        const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: false });
        setDeviceAlbums(
          albums
            .filter((a) => (a.assetCount ?? 0) > 0)
            .map((a) => ({ id: a.id, title: a.title }))
        );
        setAlbumsError(null);
      } catch (e) {
        // Distinguish "the OS refused" from "there really are none" — the folder
        // picker used to say "No device albums found" for both.
        console.warn("[settings] getAlbumsAsync failed", e);
        setAlbumsError(e instanceof Error ? e.message : String(e));
        setDeviceAlbums([]);
      }
    })();
  }, [autoBackupEnabled, deviceAlbums.length]);

  const toggleAutoFolder = useCallback(
    (title: string) => {
      const next = autoBackupFolders.includes(title)
        ? autoBackupFolders.filter((f) => f !== title)
        : [...autoBackupFolders, title];
      setAutoBackupFolders(next);
    },
    [autoBackupFolders, setAutoBackupFolders]
  );
  const boot = useAuthStore((s) => s.boot);
  const uploadActive = useUploadStore((s) => s.active);
  const uploadPending = useUploadStore((s) => s.pending);
  const uploadDone = useUploadStore((s) => s.done);
  const uploadFailed = useUploadStore((s) => s.failed);
  const uploadPaused = useUploadStore((s) => s.paused);
  const uploadHoldReason = useUploadStore((s) => s.holdReason);
  const todayBytes = useUploadStore((s) => s.todayBytes);

  // F4 (v0.12.1): live preview of the shareable numbers-only backup status
  // card. null = nothing to report yet (fresh/empty library) → row hidden.
  const [cardPreview, setCardPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSafety(safetyState());
    void getHealthSnapshot()
      .then((s) => setHealth(computeHealth(s)))
      .catch(() => setHealth(null));
    try {
      const [tot, b, f, r] = await Promise.all([
        getStorageTotals(),
        getMonthlyBuckets(),
        countFreeableBytes(),
        getSyncedWithoutLocal(),
      ]);
      setTotals(tot);
      setBuckets(b);
      setFreeable(f);
      setRestorable(r);
    } catch {
      setTotals(null);
    }
    void composeBackupCard().then(setCardPreview);
  }, []);

  useEffect(() => {
    void load();
    void refreshCounts();
    void (async () => {
      const p = await fetchProfile();
      if (!p) return;
      const name = `${(p.first_name as string) ?? ""} ${(p.last_name as string) ?? ""}`.trim();
      setProfileName(name || "Telegram user");
    })();
    void canUseBiometrics().then(setBioInfo);
  }, [load]);

  const maxBucketCount = Math.max(1, ...buckets.map((b) => b.count));

  // v0.55 restore drill: proves a handful of originals can actually be pulled
  // back out of Telegram. Runs on demand only (it uses mobile data).
  const runDrill = useCallback(() => {
    if (drillRunning) return;
    setDrillRunning(true);
    void (async () => {
      try {
        const report = await runRestoreDrill();
        if (report.checked === 0) {
          void alertDialog({
            title: "Restore drill",
            message: "Nothing to test yet — no backed-up item with a Telegram copy was found.",
          });
          return;
        }
        const lines: string[] = [`${report.ok}/${report.checked} downloaded and verified.`];
        if (report.verified > 0) {
          lines.push(`${report.verified} file(s) matched their recorded SHA-256 exactly.`);
        }
        if (report.checksumMismatches > 0) {
          lines.push(`${report.checksumMismatches} file(s) did NOT match — see below.`);
        }
        if (report.sizeDiffs > 0) {
          lines.push(`${report.sizeDiffs} file(s) differ in size from the index (expected for Storage saver uploads).`);
        }
        if (report.problems.length > 0) {
          lines.push("");
          lines.push(`${report.problems.length} problem(s):`);
          for (const p of report.problems.slice(0, 5)) {
            lines.push(`• ${p.fileName} — ${p.detail ?? p.outcome}`);
          }
        } else {
          lines.push("Everything came back intact. Your backup restores.");
        }
        void alertDialog({ title: "Restore drill", message: lines.join("\n") });
      } catch (e) {
        void alertDialog({
          title: "Restore drill failed",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setDrillRunning(false);
        void load();
      }
    })();
  }, [drillRunning, load]);

  const restoreAll = useCallback(() => {
    if (restorable.length === 0) return;
    void confirmDialog({
      title: "Restore originals?",
      message: `Download ${restorable.length} item${restorable.length === 1 ? "" : "s"} (${formatBytes(
        restorable.reduce((s, r) => s + (r.byte_size || 0), 0)
      )}) from your Telegram cloud back onto this device?`,
      confirmLabel: "Restore",
    }).then((ok) => {
      if (!ok) return;
      void (async () => {
        let restored = 0;
        let failed = 0;
        const errors: string[] = [];
        for (let i = 0; i < restorable.length; i++) {
          setRestoringText(`Restoring ${i + 1}/${restorable.length}…`);
          const result = await restoreMediaToDevice(restorable[i].id);
          if (result.outcome === "restored") restored++;
          else {
            failed++;
            if (result.message) errors.push(result.message);
          }
        }
        setRestoringText(null);
        void load();
        void alertDialog({
          title: "Restore finished",
          message: `${restored} item${restored === 1 ? "" : "s"} back on this device${
            failed > 0 ? ` · ${failed} failed` : ""
          }${errors.length ? `\n\n${errors.slice(0, 2).join("\n\n")}` : ""}`,
        });
      })();
    });
  }, [restorable, load]);

  const freeSpace = useCallback(() => {
    void confirmDialog({
      title: "Free up space?",
      message: `Remove ${formatBytes(freeable.bytes)} of local originals? They stay safe in your Telegram cloud; thumbnails remain on device.`,
      confirmLabel: "Remove",
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setFreeing(true);
      void freeUpDeviceSpace()
        .then(() => {
          setFreeable({ count: 0, bytes: 0 });
          void load();
        })
        .finally(() => setFreeing(false));
    });
  }, [freeable.bytes, load]);

  const logout = useCallback(() => {
    void confirmDialog({
      title: "Log out of Telegram?",
      message:
        "Photogram will stop backing up and show the login screen. Your photos stay in Telegram and the local index stays on this phone.",
      confirmLabel: "Log out",
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      void TdLib.logout().finally(() => void boot());
    });
  }, [boot]);

  return (
    <Screen>
      <AppBar title={t("tabs.settings")} large />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
            progressBackgroundColor={theme.colors.surfaceContainer}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <OfflineNotice detail={t("state.offlineBackup")} inset={false} />
        <Section title={t("settings.section.uploads")} icon="cloud-upload-outline">
          {uploadActive ? (
            <View style={styles.uploadCard}>
              <AppText variant="body" weight="medium" numberOfLines={2}>
                {uploadActive.fileName}
              </AppText>
              <ProgressBar
                progress={uploadActive.byteSize > 0 ? uploadActive.uploadedBytes / uploadActive.byteSize : 0}
                label="Upload progress"
                valueText={`${formatBytes(uploadActive.uploadedBytes)} / ${formatBytes(uploadActive.byteSize)}`}
                live
              />
            </View>
          ) : (
            <ListRow
              title={t("settings.noActiveUpload")}
              subtitle={uploadPaused ? "Uploads are paused" : uploadHoldReason ?? "Queue is idle"}
            />
          )}
          <View style={styles.statRow}>
            <Stat style={styles.statCell} value={uploadPending.toLocaleString()} label="Queued" />
            <Stat style={styles.statCell} value={uploadDone.toLocaleString()} label="Uploaded" />
            <Stat style={styles.statCell} value={uploadFailed.toLocaleString()} label="Failed" tone={uploadFailed > 0 ? theme.colors.error : undefined} />
            <Stat style={styles.statCell} value={formatBytes(todayBytes)} label={t("settings.uploadedToday")} />
          </View>
          <View style={styles.buttonRow}>
            <Button
              label={uploadPaused ? t("settings.resume") : t("settings.pause")}
              icon={uploadPaused ? "play" : "pause"}
              variant="secondary"
              size="sm"
              onPress={() => void (uploadPaused ? resumeUploads() : pauseUploads())}
            />
            {uploadPending > 0 ? (
              <Button
                label={t("settings.backupNow")}
                icon="cloud-upload-outline"
                size="sm"
                onPress={() => void resumeUploads()}
              />
            ) : null}
          </View>
        </Section>

        <Section title={t("settings.section.health")} icon="pulse-outline">
          {health === null ? (
            <View style={styles.skeletonBox}>
              <Skeleton height={20} width="40%" />
              <Skeleton height={14} width="80%" />
              <Skeleton height={14} width="65%" />
            </View>
          ) : (
            <View style={styles.healthCard}>
              <View style={styles.healthTop}>
                <AppText variant="display" tabular>
                  {health.score}
                </AppText>
                <View style={styles.flex}>
                  <Badge label={health.grade.toUpperCase()} tone={gradeTone(health.grade)} />
                  <AppText variant="body" weight="medium" style={styles.healthHeadline}>
                    {health.headline}
                  </AppText>
                </View>
              </View>
              {health.reasons.slice(0, 4).map((reason, i) => (
                <AppText key={i} variant="footnote" color={theme.colors.onSurfaceVariant}>
                  • {reason}
                </AppText>
              ))}
              {health.actions.length > 0 ? (
                <Button
                  label={health.actions[0].label}
                  variant="ghost"
                  size="sm"
                  onPress={() => navigation.navigate("Diagnostics")}
                  style={styles.healthAction}
                />
              ) : null}
            </View>
          )}
        </Section>

        <Section title={t("settings.section.preferences")} icon="options-outline">
          <View style={styles.controlRow}>
            <AppText variant="body" weight="medium">
              Upload quality
            </AppText>
            <View style={styles.chipWrap}>
              {(
                [
                  { value: "storage_saver" as const, label: "Storage saver" },
                  { value: "original" as const, label: "Original" },
                ] as const
              ).map((q) => (
                <Chip
                  key={q.value}
                  label={q.label}
                  selected={uploadQuality === q.value}
                  onPress={() => setUploadQuality(q.value as UploadQuality)}
                />
              ))}
            </View>
            <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
              {uploadQuality === "original"
                ? "Upload files exactly as they are"
                : "Photos larger than 2048px are recompressed (~85% quality). Videos always stay original."}
            </AppText>
          </View>
          <ToggleRow
            title="Preview first, file as reply"
            subtitle="Send a small preview photo instantly, then upload the original as a reply to it. Keeps Saved Messages browsable while big files upload."
            value={previewReplyUploads}
            onValueChange={setPreviewReplyUploads}
          />
          <ToggleRow
            title="Preserve EXIF metadata"
            subtitle="Keep date, camera and GPS data when uploading"
            value={exifPreserve}
            onValueChange={setExifPreserve}
          />
          <ToggleRow
            title={t("settings.wifiOnly")}
            subtitle="Queue uploads until a Wi-Fi connection is available"
            value={wifiOnlyUpload}
            onValueChange={setWifiOnlyUpload}
          />
          <ToggleRow title={t("settings.chargeOnly")} value={chargeOnlyUpload} onValueChange={setChargeOnlyUpload} />
        </Section>

        <Section title={t("settings.section.auto")} icon="refresh-outline">
          <ToggleRow
            title={t("settings.autoBackup")}
            subtitle="Photogram quietly rescans every 5 minutes and queues anything new. Wi-Fi/charging rules still apply."
            value={autoBackupEnabled}
            onValueChange={setAutoBackupEnabled}
          />
          <ToggleRow
            title="Upload in a time window only"
            subtitle={`Only between ${fmtHour(uploadWindowStart)} and ${fmtHour(uploadWindowEnd)}. Outside the window uploads pause and auto-resume.`}
            value={uploadWindowEnabled}
            onValueChange={setUploadWindowEnabled}
          />
          {uploadWindowEnabled ? (
            <View style={styles.windowRow}>
              <Input
                label="From"
                value={uploadWindowStart.toLocaleString()}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (Number.isFinite(n)) setUploadWindowStart(n);
                }}
                keyboardType="number-pad"
                maxLength={2}
                containerStyle={styles.flex}
              />
              <Input
                label="To"
                value={uploadWindowEnd.toLocaleString()}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (Number.isFinite(n)) setUploadWindowEnd(n);
                }}
                keyboardType="number-pad"
                maxLength={2}
                containerStyle={styles.flex}
              />
            </View>
          ) : null}
          {autoBackupEnabled ? (
            <View style={styles.folderBlock}>
              <AppText variant="footnote" color={theme.colors.onSurfaceVariant} style={styles.folderHint}>
                Choose which folders to watch (none selected = all folders):
              </AppText>
              {deviceAlbums.map((album) => (
                <ToggleRow
                  key={album.id}
                  title={album.title}
                  value={autoBackupFolders.includes(album.title)}
                  onValueChange={() => toggleAutoFolder(album.title)}
                />
              ))}
              {deviceAlbums.length === 0 ? (
                <ListRow
                  title={albumsError ? "Couldn't read device albums" : "No device albums found"}
                  subtitle={
                    albumsError
                      ? "Check the Photos permission, then reopen this screen."
                      : "New photos are still picked up from the whole library."
                  }
                />
              ) : null}
            </View>
          ) : null}
        </Section>

        <Section title={t("settings.section.notifications")} icon="notifications-outline">
          <ToggleRow
            title={t("settings.notifMaster")}
            subtitle="Photogram notifies you on this phone only. Turn off anytime."
            value={notificationsEnabled}
            onValueChange={toggleNotifications}
          />
          {notificationsEnabled ? (
            <>
              <ToggleRow
                title="Backup finished"
                subtitle="A notification when the upload queue drains."
                value={notifyBackupFinished}
                onValueChange={setNotifyBackupFinished}
              />
              <ToggleRow
                title="On this day"
                subtitle="Once a day, if photos from this day exist in past years. Fires when the app is open after 09:00."
                value={notifyOnThisDay}
                onValueChange={setNotifyOnThisDay}
              />
              <ToggleRow
                title="Favorite anniversaries"
                subtitle="Once a day, favorites from this day in past years (one year minimum)."
                value={notifyAnniversaries}
                onValueChange={setNotifyAnniversaries}
              />
            </>
          ) : null}
        </Section>

        <Section title={t("settings.section.storage")} icon="server-outline">
          {totals === null ? (
            <View style={styles.skeletonBox}>
              <Skeleton height={18} width="70%" />
              <Skeleton height={14} width="55%" />
            </View>
          ) : (
            <>
              <View style={styles.statRow}>
                <Stat style={styles.statCell} value={totals.photos.toLocaleString()} label="Local photos" />
                <Stat style={styles.statCell} value={totals.videos.toLocaleString()} label="Local videos" />
                <Stat style={styles.statCell} value={formatBytes(totals.syncedBytes)} label="In cloud" />
              </View>
              <View style={styles.statRow}>
                <Stat style={styles.statCell} value={totals.cloudPhotos.toLocaleString()} label="Cloud photos" />
                <Stat style={styles.statCell} value={totals.cloudVideos.toLocaleString()} label="Cloud videos" />
                <Stat style={styles.statCell} value={totals.pendingCount.toLocaleString()} label="In queue" />
              </View>
              <View style={styles.statRow}>
                <Stat style={styles.statCell} value={totals.archived.toLocaleString()} label="Archived" />
                <Stat style={styles.statCell} value={totals.trashed.toLocaleString()} label="Trash" />
                <Stat style={styles.statCell} value={totals.hidden.toLocaleString()} label="Hidden" />
              </View>
              <View style={styles.chartBlock}>
                <AppText variant="caption" color={theme.colors.onSurfaceVariant}>
                  Last 6 months
                </AppText>
                <View
                  style={styles.chart}
                  accessible
                  accessibilityLabel={buckets.map((b) => `${b.label}: ${b.count}`).join(", ")}
                >
                  {buckets.map((b) => (
                    <View key={b.label + String(b.count)} style={styles.chartCol}>
                      <View style={styles.barWrap}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: Math.max(4, (b.count / maxBucketCount) * 72),
                              opacity: b.count === 0 ? 0.25 : 1,
                            },
                          ]}
                        />
                      </View>
                      <AppText variant="caption2Regular" color={theme.colors.onSurfaceVariant} numberOfLines={1}>
                        {b.label}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
              <ListRow
                title="What's using space"
                subtitle="Biggest items, size per month, and category bloat — screenshots, WhatsApp, videos."
                accessory="chevron"
                onPress={() => navigation.navigate("Storage")}
              />
              {cardPreview ? (
                <ListRow
                  title="Share backup status"
                  subtitle={cardPreview}
                  onPress={() => {
                    void (async () => {
                      const text = await composeBackupCard();
                      if (!text) return;
                      try {
                        await Share.share({ message: text });
                      } catch {}
                    })();
                  }}
                />
              ) : null}
            </>
          )}
        </Section>

        <Section title={t("settings.section.search")} icon="search-outline">
          <ToggleRow
            title="Read text in photos (OCR)"
            subtitle="Lets search find words inside screenshots and receipts. Applies to new scans and backfills older photos."
            value={ocrSearchEnabled}
            onValueChange={setOcrSearchEnabled}
          />
          <ToggleRow
            title="Smart tags (on-device)"
            subtitle="Labels what photos show — beach, food, dog — so search can find them by content. Runs on this phone only."
            value={smartTagsEnabled}
            onValueChange={setSmartTagsEnabled}
          />
          <ToggleRow
            title="Find faces (People & Pets)"
            subtitle="Detects faces during scans so photos can be grouped by who is in them. Manage the model under Collections → People & Pets."
            value={peopleTagsEnabled}
            onValueChange={setPeopleTagsEnabled}
          />
        </Section>

        <Section title={t("settings.section.library")} icon="images-outline">
          <ToggleRow
            title={t("settings.showDate")}
            subtitle="Show the capture date on every photo tile. Turn off for a cleaner grid."
            value={showDateOnPhotos}
            onValueChange={setShowDateOnPhotos}
          />
          <ToggleRow
            title={t("settings.storyMusic")}
            subtitle="A quiet, self-made ambient loop plays while photos play as a story."
            value={storyMusic}
            onValueChange={setStoryMusic}
          />
          <ToggleRow
            title="Find junk photos automatically"
            subtitle="Suggests blurry shots, pocket pictures, near-duplicates and old screenshots. Nothing is deleted without your review."
            value={junkSweeperEnabled}
            onValueChange={(v) => {
              setJunkSweeperEnabled(v);
              if (v) {
                void alertDialog({
                  title: "Junk sweeper on",
                  message:
                    "Photogram will scan your thumbnails on this phone only. Nothing is deleted without your review, and your Telegram backup always keeps the original.",
                });
              }
            }}
          />
          {junkSweeperEnabled ? (
            <ListRow
              title="Review junk findings"
              subtitle="See what the sweep found and choose what to delete — locally, from Telegram, or both."
              accessory="chevron"
              onPress={() => navigation.navigate("JunkSweeper")}
            />
          ) : null}
        </Section>

        <Section title={t("settings.section.device")} icon="phone-portrait-outline">
          <ToggleRow
            title="Rotate wallpaper from favorites"
            subtitle="Sets a favourite photo as your home and lock-screen wallpaper once a day. Only photos already on this phone are used."
            value={wallpaperRotation}
            onValueChange={(v) => {
              setWallpaperRotation(v);
              void import("../lib/wallpaper").then((m) => m.syncWallpaperConfig());
            }}
          />
          <ListRow
            title="Free up device space"
            subtitle={
              freeable.count > 0
                ? `${formatBytes(freeable.bytes)} of originals safely backed up — remove local copies`
                : "Nothing to free yet. Originals appear here once backed up."
            }
            trailing={
              <Button
                label={freeing ? "Removing…" : "Remove"}
                size="sm"
                variant="secondary"
                disabled={freeing || freeable.count === 0}
                onPress={freeSpace}
              />
            }
          />
          {restorable.length > 0 ? (
            <ListRow
              title="Restore missing originals"
              subtitle={
                restoringText ??
                `${restorable.length} item${restorable.length === 1 ? "" : "s"} (${formatBytes(
                  restorable.reduce((s, r) => s + (r.byte_size || 0), 0)
                )}) live in your Telegram cloud but not on this device.`
              }
              trailing={
                <Button
                  label="Restore"
                  size="sm"
                  variant="secondary"
                  disabled={!!restoringText}
                  onPress={restoreAll}
                />
              }
            />
          ) : null}
        </Section>

        <Section title={t("settings.section.diagnostics")} icon="build-outline">
          <ListRow
            title="Export library"
            subtitle="Every photo's index — dates, tags, notes, people, Telegram ids — as JSON/CSV you can keep anywhere."
            accessory="chevron"
            onPress={() => navigation.navigate("Export")}
          />
          <ListRow
            title="Self-check"
            subtitle="Schema version, database size, queue state, TDLib login state and last scan errors."
            accessory="chevron"
            onPress={() => navigation.navigate("Diagnostics")}
          />
          <ListRow
            title={drillRunning ? "Restore drill running…" : "Restore drill"}
            subtitle={`Downloads ${DEFAULT_DRILL_COUNT} random photos from Telegram, checks they arrive, then deletes the temporary copies.`}
            trailing={drillRunning ? <ActivityIndicator color={theme.colors.accent} /> : undefined}
            onPress={runDrill}
            disabled={drillRunning}
          />
          <ListRow
            title="Migrate from another phone"
            subtitle="Rebuild this phone's library from your Telegram backup — index, originals and shared albums."
            accessory="chevron"
            onPress={() => navigation.navigate("Migrate")}
          />
        </Section>

        <Section title={t("settings.section.shared")} icon="people-outline">
          <ToggleRow
            title="Show shared albums in my timeline"
            subtitle="Master switch — each album has its own toggle too. Default: album-only."
            value={sharedTimelineMaster}
            onValueChange={setSharedTimelineMaster}
          />
        </Section>

        <Section title={t("settings.section.privacy")} icon="lock-closed-outline">
          <ToggleRow
            title="Biometric lock for Hidden"
            subtitle={
              bioInfo && !(bioInfo.hardware && bioInfo.enrolled)
                ? "Requires fingerprint or face enrolled in device settings"
                : "Ask for fingerprint or face before opening Hidden photos"
            }
            disabled={!bioInfo || !bioInfo.hardware || !bioInfo.enrolled}
            value={hiddenLockEnabled}
            onValueChange={setHiddenLockEnabled}
          />
        </Section>

        <Section title={t("settings.section.language")} icon="language-outline">
          {(["en", "hi"] as Locale[]).map((loc) => (
            <ListRow
              key={loc}
              title={loc === "en" ? "English" : "हिंदी"}
              accessory="check"
              selected={getLocale() === loc}
              onPress={() => {
                setLocale(loc);
                setLocaleTick((n) => n + 1);
              }}
            />
          ))}
        </Section>

        <Section title={t("settings.section.account")} icon="person-circle-outline">
          <ListRow title={profileName ?? "Loading…"} subtitle="Logged in via Telegram" />
          <View style={styles.accountAction}>
            <Button label="Log out of Telegram" variant="danger" icon="log-out-outline" onPress={logout} fullWidth />
          </View>
        </Section>

        <Section title={t("settings.section.danger")} icon="warning-outline" danger>
          <View style={styles.controlRow}>
            <AppText variant="body" weight="medium">
              Inter-message gap
            </AppText>
            <View style={styles.chipWrap}>
              {[0, 1, 2, 3, 4].map((s) => (
                <Chip
                  key={s}
                  label={s === 0 ? "Off" : `${s}s`}
                  selected={uploadGapSeconds === s}
                  onPress={() => setUploadGapSeconds(s)}
                  accessibilityLabel={s === 0 ? "No gap between messages" : `${s} second gap between messages`}
                />
              ))}
            </View>
            <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
              Pause between every message sent to Telegram. Higher is safer and slower. Safety pauses can force a bigger gap temporarily.
            </AppText>
          </View>
          <View style={styles.controlRow}>
            <AppText variant="body" weight="medium">
              Daily upload budget
            </AppText>
            <View style={styles.chipWrap}>
              {[5, 10, 25, 50, 0].map((gb) => (
                <Chip
                  key={gb}
                  label={gb === 0 ? "No cap" : `${gb} GB`}
                  selected={dailyBudgetGb === gb}
                  onPress={() => setDailyBudgetGb(gb)}
                  accessibilityLabel={gb === 0 ? "No daily upload cap" : `${gb} gigabytes per day`}
                />
              ))}
            </View>
            <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
              {formatBytes(safety.todayBytes)} used today
              {dailyBudgetGb > 0 ? ` of ${dailyBudgetGb} GB` : " — no cap"}. When the budget is reached, uploads pause until midnight.
            </AppText>
          </View>
          <ListRow
            title="Status"
            subtitle={safety.modeDetail || `Normal — uploads running${uploadGapSeconds > 0 ? ` with a ${uploadGapSeconds}s gap` : ""}`}
          />
          <ListRow title="Last rate limit" subtitle={safety.lastHit || "None recorded"} />
          <ListRow title="Rate-limit hits" subtitle={`${safety.hits1h} in the last hour · ${safety.hits24h} in the last 24 h`} />
          <ListRow
            title="Budget used"
            subtitle={`${formatBytes(safety.todayBytes)} today · ${formatBytes(safety.hourBytes)} this hour`}
          />
          <View style={styles.accountAction}>
            <Button
              label="Simulate rate limit (testing)"
              variant="danger"
              icon="flask-outline"
              onPress={() => {
                void confirmDialog({
                  title: "Simulate rate limit?",
                  message:
                    "Injects a fake 30-second FLOOD_WAIT through the real safety ladder: the worker will pause and the escalation counters will count it as a real hit.",
                  confirmLabel: "Simulate",
                  destructive: true,
                }).then((ok) => {
                  if (!ok) return;
                  simulateRateLimitForTesting(30_000);
                  setSafety(safetyState());
                });
              }}
              fullWidth
            />
          </View>
        </Section>

        <AppText variant="captionRegular" color={theme.colors.onSurfaceFaint} align="center" style={styles.footer}>
          Photogram · Your cloud is your Telegram
        </AppText>
      </ScrollView>
    </Screen>
  );
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xl },
  flex: { flex: 1 },
  uploadCard: { padding: theme.spacing.md, gap: theme.spacing.sm },
  statRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    paddingTop: theme.spacing.xs,
  },
  statCell: { flexBasis: "46%", flexGrow: 1 },
  skeletonBox: { padding: theme.spacing.md, gap: theme.spacing.sm },
  healthCard: { padding: theme.spacing.md, gap: theme.spacing.xs },
  healthTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  healthHeadline: { marginTop: theme.spacing.xs },
  healthAction: { marginTop: theme.spacing.xs, alignSelf: "flex-start" },
  controlRow: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.compact,
    gap: theme.spacing.sm,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  windowRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  folderBlock: { paddingBottom: theme.spacing.xs },
  folderHint: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
  chartBlock: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    height: 104,
    gap: theme.spacing.sm,
  },
  chartCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  barWrap: { flex: 1, width: "100%", alignItems: "center", justifyContent: "flex-end" },
  bar: {
    width: "62%",
    maxHeight: 72,
    backgroundColor: theme.colors.accent,
    borderTopLeftRadius: theme.radius.thumb,
    borderTopRightRadius: theme.radius.thumb,
  },
  accountAction: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, paddingTop: theme.spacing.xs },
  footer: { marginTop: theme.spacing.xs, marginBottom: theme.spacing.md },
});
