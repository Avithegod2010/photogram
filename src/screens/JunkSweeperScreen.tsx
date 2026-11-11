import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  JunkFindingWithMedia,
  JunkCategory,
  listFindingsByStatus,
  setFindingStatus,
} from "../db/queries";
import {
  JunkScope,
  SweepSummary,
  deleteJunkFindings,
  isDeletable,
  runSweep,
} from "../lib/junk";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  Section,
  Skeleton,
  StatusBadge,
  alertDialog,
  confirmDialog,
} from "../ui";

// F2 Junk Sweeper review screen. Every pending finding is pre-selected;
// unselecting one records it as "kept" on confirm so the sweeper never
// re-suggests it. The owner picks a delete scope per sweep:
//  - Local only: delete the device file; the Telegram copy stays as the undo.
//  - Telegram only: delete the Telegram message; the local file stays.
//  - Both: delete file and message (nothing left — asked twice via confirm).
const SCOPE_LABEL: Record<JunkScope, string> = {
  local: "Local only",
  telegram: "Telegram only",
  both: "Both",
};

const CATEGORY_LABEL: Record<JunkCategory, string> = {
  blurry: "Blurry",
  pocket: "Pocket shots",
  near_duplicate: "Near duplicates",
  stale_screenshot: "Old screenshots",
};

const CATEGORY_NOTE: Record<JunkCategory, string> = {
  blurry: "Out-of-focus shots the camera didn't get right.",
  pocket: "Accidental frames — lens covered, pocket fire.",
  near_duplicate: "Near-identical frames from the same day; the largest copy is kept.",
  stale_screenshot: "Screenshots older than 90 days.",
};

function scopeSentence(scope: JunkScope, count: number, bytes: number): string {
  const items = `${count} item${count === 1 ? "" : "s"} (${formatBytes(bytes)})`;
  switch (scope) {
    case "local":
      return `Remove the local copies of ${items} from this phone? Each one stays safe in your Telegram cloud — you can restore it anytime.`;
    case "telegram":
      return `Delete the Telegram copies of ${items}? The files stay on this phone, but the cloud backup will be gone with no undo.`;
    case "both":
      return `Delete ${items} everywhere — from this phone AND from Telegram? This cannot be undone; the photos will be gone for good.`;
  }
}

interface DisplayFinding extends JunkFindingWithMedia {
  selected: boolean;
  deletable: boolean;
}

