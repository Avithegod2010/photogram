import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getDbDiagnostics, DbDiagnostics } from "../db/queries";
import { fetchAuthorizationState } from "../lib/tdlib";
import { getLastScanSummary } from "../lib/scanner";
import { formatBytes } from "../lib/stats";
import Constants from "expo-constants";
import { theme } from "../theme";

// v0.31 in-app diagnostics: everything a debugging session would ask for
// first — schema version, DB size, per-state media counts, queue state,
// TDLib auth state and the last scan's errors — readable without adb.
export function DiagnosticsScreen({ navigation }: { navigation: NativeStackNavigationProp<{ Tabs: undefined }> }) {
  const insets = useSafeAreaInsets();
  const [diag, setDiag] = useState<DbDiagnostics | null>(null);
  const [authState, setAuthState] = useState<string>("unknown");
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  const reload = useCallback(() => {
    void getDbDiagnostics()
      .then(setDiag)
      .catch(() => setDiag(null));
    void fetchAuthorizationState()
      .then((auth) => setAuthState((auth?.["@type"] as string) ?? "unavailable"))
      .catch(() => setAuthState("unavailable"));
    setScanSummary(getLastScanSummary());
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", reload);
    return unsub;
  }, [navigation, reload]);

  const scan = (() => {
    if (!scanSummary) return null;
    try {
      return JSON.parse(scanSummary) as {
        scanned: number;
        added: number;
        duplicates: number;
        failed: number;
        lastError: string | null;
        partialAccess: boolean;
        finishedAt: number;
      };
    } catch {
      return null;
    }
  })();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Diagnostics</Text>
        <Pressable style={styles.refreshBtn} onPress={reload} hitSlop={8}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <DiagRow k="App version" v={Constants.expoConfig?.version ?? "unknown"} />
          <DiagRow k="Database schema" v={diag ? `v${diag.schemaVersion}` : "…"} />
          <DiagRow k="Database size" v={diag ? formatBytes(diag.dbBytes) : "…"} />
          <DiagRow k="TDLib auth state" v={authState} />
        </View>

        <Text style={styles.sectionTitle}>Library (media table)</Text>
        <View style={styles.card}>
          <DiagRow k="Total rows" v={diag ? String(diag.mediaTotal) : "…"} />
          <DiagRow k="Visible" v={diag ? String(diag.mediaVisible) : "…"} />
          <DiagRow k="Synced to Telegram" v={diag ? String(diag.mediaSynced) : "…"} />
          <DiagRow k="Local only" v={diag ? String(diag.mediaLocal) : "…"} />
          <DiagRow k="Upload failed" v={diag ? String(diag.mediaFailed) : "…"} />
          <DiagRow k="Archived / Hidden / Trash" v={diag ? `${diag.mediaArchived} / ${diag.mediaHidden} / ${diag.mediaTrashed}` : "…"} />
        </View>

        <Text style={styles.sectionTitle}>Upload queue</Text>
        <View style={styles.card}>
          <DiagRow k="Pending" v={diag ? String(diag.queuePending) : "…"} />
          <DiagRow k="Active" v={diag ? String(diag.queueActive) : "…"} />
          <DiagRow k="Failed" v={diag ? String(diag.queueFailed) : "…"} />
        </View>

        <Text style={styles.sectionTitle}>Features</Text>
        <View style={styles.card}>
          <DiagRow k="Saved searches" v={diag ? String(diag.savedSearches) : "…"} />
          <DiagRow k="Photos hashed (similar search)" v={diag ? String(diag.hashedCount) : "…"} />
          <DiagRow k="Notes written" v={diag ? String(diag.notedCount) : "…"} />
          <DiagRow k="Pending junk findings" v={diag ? String(diag.junkPending) : "…"} />
        </View>

        <Text style={styles.sectionTitle}>Last scan</Text>
        <View style={styles.card}>
          {!scan ? (
            <DiagRow k="No scan recorded yet" v="—" />
          ) : (
            <>
              <DiagRow k="Finished" v={new Date(scan.finishedAt).toLocaleString()} />
              <DiagRow k="Scanned / added" v={`${scan.scanned} / ${scan.added}`} />
              <DiagRow k="Duplicates / failed" v={`${scan.duplicates} / ${scan.failed}`} />
              {scan.partialAccess ? <DiagRow k="Partial access" v="Android granted only selected items" /> : null}
              {scan.lastError ? <DiagRow k="Last error" v={scan.lastError} /> : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function DiagRow({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { flex: 1, color: theme.colors.onSurface, fontSize: 22, fontWeight: "700" },
  refreshBtn: {
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshText: { color: theme.colors.onPrimaryContainer, fontWeight: "700", fontSize: 12 },
  content: { paddingBottom: 40, paddingHorizontal: theme.spacing.lg },
  sectionTitle: {
    color: theme.colors.onSurface,
    fontSize: 15,
    fontWeight: "700",
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    paddingHorizontal: theme.spacing.md,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outlineVariant,
  },
  rowKey: { color: theme.colors.onSurfaceVariant, fontSize: 13, flexShrink: 1 },
  rowValue: { color: theme.colors.onSurface, fontSize: 13, fontWeight: "500", textAlign: "right", flexShrink: 2 },
});
