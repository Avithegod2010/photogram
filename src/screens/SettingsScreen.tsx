import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import TdLib from "react-native-tdlib";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchProfile } from "../lib/tdlib";
import { formatBytes, getMonthlyBuckets, getStorageTotals, MonthBucket, StorageTotals } from "../lib/stats";
import { canUseBiometrics } from "../lib/biometrics";
import { countFreeableBytes } from "../lib/trash";
import { freeUpDeviceSpace } from "../lib/space";
import { restoreMediaToDevice } from "../lib/restorer";
import { getSyncedWithoutLocal, RestorableRow } from "../db/queries";
import { pauseUploads, refreshCounts, resumeUploads } from "../lib/uploader";
import { useUploadStore } from "../store/uploadStore";
import { useSettingsStore, UploadQuality } from "../store/settingsStore";
import { useAuthStore } from "../auth/authStore";
import { theme } from "../theme";

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [totals, setTotals] = useState<StorageTotals | null>(null);
  const [buckets, setBuckets] = useState<MonthBucket[]>([]);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [bioInfo, setBioInfo] = useState<{ hardware: boolean; enrolled: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [freeable, setFreeable] = useState<{ count: number; bytes: number }>({ count: 0, bytes: 0 });
  const [freeing, setFreeing] = useState(false);
  const [restorable, setRestorable] = useState<RestorableRow[]>([]);
  const [restoringText, setRestoringText] = useState<string | null>(null);

  const exifPreserve = useSettingsStore((s) => s.exifPreserve);
  const hiddenLockEnabled = useSettingsStore((s) => s.hiddenLockEnabled);
  const wifiOnlyUpload = useSettingsStore((s) => s.wifiOnlyUpload);
  const chargeOnlyUpload = useSettingsStore((s) => s.chargeOnlyUpload);
  const setExifPreserve = useSettingsStore((s) => s.setExifPreserve);
  const setHiddenLockEnabled = useSettingsStore((s) => s.setHiddenLockEnabled);
  const setWifiOnlyUpload = useSettingsStore((s) => s.setWifiOnlyUpload);
  const setChargeOnlyUpload = useSettingsStore((s) => s.setChargeOnlyUpload);
  const uploadQuality = useSettingsStore((s) => s.uploadQuality);
  const setUploadQuality = useSettingsStore((s) => s.setUploadQuality);
  const boot = useAuthStore((s) => s.boot);
  const uploadActive = useUploadStore((s) => s.active);
  const uploadPending = useUploadStore((s) => s.pending);
  const uploadDone = useUploadStore((s) => s.done);
  const uploadFailed = useUploadStore((s) => s.failed);
  const uploadPaused = useUploadStore((s) => s.paused);
  const sessionBytes = useUploadStore((s) => s.sessionBytes);

  const load = useCallback(async () => {
    try {
      const [t, b, f, r] = await Promise.all([
        getStorageTotals(),
        getMonthlyBuckets(),
        countFreeableBytes(),
        getSyncedWithoutLocal(),
      ]);
      setTotals(t);
      setBuckets(b);
      setFreeable(f);
      setRestorable(r);
    } catch {
      setTotals(null);
    }
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

  const restoreAll = useCallback(() => {
    if (restorable.length === 0) return;
    Alert.alert(
      "Restore originals?",
      `Download ${restorable.length} item${restorable.length === 1 ? "" : "s"} (${formatBytes(
        restorable.reduce((s, r) => s + (r.byte_size || 0), 0)
      )}) from your Telegram cloud back onto this device?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: () => {
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
              Alert.alert(
                "Restore finished",
                `${restored} item${restored === 1 ? "" : "s"} back on this device${
                  failed > 0 ? ` · ${failed} failed` : ""
                }${errors.length ? `\n\n${errors.slice(0, 2).join("\n\n")}` : ""}`
              );
            })();
          },
        },
      ]
    );
  }, [restorable, load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        <Text style={styles.screenTitle}>Settings</Text>

        <Section title="Account">
          <Row label={profileName ?? "Loading…"} sub="Logged in via Telegram" />
          <Pressable
            style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
            android_ripple={{ color: theme.colors.errorContainer }}
            onPress={() => {
              void TdLib.logout().finally(() => void boot());
            }}
          >
            <Text style={styles.logoutText}>Log out of Telegram</Text>
          </Pressable>
        </Section>

        <Section title="Storage">
          {totals === null ? (
            <ActivityIndicator color={theme.colors.primary} style={{ padding: theme.spacing.lg }} />
          ) : (
            <>
              <View style={styles.statGrid}>
                <StatCard value={String(totals.photos)} caption="Local photos" />
                <StatCard value={String(totals.videos)} caption="Local videos" />
              </View>
              <View style={[styles.statGrid, styles.gridSecond]}>
                <StatCard value={String(totals.cloudPhotos)} caption="Cloud photos" />
                <StatCard value={String(totals.cloudVideos)} caption="Cloud videos" />
                <StatCard value={formatBytes(totals.syncedBytes)} caption="In cloud" />
                <StatCard value={String(totals.pendingCount)} caption="In queue" />
              </View>
              <View style={[styles.statGrid, styles.gridSecond]}>
                <StatCard value={String(totals.archived)} caption="Archived" />
                <StatCard value={String(totals.trashed)} caption="Trash" />
                <StatCard value={String(totals.hidden)} caption="Hidden" />
                <StatCard value={String(totals.failedCount)} caption="Failed" />
              </View>
              <Text style={styles.chartTitle}>Last 6 months</Text>
              <View style={styles.chart}>
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
                    <Text style={styles.barLabel}>{b.label}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </Section>

        <Section title="Backup preferences">
          <View style={styles.qualityRow}>
            <Text style={styles.rowLabel}>Upload quality</Text>
            <View style={styles.qualityChips}>
              {(["storage_saver", "original"] as UploadQuality[]).map((q) => (
                <Pressable
                  key={q}
                  onPress={() => setUploadQuality(q)}
                  style={[styles.qualityChip, uploadQuality === q && styles.qualityChipActive]}
                >
                  <Text
                    style={[
                      styles.qualityChipText,
                      uploadQuality === q && styles.qualityChipTextActive,
                    ]}
                  >
                    {q === "original" ? "Original" : "Storage saver"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.rowSub}>
              {uploadQuality === "original"
                ? "Upload files exactly as they are"
                : "Photos larger than 2048px are recompressed (~85% quality). Videos always stay original."}
            </Text>
          </View>
          <ToggleRow
            label="Preserve EXIF metadata"
            sub="Keep date, camera and GPS data when uploading"
            value={exifPreserve}
            onChange={setExifPreserve}
          />
          <ToggleRow
            label="Upload on Wi-Fi only"
            sub="Queue uploads until a Wi-Fi connection is available"
            value={wifiOnlyUpload}
            onChange={setWifiOnlyUpload}
          />
          <ToggleRow
            label="Upload only while charging"
            value={chargeOnlyUpload}
            onChange={setChargeOnlyUpload}
          />
        </Section>

        <Section title="Device storage">
          <View style={styles.row}>
            <View style={styles.toggleText}>
              <Text style={styles.rowLabel}>Free up device space</Text>
              <Text style={styles.rowSub}>
                {freeable.count > 0
                  ? `${formatBytes(freeable.bytes)} of originals safely backed up — remove local copies`
                  : "Nothing to free yet. Originals appear here once backed up."}
              </Text>
            </View>
            <Pressable
              disabled={freeing || freeable.count === 0}
              onPress={() => {
                Alert.alert(
                  "Free up space?",
                  `Remove ${formatBytes(freeable.bytes)} of local originals? They stay safe in your Telegram cloud; thumbnails remain on device.`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () => {
                        setFreeing(true);
                        void freeUpDeviceSpace()
                          .then((r) => {
                            setFreeable({ count: 0, bytes: 0 });
                            void load();
                          })
                          .finally(() => setFreeing(false));
                      },
                    },
                  ]
                );
              }}
              style={[styles.freeBtn, (freeing || freeable.count === 0) && styles.btnDisabledStyle]}
            >
              <Text style={styles.freeBtnText}>{freeing ? "Removing…" : "Remove"}</Text>
            </Pressable>
          </View>
          {restorable.length > 0 ? (
            <View style={styles.row}>
              <View style={styles.toggleText}>
                <Text style={styles.rowLabel}>Restore missing originals</Text>
                <Text style={styles.rowSub}>
                  {restoringText ??
                    `${restorable.length} item${restorable.length === 1 ? "" : "s"} (${formatBytes(
                      restorable.reduce((s, r) => s + (r.byte_size || 0), 0)
                    )}) live in your Telegram cloud but not on this device.`}
                </Text>
              </View>
              <Pressable
                disabled={!!restoringText}
                onPress={restoreAll}
                style={[styles.freeBtn, restoringText && styles.btnDisabledStyle]}
              >
                <Text style={styles.freeBtnText}>Restore</Text>
              </Pressable>
            </View>
          ) : null}
        </Section>

        <Section title="Privacy">
          <ToggleRow
            label="Biometric lock for Hidden"
            sub={
              bioInfo && !(bioInfo.hardware && bioInfo.enrolled)
                ? "Requires fingerprint or face enrolled in device settings"
                : "Ask for fingerprint or face before opening Hidden photos"
            }
            disabled={!bioInfo || !bioInfo.hardware || !bioInfo.enrolled}
            value={hiddenLockEnabled}
            onChange={setHiddenLockEnabled}
          />
        </Section>

        <Section title="Uploads">
          {uploadActive ? (
            <View style={styles.uploadCard}>
              <Text style={styles.uploadName} numberOfLines={1}>
                {uploadActive.fileName}
              </Text>
              <View style={styles.uploadBarTrack}>
                <View
                  style={[
                    styles.uploadBarFill,
                    {
                      width: `${uploadActive.byteSize > 0 ? Math.max(4, (uploadActive.uploadedBytes / uploadActive.byteSize) * 100) : 6}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.uploadMeta}>
                {formatBytes(uploadActive.uploadedBytes)} / {formatBytes(uploadActive.byteSize)}
              </Text>
            </View>
          ) : (
            <Row label="No active upload" sub={uploadPaused ? "Uploads are paused" : "Queue is idle"} muted />
          )}
          <View style={styles.queueStats}>
            <StatCard value={String(uploadPending)} caption="Queued" />
            <StatCard value={String(uploadDone)} caption="Uploaded" />
            <StatCard value={String(uploadFailed)} caption="Failed" />
            <StatCard value={formatBytes(sessionBytes)} caption="This session" />
          </View>
          <Pressable
            style={({ pressed }) => [styles.pauseBtn, pressed && styles.pressed]}
            android_ripple={{ color: theme.colors.outlineVariant }}
            onPress={() => void (uploadPaused ? resumeUploads() : pauseUploads())}
          >
            <Text style={styles.pauseText}>{uploadPaused ? "Resume uploads" : "Pause uploads"}</Text>
          </Pressable>
        </Section>

        <Text style={styles.footer}>Photogram 0.1.0 · Your cloud is your Telegram</Text>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Row({ label, sub, muted }: { label: string; sub?: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.muted]}>{label}</Text>
      {sub ? <Text style={[styles.rowSub, muted && styles.muted]}>{sub}</Text> : null}
    </View>
  );
}

function ToggleRow(props: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.toggleText}>
        <Text style={styles.rowLabel}>{props.label}</Text>
        {props.sub ? <Text style={styles.rowSub}>{props.sub}</Text> : null}
      </View>
      <Switch
        value={props.value}
        onValueChange={props.onChange}
        disabled={props.disabled}
        trackColor={{ false: theme.colors.outline, true: theme.colors.primaryContainer }}
        thumbColor={props.value ? theme.colors.primary : "#8E8E93"}
      />
    </View>
  );
}

