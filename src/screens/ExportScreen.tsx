import React, { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Sharing from "expo-sharing";
import { useSettingsStore } from "../store/settingsStore";
import { runExport, type ExportResult } from "../lib/exportManifest";
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
});
