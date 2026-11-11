import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getSafetyReport, SafetyReport, clearRemotePointers } from "../db/queries";
import { enqueueForUpload } from "../lib/uploader";
import { formatBytes } from "../lib/stats";
import { IntegrityReport, loadIntegrityReport, runIntegrityPass } from "../lib/integrity";
import type { IntegritySchedule } from "../lib/integritySchedule";
import { useSettingsStore } from "../store/settingsStore";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  Section,
  Skeleton,
  Stat,
  StatusBadge,
  alertDialog,
  confirmDialog,
  type BadgeTone,
} from "../ui";

const SCHEDULE_LABEL: Record<IntegritySchedule, string> = {
  off: "Off",
  weekly: "Weekly",
  monthly: "Monthly",
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
  const schedule = useSettingsStore((s) => s.integritySchedule);
  const setSchedule = useSettingsStore((s) => s.setIntegritySchedule);
  const [report, setReport] = useState<SafetyReport | null>(null);
  const [reportError, setReportError] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [reuploading, setReuploading] = useState(false);
  const cancelRef = useRef({ cancelled: false });

  const reload = useCallback(() => {
    void getSafetyReport()
      .then((r) => {
        setReport(r);
        setReportError(false);
      })
      .catch(() => {
        setReport(null);
        setReportError(true);
      });
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

  // v0.55: the integrity walk proved these messages are gone. The files are
  // still on the phone, so one tap puts them back in the upload queue with
  // fresh remote pointers.
  const reuploadMissing = useCallback(() => {
    const rows = integrity?.rows ?? [];
    if (rows.length === 0 || reuploading) return;
    void confirmDialog({
      title: "Re-upload missing items?",
      message: `${rows.length} item${rows.length === 1 ? "" : "s"} will be sent to Telegram again. Items whose local file is gone will be skipped.`,
      confirmLabel: "Re-upload",
    }).then((ok) => {
      if (!ok) return;
      setReuploading(true);
      void (async () => {
        let queued = 0;
        let skipped = 0;
        try {
          await clearRemotePointers(rows.map((r) => r.id));
          for (const row of rows) {
            try {
              await enqueueForUpload(row.id);
              queued++;
            } catch {
              skipped++;
            }
          }
        } catch {
          // a failure here must not hide what already got queued
        } finally {
          setReuploading(false);
          reload();
        }
        void alertDialog({
          title: "Re-upload",
          message:
            skipped === 0
              ? `${queued} item${queued === 1 ? "" : "s"} queued. The backup will send them again.`
              : `${queued} queued, ${skipped} skipped (no local file left).`,
        });
      })();
    });
  }, [integrity, reuploading, reload]);

  const allSafe =
    report !== null && report.pendingCount === 0 && report.failedCount === 0;

  const notSafeCount = report ? report.pendingCount + report.failedCount : 0;
  const verdictTone: BadgeTone = allSafe
    ? "success"
    : report && report.failedCount > 0
      ? "error"
      : "warning";

  const integrityStatus =
    integrity === null
      ? "Ask Telegram now, or pick a schedule above."
      : integrity.stoppedReason
        ? `Paused: ${integrity.stoppedReason} — run again to continue.`
        : integrity.finishedAt !== null
          ? `Last checked ${new Date(integrity.finishedAt).toLocaleString()}: ${
              integrity.verified
            } verified / ${integrity.broken} broken`
          : `${integrity.verified + integrity.broken} checked so far (${
              integrity.verified
            } verified / ${integrity.broken} broken) — run again to continue`;

  return (
    <Screen>
      <AppBar
        title="Safety check"
        subtitle="What exists only on this phone?"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {reportError ? (
        <ErrorState
          title={t("state.error")}
          body="The safety report could not be read. Your photos and your Telegram backup are untouched."
          retryLabel={t("common.retry")}
          onRetry={reload}
        />
      ) : report === null ? (
        <SafetySkeleton />
      ) : (
        <FlashList
          style={styles.fill}
          data={report.attention}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.headerWrap}>
              <Section
                title="Verdict"
                icon={allSafe ? "shield-checkmark-outline" : "warning-outline"}
                danger={report.failedCount > 0}
                footer="Covers your own library. Family photos in shared albums are never auto-deleted and stay safe in the group."
              >
                <View style={styles.verdictBlock}>
                  <Badge
                    label={allSafe ? "All safe" : "Needs attention"}
                    tone={verdictTone}
                    icon={allSafe ? "checkmark-circle-outline" : "alert-circle-outline"}
                  />
                  <AppText variant="title2">
                    {allSafe
                      ? `Everything is safe${
                          report.cloudOnlyCount > 0
                            ? " (some items are cloud-only by choice)"
                            : ""
                        }`
                      : `${notSafeCount} item${notSafeCount === 1 ? "" : "s"} not yet safe in Telegram`}
                  </AppText>
                  <AppText variant="body" color={theme.colors.onSurfaceVariant}>
                    {report.bytesWaiting > 0
                      ? `${formatBytes(report.bytesWaiting)} exist only on this phone.`
                      : "Nothing exists only on this phone."}
                  </AppText>
                </View>
                <View style={styles.statRow}>
                  <Stat value={(report.safeCount).toLocaleString()} label="Safe (local + cloud)" />
                  <Stat value={(report.cloudOnlyCount).toLocaleString()} label="Cloud-only (freed)" />
                  <Stat value={(report.pendingCount).toLocaleString()} label="Waiting" />
                  <Stat
                    value={(report.failedCount).toLocaleString()}
                    label="Failed"
                    tone={report.failedCount > 0 ? theme.colors.error : undefined}
                  />
                </View>
              </Section>

              <Section
                title="Backup integrity"
                icon="shield-half-outline"
                subtitle={
                  schedule !== "off"
                    ? `Auto-check ${SCHEDULE_LABEL[schedule].toLowerCase()} — re-verifies the whole library and re-checks anything Telegram says is missing.`
                    : "Asks Telegram whether every backed-up photo still exists."
                }
              >
                <View style={styles.chipRow}>
                  {(["off", "weekly", "monthly"] as IntegritySchedule[]).map((s) => (
                    <Chip
                      key={s}
                      label={SCHEDULE_LABEL[s]}
                      selected={schedule === s}
                      onPress={() => setSchedule(s)}
                      accessibilityLabel={`Integrity check schedule: ${SCHEDULE_LABEL[s]}`}
                    />
                  ))}
                </View>
                <View style={styles.integrityBlock}>
                  <AppText
                    variant="footnote"
                    color={theme.colors.onSurfaceVariant}
                    accessibilityLiveRegion="polite"
                  >
                    {integrityStatus}
                  </AppText>
                  <View style={styles.buttonRow}>
                    <Button
                      label={integrity ? "Run again" : "Run check"}
                      size="sm"
                      variant="secondary"
                      icon="refresh"
                      disabled={checking}
                      loading={checking}
                      onPress={() => void runIntegrity()}
                      accessibilityHint="Asks Telegram whether each backed-up photo still exists."
                    />
                    {checking ? (
                      <Button
                        label="Stop"
                        size="sm"
                        variant="secondary"
                        icon="stop-circle-outline"
                        onPress={() => {
                          cancelRef.current.cancelled = true;
                        }}
                      />
                    ) : null}
                  </View>
                </View>

                {integrity !== null && integrity.rows.length > 0 ? (
                  <>
                    <View style={styles.brokenHead}>
                      <AppText variant="callout" color={theme.colors.error}>
                        {integrity.broken} item{integrity.broken === 1 ? "" : "s"} no longer exist
                        {integrity.broken === 1 ? "s" : ""} in Telegram:
                      </AppText>
                    </View>
                    {integrity.rows.slice(0, 5).map((row) => (
                      <ListRow
                        key={String(row.id)}
                        title={row.file_name}
                        subtitle={row.reason}
                        leading={
                          <Image
                            source={{ uri: row.thumb_uri }}
                            style={styles.brokenThumb}
                            contentFit="cover"
                            recyclingKey={`int-${row.id}`}
                            accessible={false}
                          />
                        }
                        accessory="chevron"
                        onPress={() =>
                          navigation.navigate("Viewer", {
                            ids: integrity.rows.map((r) => r.id),
                            index: integrity.rows.findIndex((r) => r.id === row.id),
                          })
                        }
                        accessibilityLabel={`${row.file_name}, missing from Telegram. ${row.reason}`}
                        accessibilityHint="Opens this photo in the viewer."
                      />
                    ))}
                    {integrity.rows.length > 5 ? (
                      <View style={styles.brokenHead}>
                        <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
                          …and {integrity.rows.length - 5} more.
                        </AppText>
                      </View>
                    ) : null}
                    <View style={styles.reuploadBlock}>
                      <Button
                        label={
                          reuploading
                            ? "Queueing…"
                            : `Re-upload ${integrity.rows.length} missing item${
                                integrity.rows.length === 1 ? "" : "s"
                              }`
                        }
                        variant="secondary"
                        icon="cloud-upload-outline"
                        fullWidth
                        disabled={reuploading}
                        loading={reuploading}
                        onPress={reuploadMissing}
                      />
                    </View>
                  </>
                ) : null}
              </Section>

              <AppText variant="callout" color={theme.colors.onSurfaceVariant} style={styles.listHeading}>
                Needs attention
              </AppText>
              {report.failedCount > 0 ? (
                <AppText variant="footnote" color={theme.colors.onSurfaceVariant} style={styles.listNote}>
                  Failed uploads can be retried from the gallery — open the photo and tap ⟳.
                </AppText>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.file_name ?? "Untitled"}
              subtitle={formatBytes(item.byte_size)}
              leading={
                <Image
                  source={{ uri: item.thumb_uri }}
                  style={styles.thumb}
                  contentFit="cover"
                  recyclingKey={`sf-${item.id}`}
                  accessible={false}
                />
              }
              trailing={<StatusBadge status={item.state} />}
              style={styles.attentionRow}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              compact
              icon="checkmark-circle-outline"
              title={allSafe ? "Nothing needs attention" : "No single item is blocking"}
              body={
                allSafe
                  ? "Every photo on this phone also lives in your Telegram backup."
                  : "The counts above are the whole story — no individual item needs a tap."
              }
            />
          }
        />
      )}
    </Screen>
  );
}

function SafetySkeleton() {
  return (
    <View
      style={styles.skeletonRoot}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading the safety report"
    >
      <Skeleton width="100%" height={148} radius={theme.radius.card} />
      <View style={styles.skeletonStatRow}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} width="23%" height={64} radius={theme.radius.control} />
        ))}
      </View>
      <Skeleton width="100%" height={132} radius={theme.radius.card} />
      <Skeleton width="60%" height={16} />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} width="100%" height={64} radius={theme.radius.control} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingBottom: theme.spacing.xl },
  headerWrap: { paddingHorizontal: theme.spacing.md },
  verdictBlock: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
    alignItems: "flex-start",
  },
  statRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  integrityBlock: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  brokenHead: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  brokenThumb: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.thumb,
    backgroundColor: theme.colors.surfaceHighest,
  },
  reuploadBlock: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  listHeading: {
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  listNote: { marginBottom: theme.spacing.sm },
  attentionRow: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.control,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.thumb,
    backgroundColor: theme.colors.surfaceHighest,
  },
  skeletonRoot: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  skeletonStatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