function StatCard({ value, caption }: { value: string; caption: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statCaption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { padding: theme.spacing.md, paddingBottom: 48 },
  screenTitle: { color: theme.colors.onSurface, fontSize: 28, fontWeight: "700", marginBottom: theme.spacing.md },
  section: { marginBottom: theme.spacing.lg },
  sectionTitle: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginLeft: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  sectionCard: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 14,
    gap: theme.spacing.md,
  },
  toggleText: { flex: 1, paddingRight: theme.spacing.sm },
  rowLabel: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "500" },
  rowSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  muted: { opacity: 0.6 },
  logoutBtn: {
    marginHorizontal: theme.spacing.md,
    marginTop: 4,
    marginBottom: theme.spacing.md,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    paddingVertical: 10,
    alignItems: "center",
  },
  logoutText: { color: theme.colors.error, fontWeight: "600", fontSize: 14 },
  pressed: { opacity: 0.85 },
  uploadCard: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    gap: 8,
  },
  uploadName: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "600" },
  uploadBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.surfaceHighest,
    overflow: "hidden",
  },
  uploadBarFill: { height: "100%", backgroundColor: theme.colors.primary, borderRadius: 4 },
  uploadMeta: { color: theme.colors.onSurfaceVariant, fontSize: 12 },
  queueStats: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  pauseBtn: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    paddingVertical: 10,
    alignItems: "center",
  },
  pauseText: { color: theme.colors.onSurface, fontWeight: "600", fontSize: 14 },
  qualityRow: { paddingHorizontal: theme.spacing.md, paddingVertical: 14 },
  qualityChips: { flexDirection: "row", gap: theme.spacing.sm, marginTop: 10, marginBottom: 8 },
  qualityChip: {
    flex: 1,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    paddingVertical: 9,
    alignItems: "center",
  },
  qualityChipActive: { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary },
  qualityChipText: { color: theme.colors.onSurfaceVariant, fontSize: 13, fontWeight: "600" },
  qualityChipTextActive: { color: theme.colors.onPrimaryContainer },
  freeBtn: {
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  freeBtnText: { color: theme.colors.onPrimary, fontWeight: "700", fontSize: 13 },
  btnDisabledStyle: { opacity: 0.45 },
  statGrid: { flexDirection: "row", gap: theme.spacing.sm, padding: theme.spacing.md, paddingBottom: 0 },
  gridSecond: { paddingBottom: theme.spacing.md, paddingTop: theme.spacing.sm },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  statValue: { color: theme.colors.onSurface, fontSize: 17, fontWeight: "700" },
  statCaption: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: 2 },
  chartTitle: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12.5,
    marginTop: theme.spacing.sm,
    marginBottom: 4,
    marginHorizontal: theme.spacing.md,
  },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    height: 96,
    gap: theme.spacing.sm,
  },
  chartCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  barWrap: { flex: 1, width: "100%", alignItems: "center", justifyContent: "flex-end" },
  bar: {
    width: "62%",
    maxHeight: 72,
    backgroundColor: theme.colors.primary,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  barLabel: { color: theme.colors.onSurfaceVariant, fontSize: 10.5, marginTop: 6 },
  footer: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12,
    textAlign: "center",
    opacity: 0.7,
    marginTop: theme.spacing.sm,
  },
});
