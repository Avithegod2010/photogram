import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Sharing from "expo-sharing";
import { useSettingsStore } from "../store/settingsStore";
import { runExport, type ExportResult } from "../lib/exportManifest";
import {
  parseManifest,
  pickManifestFile,
  dryRunImport,
  applyImport,
  type ImportDryRunResult,
  type ParsedManifest,
} from "../lib/importManifest";
import { runOfflineExportPass, loadOfflineProgress, OfflineExportProgress } from "../lib/offlineExport";
import { runSnapshotNow, lastSnapshotAt, listSnapshots } from "../lib/snapshotExport";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  ListRow,
  Screen,
  Section,
  ToggleRow,
  alertDialog,
  confirmDialog,
} from "../ui";

// v0.38: the escape hatch. Exports the ENTIRE library index (every media row
// including trashed/edited copies, plus people and face samples) as a JSON
// manifest or an Excel-friendly CSV, then opens the share sheet so it can be
// sent anywhere (Saved Messages, Drive, a PC). Photos/videos themselves are
// NOT copied — they live in Telegram; this export is the addressable index of
// that warehouse.
export function ExportScreen(_props: { navigation: NativeStackNavigationProp<{ Tabs: undefined }> }) {
  const minifyJson = useSettingsStore((s) => s.exportMinifyJson);
  const setMinifyJson = useSettingsStore((s) => s.setExportMinifyJson);
  const [busy, setBusy] = useState<null | "json" | "csv">(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  // v0.39 follow-up 1: offline originals (download every Telegram original
  // into documents/offline/ — paced, resumable, screen-driven).
  const [offline, setOffline] = useState<OfflineExportProgress | null>(null);
  const offlineRunningRef = useRef({ cancelled: false });
  const [offlineRunning, setOfflineRunning] = useState(false);
  const [curated, setCurated] = useState<ImportDryRunResult | null>(null);
  const [manifest, setManifest] = useState<ParsedManifest | null>(null);
  const [importName, setImportName] = useState<string | null>(null);
  const snapshotExport = useSettingsStore((s) => s.snapshotExport);
  const setSnapshotExport = useSettingsStore((s) => s.setSnapshotExport);
  const [snappedLast, setSnappedLast] = useState(0);
  const [snappedCount, setSnappedCount] = useState(0);
  const [snapshotRunning, setSnapshotRunning] = useState(false);

  const refreshSnapshotInfo = useCallback(() => {
    setSnappedLast(lastSnapshotAt());
    setSnappedCount(listSnapshots().length);
  }, []);

  useEffect(() => {
    refreshSnapshotInfo();
  }, [refreshSnapshotInfo]);

  const runSnapshot = useCallback(() => {
    if (snapshotRunning) return;
    setSnapshotRunning(true);
    void runSnapshotNow()
      .then((r) => {
        refreshSnapshotInfo();
        if (r.ran && r.result) {
          void alertDialog({
            title: "Snapshot saved",
            message: `${r.result.fileName} · ${formatBytes(r.result.byteCount)}`,
          });
        } else if (!r.ran) {
          void alertDialog({ title: "Snapshot", message: `Not written: ${r.reason}` });
        }
      })
      .finally(() => setSnapshotRunning(false));
  }, [snapshotRunning, refreshSnapshotInfo]);

  useEffect(() => {
    void loadOfflineProgress().then(setOffline);
  }, []);

  const startOffline = useCallback(() => {
    if (offlineRunning) return;
    offlineRunningRef.current = { cancelled: false };
    setOfflineRunning(true);
    void runOfflineExportPass(setOffline, offlineRunningRef.current)
      .then((final) => {
        setOffline(final);
        void alertDialog({
          title: "Offline copies",
          message:
            `${final.saved} original${final.saved === 1 ? "" : "s"} saved to the offline folder this pass` +
            (final.skippedExisting > 0 ? `, ${final.skippedExisting} already on the phone` : "") +
            (final.failed > 0 ? `, ${final.failed} could not be downloaded (they can retry later)` : "") +
            ". Tap again to continue with the next batch.",
        });
      })
      .catch(() =>
        void alertDialog({
          title: "Failed",
          message: "The offline download hit an error — try again later.",
        })
      )
      .finally(() => setOfflineRunning(false));
  }, [offlineRunning]);

  const stopOffline = useCallback(() => {
    offlineRunningRef.current.cancelled = true;
  }, []);

  // v0.39 follow-up 2: manifest import (pick → dry-run → confirm → apply).
  const doImportPick = useCallback(async () => {
    if (offlineRunning) return;
    try {
      const picked = await pickManifestFile();
      if (!picked) return;
      const manifest = parseManifest(picked.text);
      if (!manifest) {
        void alertDialog({
          title: "Not a Photogram export",
          message: "Pick a manifest file exported from Photogram (JSON).",
        });
        return;
      }
      const plan = await dryRunImport(manifest);
      setManifest(manifest);
      setImportName(picked.name);
      setCurated(plan);
    } catch {
      void alertDialog({ title: "Import failed", message: "Could not read that file." });
    }
  }, [offlineRunning]);

  const confirmImport = useCallback(() => {
    if (!manifest || !curated) return;
    void confirmDialog({
      title: "Import library index",
      message:
        `Add ${curated.newRows} new item${curated.newRows === 1 ? "" : "s"} to this phone's index?\n\n` +
        `Skipped in the file: ${curated.duplicateRemote} already here by Telegram id, ${curated.duplicateFingerprint} by fingerprint, ${curated.missingRemote} have no Telegram copy to fall back to.\n\n` +
        `Nothing is downloaded yet — cloud-only rows load their thumbnails on scroll.`,
      confirmLabel: "Import",
    }).then((ok) => {
      if (!ok) return;
      void applyImport(manifest)
        .then((res) => {
          void alertDialog({
            title: "Imported",
            message: `${res.inserted} item${res.inserted === 1 ? "" : "s"} added. Open the gallery and they will appear as cloud-only places in the timeline.`,
          });
        })
        .catch(() =>
          void alertDialog({ title: "Import failed", message: "Could not write the items." })
        )
        .finally(() => {
          setManifest(null);
          setCurated(null);
          setImportName(null);
        });
    });
  }, [manifest, curated]);

  const doExport = useCallback(async (kind: "json" | "csv") => {
    if (busy) return;
    setBusy(kind);
    setResult(null);
    try {
      const res = await runExport(kind, { minify: kind === "json" ? minifyJson : false });
      setResult(res);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(res.uri, {
          mimeType: kind === "json" ? "application/json" : "text/csv",
          dialogTitle: "Share Photogram export",
        });
      } else {
        void alertDialog({
          title: "Saved",
          message: `${res.fileName} (${formatBytes(res.byteCount)}) in the app folder.`,
        });
      }
    } catch (err) {
      void alertDialog({
        title: "Export failed",
        message: err instanceof Error ? err.message : "Something went wrong while building the file.",
      });
    } finally {
      setBusy(null);
    }
  }, [busy, minifyJson]);

  const exportBlocked = busy !== null;

  return (
    <Screen>
      <AppBar
        title="Export library"
        large
        onBack={() => _props.navigation.goBack()}
        backLabel={t("common.back")}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Section title="What this is" icon="information-circle-outline">
          <View style={styles.copyBlock}>
            <AppText variant="body" color={theme.colors.onSurfaceVariant}>
              A portable index of EVERY photo and video in your Photogram database — including
              trashed and edited copies, your tags, notes, people names and face samples — plus the
              exact Telegram chat and message id of each backed-up item. The photos themselves are
              not copied; they live in Telegram. This file is your proof-and-restore map if you
              ever leave the app or lose the phone.
            </AppText>
          </View>
        </Section>

        <Section
          title="Export now"
          icon="download-outline"
          footer={
            result !== null
              ? `Last export: ${result.fileName} · ${formatBytes(
                  result.byteCount
                )} — shared via the system sheet. Nothing was uploaded; where it goes is entirely your choice.`
              : undefined
          }
        >
          <ListRow
            title={busy === "json" ? "Building file…" : "Full manifest (JSON)"}
            subtitle="Everything: media, tags, notes, people, face samples, Telegram ids. For archiving and future re-import."
            accessory="chevron"
            onPress={() => void doExport("json")}
            disabled={exportBlocked}
            trailing={
              busy === "json" ? <ActivityIndicator color={theme.colors.accent} /> : undefined
            }
          />
          <ToggleRow
            title="Compact JSON (smaller file)"
            subtitle="One line instead of an indented, human-readable layout."
            value={minifyJson}
            onValueChange={setMinifyJson}
          />
          <ListRow
            title={busy === "csv" ? "Building file…" : "Spreadsheet (CSV)"}
            subtitle="One row per photo with dates, size, tags, note and Telegram ids — opens in Excel/Sheets."
            accessory="chevron"
            onPress={() => void doExport("csv")}
            disabled={exportBlocked}
            trailing={busy === "csv" ? <ActivityIndicator color={theme.colors.accent} /> : undefined}
          />
        </Section>

        <Section title="Offline copies" subtitle="The photos themselves" icon="folder-open-outline">
          <ListRow
            title={
              offlineRunning
                ? "Downloading…"
                : offline
                  ? "Continue offline copies"
                  : "Download originals here"
            }
            subtitle={
              offline
                ? `Offline folder: ${offline.saved} saved · ${offline.skippedExisting} already on the phone · ${offline.failed} failed. Resumes where it stopped — tap again for the next batch of 200.`
                : "Copy every backed-up photo/video from Telegram into this phone's offline folder as real files. Paced and resumable; runs while this screen is open."
            }
            accessory="chevron"
            onPress={startOffline}
            disabled={offlineRunning || exportBlocked}
            trailing={
              offlineRunning ? <ActivityIndicator color={theme.colors.accent} /> : undefined
            }
          />
          {offlineRunning ? (
            <View style={styles.liveBlock}>
              <AppText
                variant="footnote"
                color={theme.colors.onSurfaceVariant}
                accessibilityLiveRegion="polite"
              >
                {offline?.current ? `Now: ${offline.current}` : "Scanning the index…"}
                {offline
                  ? ` · ${offline.saved + offline.skippedExisting} this pass · ${Math.round(
                      offline.processedMb
                    )} MB`
                  : ""}
              </AppText>
              <Button
                label="Stop after this file"
                size="sm"
                variant="secondary"
                icon="stop-circle-outline"
                onPress={stopOffline}
              />
            </View>
          ) : null}
        </Section>

        <Section title="Weekly snapshot" subtitle="Safety net" icon="time-outline">
          <ToggleRow
            title="Keep a fresh manifest on this phone"
            subtitle="Once a week (while the app is open) the full index is written into documents/export/snapshots/. Only the newest 8 are kept. Purely local."
            value={snapshotExport}
            onValueChange={setSnapshotExport}
          />
          {snapshotExport ? (
            <>
              <ListRow
                title={snapshotRunning ? "Writing snapshot…" : "Write a snapshot now"}
                subtitle={
                  snappedLast > 0
                    ? `Last: ${new Date(snappedLast).toLocaleString()} · ${snappedCount} file${
                        snappedCount === 1 ? "" : "s"
                      } kept`
                    : "No snapshot yet — the first one is written the first time the app is open for a while."
                }
                accessory="chevron"
                onPress={runSnapshot}
                disabled={snapshotRunning || exportBlocked || offlineRunning}
                trailing={
                  snapshotRunning ? (
                    <ActivityIndicator color={theme.colors.accent} />
                  ) : undefined
                }
              />
              {snappedCount > 0 ? (
                <View style={styles.noteBlock}>
                  <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
                    Snapshots live under the app's own files. On a lost phone, copy the folder off
                    with a PC (USB), or share a snapshot like any export file — pick it in “Import
                    a manifest” on the new phone.
                  </AppText>
                </View>
              ) : null}
            </>
          ) : null}
        </Section>

        <Section
          title="Restore on a new phone"
          icon="cloud-download-outline"
          footer="Face-sample embeddings are hex-encoded and only reusable inside the same face model that created them. Shared-album photos appear as rows too — they also live in the family group."
        >
          <ListRow
            title="Import a manifest (JSON)"
            subtitle={
              curated
                ? `“${importName}”: ${curated.newRows} new · ${curated.duplicateRemote} already here · ${curated.duplicateFingerprint} fingerprint dupes · ${curated.missingRemote} without copies. Tap to import.`
                : "Pick a manifest file exported from Photogram; a dry-run shows what it would add BEFORE anything is written."
            }
            accessory="chevron"
            onPress={() => (curated ? confirmImport() : void doImportPick())}
            disabled={offlineRunning || exportBlocked}
          />
          {manifest !== null && curated !== null && importName !== null ? (
            <View style={styles.actionRow}>
              <Button
                label="Discard picked file"
                variant="quiet"
                size="sm"
                icon="close-circle-outline"
                onPress={() => {
                  setManifest(null);
                  setCurated(null);
                  setImportName(null);
                }}
              />
            </View>
          ) : null}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  copyBlock: { padding: theme.spacing.md },
  liveBlock: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    paddingTop: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  noteBlock: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    paddingTop: theme.spacing.xs,
  },
  actionRow: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    paddingTop: theme.spacing.xs,
  },
});
