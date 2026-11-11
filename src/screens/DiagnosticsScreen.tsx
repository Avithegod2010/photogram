import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getDbDiagnostics, type DbDiagnostics } from "../db/queries";
import { fetchAuthorizationState } from "../lib/tdlib";
import { getLastScanSummary } from "../lib/scanner";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  ErrorState,
  IconButton,
  Screen,
  Section,
  Skeleton,
} from "../ui";

// v0.31 in-app diagnostics: everything a debugging session would ask for
// first — schema version, DB size, per-state media counts, queue state,
// TDLib auth state and the last scan's errors — readable without adb.
export function DiagnosticsScreen({ navigation }: { navigation: NativeStackNavigationProp<{ Tabs: undefined }> }) {
  const [diag, setDiag] = useState<DbDiagnostics | null>(null);
  const [authState, setAuthState] = useState<string>("unknown");
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(() => {
    setLoadError(false);
    void getDbDiagnostics()
      .then(setDiag)
      .catch(() => {
        setDiag(null);
        setLoadError(true);
      });
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
    <Screen>
      <AppBar
        title="Diagnostics"
        subtitle="A snapshot of this phone's index, queue and login state"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
        actions={<IconButton icon="refresh" label="Refresh" onPress={reload} />}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loadError ? (
          <ErrorState
            title={t("state.error")}
            body="Photogram couldn't read the database report. Your photos and backups are untouched."
            retryLabel={t("common.retry")}
            onRetry={reload}
          />
        ) : (
          <>
            <Section title="This app" icon="build-outline">
              <DiagRow k="App version" v={Constants.expoConfig?.version ?? "unknown"} />
              <DiagRow k="Database schema" v={diag ? `v${diag.schemaVersion}` : undefined} />
              <DiagRow k="Database size" v={diag ? formatBytes(diag.dbBytes) : undefined} />
              <DiagRow k="TDLib auth state" v={authState} />
            </Section>

            <Section title="Library (media table)" icon="images-outline">
              <DiagRow k="Total rows" v={diag ? String(diag.mediaTotal) : undefined} />
              <DiagRow k="Visible" v={diag ? String(diag.mediaVisible) : undefined} />
              <DiagRow k="Synced to Telegram" v={diag ? String(diag.mediaSynced) : undefined} />
              <DiagRow k="Local only" v={diag ? String(diag.mediaLocal) : undefined} />
              <DiagRow k="Upload failed" v={diag ? String(diag.mediaFailed) : undefined} />
              <DiagRow
                k="Archived / Hidden / Trash"
                v={diag ? `${diag.mediaArchived} / ${diag.mediaHidden} / ${diag.mediaTrashed}` : undefined}
              />
            </Section>

            <Section title="Upload queue" icon="cloud-upload-outline">
              <DiagRow k="Pending" v={diag ? String(diag.queuePending) : undefined} />
              <DiagRow k="Active" v={diag ? String(diag.queueActive) : undefined} />
              <DiagRow k="Failed" v={diag ? String(diag.queueFailed) : undefined} />
            </Section>

            <Section title="Features" icon="sparkles-outline">
              <DiagRow k="Saved searches" v={diag ? String(diag.savedSearches) : undefined} />
              <DiagRow
                k="Photos hashed (similar search)"
                v={diag ? String(diag.hashedCount) : undefined}
              />
              <DiagRow k="Notes written" v={diag ? String(diag.notedCount) : undefined} />
              <DiagRow k="Pending junk findings" v={diag ? String(diag.junkPending) : undefined} />
            </Section>

            <Section title="Last scan" icon="search-outline">
              {!scan ? (
                <DiagRow k="No scan recorded yet" v="—" />
              ) : (
                <>
                  <DiagRow k="Finished" v={new Date(scan.finishedAt).toLocaleString()} />
                  <DiagRow k="Scanned / added" v={`${scan.scanned} / ${scan.added}`} />
                  <DiagRow k="Duplicates / failed" v={`${scan.duplicates} / ${scan.failed}`} />
                  {scan.partialAccess ? (
                    <DiagRow k="Partial access" v="Android granted only selected items" />
                  ) : null}
                  {scan.lastError ? <DiagRow k="Last error" v={scan.lastError} /> : null}
                </>
              )}
            </Section>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function DiagRow({ k, v }: { k: string; v?: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${k}: ${v ?? "loading"}`}>
      <AppText
        variant="footnote"
        color={theme.colors.onSurfaceVariant}
        numberOfLines={2}
        style={styles.rowKey}
      >
        {k}
      </AppText>
      {v === undefined ? (
        <Skeleton width={72} height={14} />
      ) : (
        <AppText variant="footnote" weight="medium" align="right" numberOfLines={3} style={styles.rowValue}>
          {v}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.compact,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.compact,
    minHeight: theme.layout.touch,
  },
  rowKey: { flexShrink: 1 },
  rowValue: { flexShrink: 2 },
});
