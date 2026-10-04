import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getSafetyReport, SafetyReport } from "../db/queries";
import { formatBytes } from "../lib/stats";
import { IntegrityReport, loadIntegrityReport, runIntegrityPass } from "../lib/integrity";
import { theme } from "../theme";

const STATE_LABEL: Record<string, string> = {
  local: "Not backed up yet",
  queued: "Waiting in queue",
  uploading: "Uploading…",
  failed: "Upload failed — tap ⟳ in gallery to retry",
};

// Idea 7: answers "if I drop my phone in a river tomorrow, what do I lose?"
// One screen: what's safe, what's only in Telegram, what still needs backing up.
// v0.30 adds the backup integrity check: actually asks Telegram whether each
// synced item's message still exists ("N verified / M broken").
export function SafetyCheckScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Tabs: undefined; Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [report, setReport] = useState<SafetyReport | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const cancelRef = useRef({ cancelled: false });

  const reload = useCallback(() => {
    void getSafetyReport()
      .then(setReport)
      .catch(() => setReport(null));
    void loadIntegrityReport()
      .then(setIntegrity)
      .catch(() => setIntegrity(null));
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", reload);
    return unsub;
  }, [navigation, reload]);

  const runIntegrity = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    cancelRef.current = { cancelled: false };
    try {
      // One pass handles a bounded batch; keep starting passes until the
      // whole library has been walked (finishedAt set) or the owner cancels.
      for (;;) {
        const result = await runIntegrityPass(setIntegrity, cancelRef.current);
        setIntegrity(result);
        if (result.finishedAt !== null || cancelRef.current.cancelled) break;
      }
    } finally {
      setChecking(false);
    }
  }, [checking]);

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

          <View style={styles.integrityCard}>
            <View style={styles.integrityHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.integrityTitle}>Backup integrity</Text>
                <Text style={styles.integritySub}>
                  {integrity === null
                    ? "Asks Telegram whether every backed-up photo still exists."
                    : integrity.stoppedReason
                    ? `Paused: ${integrity.stoppedReason} — run again to continue.`
                    : integrity.finishedAt !== null
                    ? `Last checked ${new Date(integrity.finishedAt).toLocaleString()}: ${integrity.verified} verified / ${integrity.broken} broken`
                    : `${integrity.verified + integrity.broken} checked so far (${integrity.verified} verified / ${integrity.broken} broken) — run again to continue`}
                </Text>
              </View>
              <Pressable style={[styles.runBtn, checking && styles.btnDisabled]} onPress={() => void runIntegrity()} disabled={checking}>
                <Text style={styles.runBtnText}>{checking ? "Checking…" : integrity ? "Run again" : "Run check"}</Text>
              </Pressable>
              {checking ? (
                <Pressable
                  style={styles.runBtn}
                  onPress={() => {
                    cancelRef.current.cancelled = true;
                  }}
                >
                  <Text style={styles.runBtnText}>Stop</Text>
                </Pressable>
              ) : null}
            </View>
            {integrity !== null && integrity.rows.length > 0 ? (
              <>
                <Text style={styles.integrityBrokenTitle}>
                  {integrity.broken} item{integrity.broken === 1 ? "" : "s"} no longer exist
                  {integrity.broken === 1 ? "s" : ""} in Telegram:
                </Text>
                {integrity.rows.slice(0, 5).map((row) => (
                  <Pressable
                    key={String(row.id)}
                    style={styles.brokenRow}
                    onPress={() => navigation.navigate("Viewer", { ids: integrity.rows.map((r) => r.id), index: integrity.rows.findIndex((r) => r.id === row.id) })}
                  >
                    <Image source={{ uri: row.thumb_uri }} style={styles.brokenThumb} contentFit="cover" recyclingKey={`int-${row.id}`} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {row.file_name}
                      </Text>
                      <Text style={styles.rowFailed} numberOfLines={1}>
                        {row.reason}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                {integrity.rows.length > 5 ? (
                  <Text style={styles.integritySub}>…and {integrity.rows.length - 5} more.</Text>
                ) : null}
              </>
            ) : null}
          </View>

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
  integrityCard: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  integrityHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  integrityTitle: { color: theme.colors.onSurface, fontSize: 14.5, fontWeight: "700" },
  integritySub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  integrityBrokenTitle: {
    color: theme.colors.error,
    fontSize: 12.5,
    fontWeight: "600",
    marginTop: theme.spacing.sm,
    marginBottom: 4,
  },
  runBtn: {
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnDisabled: { opacity: 0.5 },
  runBtnText: { color: theme.colors.onPrimaryContainer, fontWeight: "700", fontSize: 12 },
  brokenRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 6 },
  brokenThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: theme.colors.surfaceHighest },
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
