import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getSafetyReport, SafetyReport } from "../db/queries";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";

const STATE_LABEL: Record<string, string> = {
  local: "Not backed up yet",
  queued: "Waiting in queue",
  uploading: "Uploading…",
  failed: "Upload failed — tap ⟳ in gallery to retry",
};

// Idea 7: answers "if I drop my phone in a river tomorrow, what do I lose?"
// One screen: what's safe, what's only in Telegram, what still needs backing up.
export function SafetyCheckScreen({ navigation }: { navigation: NativeStackNavigationProp<{ Tabs: undefined }> }) {
  const insets = useSafeAreaInsets();
  const [report, setReport] = useState<SafetyReport | null>(null);

  const reload = useCallback(() => {
    void getSafetyReport()
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", reload);
    return unsub;
  }, [navigation, reload]);

  const allSafe =
    report !== null && report.pendingCount === 0 && report.failedCount === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Safety check</Text>
      </View>

      {report === null ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : (
        <>
          <View style={[styles.verdictCard, allSafe && styles.verdictSafe]}>
            <Text style={styles.verdictTitle}>
              {allSafe
                ? `Everything is safe${report.cloudOnlyCount > 0 ? " (some items are cloud-only by choice)" : ""}`
                : `${report.pendingCount + report.failedCount} item${
                    report.pendingCount + report.failedCount === 1 ? "" : "s"
                  } not yet safe in Telegram`}
            </Text>
            <Text style={styles.verdictSub}>
              {report.bytesWaiting > 0
                ? `${formatBytes(report.bytesWaiting) } exist only on this phone.`
                : "Nothing exists only on this phone."}
            </Text>
          </View>

          <View style={styles.statGrid}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{report.safeCount}</Text>
              <Text style={styles.statLabel}>Safe (local + cloud)</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{report.cloudOnlyCount}</Text>
              <Text style={styles.statLabel}>Cloud-only (freed)</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{report.pendingCount}</Text>
              <Text style={styles.statLabel}>Waiting</Text>
            </View>
            <View style={[styles.stat, report.failedCount > 0 && styles.statDanger]}>
              <Text style={styles.statValue}>{report.failedCount}</Text>
              <Text style={styles.statLabel}>Failed</Text>
            </View>
          </View>

          <Text style={styles.note}>
            Covers your own library. Family photos in shared albums are never auto-deleted and stay
            safe in the group.
          </Text>

          <FlashList
            data={report.attention}
            keyExtractor={(i) => String(i.id)}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Image source={{ uri: item.thumb_uri }} style={styles.thumb} contentFit="cover" recyclingKey={`sf-${item.id}`} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.file_name ?? "Untitled"}
                  </Text>
                  <Text style={[styles.rowState, item.state === "failed" && styles.rowFailed]}>
                    {STATE_LABEL[item.state] ?? item.state}
                  </Text>
                </View>
                <Text style={styles.rowSize}>{formatBytes(item.byte_size)}</Text>
              </View>
            )}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {allSafe ? "Nothing needs attention. 🎉" : "Loading items…"}
              </Text>
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 4,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  verdictCard: {
    margin: theme.spacing.md,
    backgroundColor: theme.colors.secondaryContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  verdictSafe: { backgroundColor: theme.colors.primaryContainer },
  verdictTitle: { color: theme.colors.onPrimaryContainer, fontSize: 15.5, fontWeight: "700" },
  verdictSub: { color: theme.colors.onPrimaryContainer, fontSize: 12.5, marginTop: 4 },
  statGrid: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    alignItems: "center",
  },
  statDanger: { backgroundColor: theme.colors.errorContainer },
  statValue: { color: theme.colors.onSurface, fontSize: 18, fontWeight: "800" },
  statLabel: { color: theme.colors.onSurfaceVariant, fontSize: 10, textAlign: "center", marginTop: 2 },
  note: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 11.5,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
  },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: theme.colors.surfaceHighest },
  rowName: { color: theme.colors.onSurface, fontSize: 13.5 },
  rowState: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: 2 },
  rowFailed: { color: theme.colors.error },
  rowSize: { color: theme.colors.onSurfaceVariant, fontSize: 12 },
  listContent: { paddingBottom: 40 },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 40 },
});
