import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
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

const STATE_LABEL: Record<string, string> = {
  local: "Not yet backed up",
  queued: "Waiting in queue",
  uploading: "Uploading…",
  failed: "Upload failed",
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
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState<string | null>(null);
  const [scope, setScope] = useState<JunkScope>("local");
  const [deleting, setDeleting] = useState(false);
  const [deleteDone, setDeleteDone] = useState<string | null>(null);
  const cancelRef = useRef({ cancelled: false });

  const reload = useCallback(async () => {
    setLoading(true);
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
        Alert.alert(
          "Junk sweeper is off",
          "Turn on the Junk sweeper toggle in Settings to let Photogram scan for junk."
        );
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
    Alert.alert(
      scope === "both" ? "Delete everywhere?" : `Delete (${SCOPE_LABEL[scope]})?`,
      scopeSentence(scope, count, bytes),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
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
          },
        },
      ]
    );
  }, [selected, selectedBytes, deleting, scope, findings, reload]);

  const keptNote =
    findings.some((row) => !row.deletable) && scope !== "telegram"
      ? "Items marked “not yet backed up” can't be deleted until their upload finishes."
      : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Junk sweeper</Text>
        <Pressable
          onPress={startSweep}
          disabled={deleting}
          style={[styles.sweepBtn, deleting && styles.btnDisabled]}
        >
          <Text style={styles.sweepBtnText}>{sweeping ? "Cancel" : "Sweep now"}</Text>
        </Pressable>
      </View>

      {(sweeping || deleteDone !== null || sweepNote !== null) && (
        <Text style={styles.note}>
          {sweeping ? sweepNote ?? "Sweeping…" : deleteDone ?? sweepNote}
        </Text>
      )}

      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : findings.length === 0 ? (
        <Text style={styles.empty}>
          No junk found — run a sweep first.{"\n"}Photogram looks at thumbnails on this phone only;
          nothing is deleted without your review.
        </Text>
      ) : (
        <>
          <Text style={styles.scopeTitle}>Delete from where?</Text>
          <View style={styles.scopeRow}>
            {(["local", "telegram", "both"] as JunkScope[]).map((s) => (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                style={[styles.scopeChip, scope === s && styles.scopeChipActive]}
              >
                <Text
                  style={[
                    styles.scopeChipText,
                    scope === s && styles.scopeChipTextActive,
                  ]}
                >
                  {SCOPE_LABEL[s]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.scopeNote}>
            {scope === "local"
              ? "Local files are removed; Telegram keeps the originals as the undo."
              : scope === "telegram"
              ? "Telegram messages are deleted; files stay on this phone. No undo copy remains."
              : "Files are removed from this phone AND from Telegram. This cannot be undone."}
          </Text>
        </>
      )}

      <FlashList
        data={categories}
        keyExtractor={([category]) => category}
        renderItem={({ item: [category, rows] }) => {
          const deletableRows = rows.filter((r) => r.deletable);
          const allSelected = deletableRows.length > 0 && deletableRows.every((r) => r.selected);
          return (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>
                    {CATEGORY_LABEL[category]} · {rows.length}
                  </Text>
                  <Text style={styles.sectionSub}>
                    {formatBytes(rows.reduce((sum, r) => sum + (r.byte_size || 0), 0))} ·{" "}
                    {CATEGORY_NOTE[category]}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setCategoryAll(category, !allSelected)}
                  disabled={deletableRows.length === 0}
                  style={[styles.selectAllBtn, deletableRows.length === 0 && styles.btnDisabled]}
                >
                  <Text style={styles.selectAllText}>{allSelected ? "Deselect all" : "Select all"}</Text>
                </Pressable>
              </View>
              {rows.map((row) => (
                <FindingRow key={row.id} row={row} onToggle={() => toggle(row)} />
              ))}
            </View>
          );
        }}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={keptNote ? <Text style={styles.note}>{keptNote}</Text> : null}
      />

      {findings.length > 0 ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            onPress={confirmDelete}
            disabled={deleting || selected.length === 0}
            style={[styles.deleteBtn, (deleting || selected.length === 0) && styles.btnDisabled]}
          >
            <Text style={styles.deleteBtnText}>
              {deleting
                ? deleteDone ?? "Deleting…"
                : `Delete ${selected.length} item${selected.length === 1 ? "" : "s"} (${formatBytes(selectedBytes)})`}
            </Text>
          </Pressable>
          {selected.length > 0 && !deleting ? (
            <Text style={styles.bottomHint}>
              Unselected items are kept — the sweeper won't suggest them again.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function FindingRow({ row, onToggle }: { row: DisplayFinding; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={!row.deletable}
      style={[styles.row, !row.deletable && styles.rowDisabled]}
    >
      <Image
        source={{ uri: row.thumb_uri }}
        style={styles.thumb}
        contentFit="cover"
        recyclingKey={`junk-${row.id}`}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {row.file_name ?? "Untitled"}
        </Text>
        <Text style={styles.rowMeta}>
          {formatBytes(row.byte_size)} · {row.detail ?? ""}
        </Text>
        {!row.deletable ? (
          <Text style={styles.rowWarning}>{STATE_LABEL[row.state] ?? "Not yet backed up"}</Text>
        ) : null}
      </View>
      <View style={[styles.checkbox, row.selected && row.deletable && styles.checkboxOn]}>
        {row.selected && row.deletable ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
    </Pressable>
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
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700", flex: 1 },
  sweepBtn: {
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  sweepBtnText: { color: theme.colors.primary, fontWeight: "600", fontSize: 13 },
  btnDisabled: { opacity: 0.45 },
  note: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12.5,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
  },
  empty: {
    color: theme.colors.onSurfaceVariant,
    textAlign: "center",
    marginTop: 60,
    paddingHorizontal: theme.spacing.lg,
    lineHeight: 19,
  },
  scopeTitle: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginLeft: theme.spacing.md + theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  scopeRow: { flexDirection: "row", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, marginTop: theme.spacing.sm },
  scopeChip: {
    flex: 1,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    paddingVertical: 9,
    alignItems: "center",
  },
  scopeChipActive: { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary },
  scopeChipText: { color: theme.colors.onSurfaceVariant, fontSize: 13, fontWeight: "600" },
  scopeChipTextActive: { color: theme.colors.onPrimaryContainer },
  scopeNote: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  listContent: { paddingBottom: 160 },
  section: { marginTop: theme.spacing.md, paddingHorizontal: theme.spacing.md },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: theme.spacing.sm, gap: theme.spacing.sm },
  sectionTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "700" },
  sectionSub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 1 },
  selectAllBtn: { borderRadius: theme.radius.full, borderWidth: 1, borderColor: theme.colors.outline, paddingVertical: 5, paddingHorizontal: 10 },
  selectAllText: { color: theme.colors.primary, fontSize: 12, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: 8,
  },
  rowDisabled: { opacity: 0.5 },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: theme.colors.surfaceHighest },
  rowName: { color: theme.colors.onSurface, fontSize: 13.5 },
  rowMeta: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: 2 },
  rowWarning: { color: theme.colors.error, fontSize: 11.5, marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: theme.colors.outline,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkmark: { color: theme.colors.onPrimary, fontSize: 15, fontWeight: "800" },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceContainer,
    borderTopWidth: 1,
    borderTopColor: theme.colors.outlineVariant,
  },
  deleteBtn: {
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
    paddingVertical: 13,
    alignItems: "center",
  },
  deleteBtnText: { color: theme.colors.onPrimary, fontWeight: "700", fontSize: 14.5 },
  bottomHint: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 11.5,
    textAlign: "center",
    marginTop: 6,
  },
});
