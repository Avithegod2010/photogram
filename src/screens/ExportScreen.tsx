import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

// v0.38: the escape hatch. Exports the ENTIRE library index (every media row
// including trashed/edited copies, plus people and face samples) as a JSON
// manifest or an Excel-friendly CSV, then opens the share sheet so it can be
// sent anywhere (Saved Messages, Drive, a PC). Photos/videos themselves are
// NOT copied — they live in Telegram; this export is the addressable index of
// that warehouse.
export function ExportScreen(_props: { navigation: NativeStackNavigationProp<{ Tabs: undefined }> }) {
  const insets = useSafeAreaInsets();
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
          Alert.alert("Snapshot saved", `${r.result.fileName} · ${formatBytes(r.result.byteCount)}`);
        } else if (!r.ran) {
          Alert.alert("Snapshot", `Not written: ${r.reason}`);
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
        Alert.alert(
          "Offline copies",
          `${final.saved} original${final.saved === 1 ? "" : "s"} saved to the offline folder this pass` +
            (final.skippedExisting > 0 ? `, ${final.skippedExisting} already on the phone` : "") +
            (final.failed > 0 ? `, ${final.failed} could not be downloaded (they can retry later)` : "") +
            ". Tap again to continue with the next batch."
        );
      })
      .catch(() => Alert.alert("Failed", "The offline download hit an error — try again later."))
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
        Alert.alert("Not a Photogram export", "Pick a manifest file exported from Photogram (JSON).");
        return;
      }
      const plan = await dryRunImport(manifest);
      setManifest(manifest);
      setImportName(picked.name);
      setCurated(plan);
    } catch {
      Alert.alert("Import failed", "Could not read that file.");
    }
  }, [offlineRunning]);

  const confirmImport = useCallback(() => {
    if (!manifest || !curated) return;
    Alert.alert(
      "Import library index",
      `Add ${curated.newRows} new item${curated.newRows === 1 ? "" : "s"} to this phone's index?\n\n` +
        `Skipped in the file: ${curated.duplicateRemote} already here by Telegram id, ${curated.duplicateFingerprint} by fingerprint, ${curated.missingRemote} have no Telegram copy to fall back to.\n\n` +
        `Nothing is downloaded yet — cloud-only rows load their thumbnails on scroll.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Import",
          onPress: () => {
            void applyImport(manifest)
              .then((res) => {
                Alert.alert(
                  "Imported",
                  `${res.inserted} item${res.inserted === 1 ? "" : "s"} added. Open the gallery and they will appear as cloud-only places in the timeline.`
                );
              })
              .catch(() => Alert.alert("Import failed", "Could not write the items."))
              .finally(() => {
                setManifest(null);
                setCurated(null);
                setImportName(null);
              });
          },
        },
      ]
    );
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
        Alert.alert("Saved", `${res.fileName} (${formatBytes(res.byteCount)}) in the app folder.`);
      }
    } catch (err) {
      Alert.alert(
        "Export failed",
        err instanceof Error ? err.message : "Something went wrong while building the file."
      );
    } finally {
      setBusy(null);
    }
  }, [busy, minifyJson]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => _props.navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Export library</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What this is</Text>
        <Text style={styles.cardText}>
          A portable index of EVERY photo and video in your Photogram database — including trashed
          and edited copies, your tags, notes, people names and face samples — plus the exact
          Telegram chat and message id of each backed-up item. The photos themselves are not
          copied; they live in Telegram. This file is your proof-and-restore map if you ever leave
          the app or lose the phone.
        </Text>
      </View>

      <ExportRow
        title="Full manifest (JSON)"
        sub="Everything: media, tags, notes, people, face samples, Telegram ids. For archiving and future re-import."
        busy={busy === "json"}
        onPress={() => void doExport("json")}
        disabled={busy !== null}
      />

      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Compact JSON (smaller file)</Text>
          <Text style={styles.rowSub}>
            One line instead of an indented, human-readable layout.
          </Text>
        </View>
        <Switch value={minifyJson} onValueChange={setMinifyJson} />
      </View>

      <ExportRow
        title="Spreadsheet (CSV)"
        sub="One row per photo with dates, size, tags, note and Telegram ids — opens in Excel/Sheets."
        busy={busy === "csv"}
        onPress={() => void doExport("csv")}
        disabled={busy !== null}
      />

      {result !== null ? (
        <Text style={styles.result}>
          Last export: {result.fileName} · {formatBytes(result.byteCount)} — shared via the system
          sheet. Nothing was uploaded; where it goes is entirely your choice.
        </Text>
      ) : null}

      <Text style={styles.section}>Offline copies (the photos themselves)</Text>
      <ExportRow
        title={offlineRunning ? "Downloading…" : offline ? "Continue offline copies" : "Download originals here"}
        sub={
          offline
            ? `Offline folder: ${offline.saved} saved · ${offline.skippedExisting} already on the phone · ${offline.failed} failed. Resumes where it stopped — tap again for the next batch of 200.`
            : "Copy every backed-up photo/video from Telegram into this phone's offline folder as real files. Paced and resumable; runs while this screen is open."
        }
        busy={offlineRunning}
        onPress={startOffline}
        disabled={offlineRunning || busy !== null}
      />
      {offlineRunning ? (
        <View style={styles.offlineLive}>
          <Text style={styles.offlineLiveText}>
            {offline?.current ? `Now: ${offline.current}` : "Scanning the index…"}
            {offline ? ` · ${offline.saved + offline.skippedExisting} this pass · ${Math.round(offline.processedMb)} MB` : ""}
          </Text>
          <Pressable style={styles.offlineCancel} onPress={stopOffline} hitSlop={8}>
            <Text style={styles.offlineCancelText}>Stop after this file</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.section}>Weekly snapshot (safety net)</Text>
      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Keep a fresh manifest on this phone</Text>
          <Text style={styles.rowSub}>
            Once a week (while the app is open) the full index is written into
            documents/export/snapshots/. Only the newest 8 are kept. Purely local.
          </Text>
        </View>
        <Switch value={snapshotExport} onValueChange={setSnapshotExport} />
      </View>
      {snapshotExport ? (
        <>
          <ExportRow
            title={snapshotRunning ? "Writing snapshot…" : "Write a snapshot now"}
            sub={
              snappedLast > 0
                ? `Last: ${new Date(snappedLast).toLocaleString()} · ${snappedCount} file${snappedCount === 1 ? "" : "s"} kept`
                : "No snapshot yet — the first one is written the first time the app is open for a while."
            }
            busy={snapshotRunning}
            onPress={runSnapshot}
            disabled={snapshotRunning || busy !== null || offlineRunning}
          />
          {snappedCount > 0 ? (
            <Text style={styles.note}>
              Snapshots live under the app's own files. On a lost phone, copy the folder off with a
              PC (USB), or share a snapshot like any export file — pick it in "Import a manifest"
              on the new phone.
            </Text>
          ) : null}
        </>
      ) : null}

      <Text style={styles.section}>Restore on a new phone</Text>
      <ExportRow
        title="Import a manifest (JSON)"
        sub={
          curated
            ? `"${importName}": ${curated.newRows} new · ${curated.duplicateRemote} already here · ${curated.duplicateFingerprint} fingerprint dupes · ${curated.missingRemote} without copies. Tap to import.`
            : "Pick a manifest file exported from Photogram; a dry-run shows what it would add BEFORE anything is written."
        }
        busy={false}
        onPress={() => (curated ? confirmImport() : void doImportPick())}
        disabled={offlineRunning || busy !== null}
      />
      {manifest !== null && curated !== null && importName !== null ? (
        <Pressable
          style={styles.discardPick}
          onPress={() => {
            setManifest(null);
            setCurated(null);
            setImportName(null);
          }}
        >
          <Text style={styles.discardPickText}>Discard picked file</Text>
        </Pressable>
      ) : null}

      <Text style={styles.note}>
        Face-sample embeddings are hex-encoded and only reusable inside the same face model that
        created them. Shared-album photos appear as rows too — they also live in the family group.
      </Text>
    </View>
  );
}

function ExportRow(props: {
  title: string;
  sub: string;
  busy: boolean;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      android_ripple={{ color: theme.colors.outlineVariant }}
      onPress={props.onPress}
      disabled={props.disabled}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>
          {props.busy ? "Building file…" : props.title}
        </Text>
        <Text style={styles.rowSub}>{props.sub}</Text>
      </View>
      <Text style={styles.go}>→</Text>
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
    paddingBottom: 6,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  card: {
    margin: theme.spacing.md,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  cardTitle: { color: theme.colors.onSurface, fontSize: 14.5, fontWeight: "700" },
  cardText: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  pressed: { opacity: 0.7 },
  rowLabel: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "700" },
  rowSub: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: 3 },
  go: { color: theme.colors.primary, fontSize: 18 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  result: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 11.5,
    marginHorizontal: theme.spacing.md,
    marginTop: 2,
  },
  note: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 11,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    lineHeight: 15,
  },
  section: {
    color: theme.colors.onSurface,
    fontSize: 13,
    fontWeight: "800",
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  offlineLive: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  offlineLiveText: { color: theme.colors.onSurfaceVariant, fontSize: 11.5 },
  offlineCancel: { alignSelf: "flex-start" },
  offlineCancelText: { color: theme.colors.primary, fontSize: 12.5, fontWeight: "700" },
  discardPick: { marginHorizontal: theme.spacing.md, marginTop: 2, marginBottom: theme.spacing.sm },
  discardPickText: { color: theme.colors.primary, fontSize: 12.5, fontWeight: "700" },
});
