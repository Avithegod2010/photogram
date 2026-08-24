import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { useSettingsStore } from "../store/settingsStore";
import { useAuthStore } from "../auth/authStore";
import { theme } from "../theme";

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [totals, setTotals] = useState<StorageTotals | null>(null);
  const [buckets, setBuckets] = useState<MonthBucket[]>([]);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [bioInfo, setBioInfo] = useState<{ hardware: boolean; enrolled: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const exifPreserve = useSettingsStore((s) => s.exifPreserve);
  const hiddenLockEnabled = useSettingsStore((s) => s.hiddenLockEnabled);
  const wifiOnlyUpload = useSettingsStore((s) => s.wifiOnlyUpload);
  const chargeOnlyUpload = useSettingsStore((s) => s.chargeOnlyUpload);
  const setExifPreserve = useSettingsStore((s) => s.setExifPreserve);
  const setHiddenLockEnabled = useSettingsStore((s) => s.setHiddenLockEnabled);
  const setWifiOnlyUpload = useSettingsStore((s) => s.setWifiOnlyUpload);
  const setChargeOnlyUpload = useSettingsStore((s) => s.setChargeOnlyUpload);
  const boot = useAuthStore((s) => s.boot);

  const load = useCallback(async () => {
    try {
      const [t, b] = await Promise.all([getStorageTotals(), getMonthlyBuckets()]);
      setTotals(t);
      setBuckets(b);
    } catch {
      setTotals(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      const p = await fetchProfile();
      if (!p) return;
      const name = `${(p.first_name as string) ?? ""} ${(p.last_name as string) ?? ""}`.trim();
      setProfileName(name || "Telegram user");
    })();
    void canUseBiometrics().then(setBioInfo);
  }, [load]);

  const maxBucketCount = Math.max(1, ...buckets.map((b) => b.count));

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
                <StatCard value={String(totals.photos)} caption="Photos" />
                <StatCard value={String(totals.videos)} caption="Videos" />
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
          <Row label="Upload queue" sub="Live progress dashboard arrives with the upload engine (Step 4)" muted />
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