export function JunkSweeperScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Tabs: undefined }>;
}) {
  const insets = useSafeAreaInsets();
  const [findings, setFindings] = useState<DisplayFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState<string | null>(null);
  const [scope, setScope] = useState<JunkScope>("local");
  const [deleting, setDeleting] = useState(false);
  const [deleteDone, setDeleteDone] = useState<string | null>(null);
  const cancelRef = useRef({ cancelled: false });

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await listFindingsByStatus("pending");
      setFindings(
        rows.map((row) => ({
          ...row,
          selected: true,
          deletable: isDeletable(row, scope),
        }))
      );
    } catch {
      setFindings([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Re-evaluate deletability when the scope changes (Telegram-only scope can
  // delete rows without a local file; local scopes cannot).
  useEffect(() => {
    setFindings((prev) =>
      prev.map((row) => ({ ...row, deletable: isDeletable(row, scope) }))
    );
  }, [scope]);

  const toggle = useCallback((finding: DisplayFinding) => {
    if (!finding.deletable) return;
    setFindings((prev) =>
      prev.map((row) =>
        row.id === finding.id ? { ...row, selected: !row.selected } : row
      )
    );
  }, []);

  const setCategoryAll = useCallback((category: JunkCategory, selected: boolean) => {
    setFindings((prev) =>
      prev.map((row) =>
        row.category === category && row.deletable ? { ...row, selected } : row
      )
    );
  }, []);

  const categories = useMemo(() => {
    const map = new Map<JunkCategory, DisplayFinding[]>();
    for (const row of findings) {
      const list = map.get(row.category) ?? [];
      list.push(row);
      map.set(row.category, list);
    }
    return Array.from(map.entries());
  }, [findings]);

  const selected = useMemo(
    () => findings.filter((row) => row.selected && row.deletable),
    [findings]
  );
  const selectedBytes = selected.reduce((sum, row) => sum + (row.byte_size || 0), 0);

  const startSweep = useCallback(() => {
    if (sweeping) {
      // Hard cancel: the sweep stops at the next item boundary and saves its
      // resume cursor, so the next "Sweep now" continues where this left off.
      cancelRef.current.cancelled = true;
      setSweepNote("Stopping sweep…");
      return;
    }
    setSweeping(true);
    setSweepNote("Sweeping…");
    setDeleteDone(null);
    cancelRef.current = { cancelled: false };
    void (async () => {
      const summary: SweepSummary | null = await runSweep(
        (progress) => setSweepNote(`Sweeping… ${progress.scanned} photos checked`),
        cancelRef.current
      );
      setSweeping(false);
      if (summary === null) {
        setSweepNote(null);
        void alertDialog({
          title: "Junk sweeper is off",
          message:
            "Turn on the Junk sweeper toggle in Settings to let Photogram scan for junk.",
        });
        return;
      }
      const total =
        summary.findingsByCategory.blurry.count +
        summary.findingsByCategory.pocket.count +
        summary.findingsByCategory.near_duplicate.count +
        summary.findingsByCategory.stale_screenshot.count;
      setSweepNote(
        summary.done
          ? total > 0
            ? `Sweep finished — ${total} junk item${total === 1 ? "" : "s"} found.`
            : "Sweep finished — no junk found."
          : `Sweep stopped at ${summary.scanned} photos — press Sweep now to continue.`
      );
      await reload();
    })();
  }, [sweeping, reload]);

  const confirmDelete = useCallback(() => {
    if (selected.length === 0 || deleting) return;
    const count = selected.length;
    const bytes = selectedBytes;
    void confirmDialog({
      title: scope === "both" ? "Delete everywhere?" : `Delete (${SCOPE_LABEL[scope]})?`,
      message: scopeSentence(scope, count, bytes),
      confirmLabel: t("common.delete"),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setDeleting(true);
      setDeleteDone(null);
      void (async () => {
        const outcome = await deleteJunkFindings(selected, scope, (deleted) =>
          setDeleteDone(`Deleting… ${deleted}/${count}`)
        );
        setDeleting(false);
        setDeleteDone(
          outcome.failed > 0
            ? `Deleted ${outcome.deleted}, ${outcome.failed} failed (try again or free up space via system dialog).`
            : `Deleted ${outcome.deleted} item${outcome.deleted === 1 ? "" : "s"}.`
        );
        // Unselected items were never touched: record them as "kept" so
        // the sweeper never re-suggests them.
        for (const item of findings) {
          if (!item.selected && item.deletable) {
            try {
              await setFindingStatus(item.id, "kept");
            } catch {}
          }
        }
        await reload();
      })();
    });
  }, [selected, selectedBytes, deleting, scope, findings, reload]);

  const keptNote =
    findings.some((row) => !row.deletable) && scope !== "telegram"
      ? "Items marked “Local only”, “Queued” or “Uploading” can't be deleted until their upload finishes."
      : null;

  const scopeNote =
    scope === "local"
      ? "Local files are removed; Telegram keeps the originals as the undo."
      : scope === "telegram"
        ? "Telegram messages are deleted; files stay on this phone. No undo copy remains."
        : "Files are removed from this phone AND from Telegram. This cannot be undone.";

  return (
    <Screen>
      <AppBar
        title="Junk sweeper"
        subtitle={
          loading
            ? t("state.loading")
            : findings.length > 0
              ? `${findings.length} findings · ${selected.length} selected`
              : "Review blurry, accidental and duplicate shots"
        }
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
        actions={
          <Button
            label={sweeping ? "Stop sweep" : "Sweep now"}
            variant="secondary"
            size="sm"
            icon={sweeping ? "stop-circle-outline" : "scan-outline"}
            onPress={startSweep}
            disabled={deleting}
          />
        }
      />

      {sweeping || deleteDone !== null || sweepNote !== null ? (
        <View style={styles.statusStrip}>
          <AppText
            variant="footnote"
            color={theme.colors.onSurfaceVariant}
            accessibilityLiveRegion="polite"
          >
            {sweeping ? sweepNote ?? "Sweeping…" : deleteDone ?? sweepNote}
          </AppText>
        </View>
      ) : null}

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="The junk findings could not be read. Your photos are untouched."
          retryLabel={t("common.retry")}
          onRetry={() => void reload()}
        />
      ) : loading ? (
        <FindingsSkeleton />
      ) : findings.length === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title="No junk found"
          body="Run a sweep first. Photogram looks at thumbnails on this phone only — nothing is deleted without your review."
          actionLabel="Sweep now"
          onAction={startSweep}
        />
      ) : (
        <>
          <Section
            title="Delete from where?"
            card={false}
            footer={scopeNote}
            style={styles.scopeSection}
          >
            <View style={styles.chipRow}>
              {(["local", "telegram", "both"] as JunkScope[]).map((s) => (
                <Chip
                  key={s}
                  label={SCOPE_LABEL[s]}
                  selected={scope === s}
                  onPress={() => setScope(s)}
                  accessibilityLabel={`Delete from: ${SCOPE_LABEL[s]}`}
                />
              ))}
            </View>
          </Section>

          <View style={styles.fill}>
            <FlashList
              style={styles.fill}
              data={categories}
              keyExtractor={([category]) => category}
              renderItem={({ item: [category, rows] }) => {
                const deletableRows = rows.filter((r) => r.deletable);
                const allSelected =
                  deletableRows.length > 0 && deletableRows.every((r) => r.selected);
                const categoryBytes = rows.reduce(
                  (sum, r) => sum + (r.byte_size || 0),
                  0
                );
                return (
                  <Section
                    title={`${CATEGORY_LABEL[category]} · ${rows.length}`}
                    subtitle={`${formatBytes(categoryBytes)} · ${CATEGORY_NOTE[category]}`}
                    action={
                      <Button
                        label={allSelected ? "Deselect all" : "Select all"}
                        variant="ghost"
                        size="sm"
                        disabled={deletableRows.length === 0}
                        onPress={() => setCategoryAll(category, !allSelected)}
                        accessibilityLabel={`${
                          allSelected ? "Deselect all" : "Select all"
                        } ${CATEGORY_LABEL[category]}`}
                      />
                    }
                    style={styles.categorySection}
                  >
                    {rows.map((row) => (
                      <FindingRow key={row.id} row={row} onToggle={() => toggle(row)} />
                    ))}
                  </Section>
                );
              }}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={
                keptNote ? (
                  <AppText
                    variant="footnote"
                    color={theme.colors.onSurfaceVariant}
                    style={styles.footerNote}
                  >
                    {keptNote}
                  </AppText>
                ) : null
              }
            />
          </View>
        </>
      )}

      {!loading && !loadError && findings.length > 0 ? (
        <View
          style={[
            styles.bottomBar,
            { paddingBottom: insets.bottom + theme.spacing.compact },
          ]}
        >
          <Button
            label={
              deleting
                ? deleteDone ?? "Deleting…"
                : `Delete ${selected.length} item${
                    selected.length === 1 ? "" : "s"
                  } (${formatBytes(selectedBytes)})`
            }
            variant="danger"
            size="lg"
            icon="trash-outline"
            fullWidth
            disabled={deleting || selected.length === 0}
            loading={deleting && deleteDone === null}
            onPress={confirmDelete}
            accessibilityHint="Shows a confirmation before anything is deleted."
          />
          {selected.length > 0 && !deleting ? (
            <AppText
              variant="caption2Regular"
              color={theme.colors.onSurfaceVariant}
              align="center"
            >
              Unselected items are kept — the sweeper won't suggest them again.
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function FindingRow({ row, onToggle }: { row: DisplayFinding; onToggle: () => void }) {
  return (
    <ListRow
      title={row.file_name ?? "Untitled"}
      subtitle={`${formatBytes(row.byte_size)}${
        row.detail ? ` · ${row.detail}` : ""
      }`}
      leading={
        <Image
          source={{ uri: row.thumb_uri }}
          style={styles.thumb}
          contentFit="cover"
          recyclingKey={`junk-${row.id}`}
          accessible={false}
        />
      }
      trailing={row.deletable ? undefined : <StatusBadge status={row.state} />}
      accessory="check"
      selected={row.selected && row.deletable}
      disabled={!row.deletable}
      onPress={onToggle}
      accessibilityLabel={`${row.file_name ?? "Untitled"}, ${formatBytes(
        row.byte_size
      )}${row.deletable ? "" : ", cannot be deleted yet"}`}
      accessibilityHint={
        row.deletable ? "Toggles whether this item is deleted." : undefined
      }
    />
  );
}

function FindingsSkeleton() {
  return (
    <View
      style={styles.skeletonRoot}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading junk findings"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton width={52} height={52} radius={theme.radius.control} />
          <View style={styles.skeletonText}>
            <Skeleton width="75%" height={14} />
            <Skeleton width="45%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  statusStrip: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  scopeSection: { marginBottom: theme.spacing.compact },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  categorySection: { marginBottom: theme.spacing.compact },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surfaceHighest,
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 200,
  },
  footerNote: {
    paddingTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceContainer,
    ...theme.elevation.floating,
  },
  skeletonRoot: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  skeletonText: { flex: 1, gap: theme.spacing.sm },
});
