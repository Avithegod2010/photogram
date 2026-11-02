import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { ScrollView } from "react-native-gesture-handler";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as MediaLibrary from "expo-media-library";
import {
  markMediaCloudOnly,
  countFreeable,
  listFreeable,
  listFreeableAssets,
  type FreeableRow,
} from "../db/queries";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";

// v0.51 "Free up space": delete ORIGINALS that are already safe in Telegram.
// Hard safety rails (probe-verified around the counts):
// - only visible + non-favorite + state='synced' + untouched-for-7-days rows;
// - only rows the scanner recorded a MediaLibrary asset id for (the thing it
//   can actually ask Android to trash);
// - batches of 40 with per-batch rollback fidelity: a row's local_uri is only
//   nulled AFTER its delete confirmed, so a stalled pass leaves the row
//   intact (owner reruns; Android's own trash dialog is the last guard).
// uploader.ts is untouched — deleting local copies cannot touch the worker
// (those rows are 'local'/'failed', never offered here).

const BATCH = 40;

export function FreeUpSpaceScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; FreeUpSpace: undefined }>;
}) {
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null);
  const [preview, setPreview] = useState<FreeableRow[]>([]);
  const [running, setRunning] = useState(false);
  const [progressFreed, setProgressFreed] = useState(0);
  const [done, setDone] = useState<{ freed: number; bytes: number } | null>(null);

  const reload = useCallback(() => {
    void countFreeable()
      .then(setStats)
      .catch(() => setStats({ count: 0, bytes: 0 }));
    void listFreeable(48)
      .then(setPreview)
      .catch(() => setPreview([]));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const freeAll = useCallback(() => {
    if (!stats || stats.count === 0 || running) return;
    Alert.alert(
      "Delete from your phone?",
      `${stats.count.toLocaleString()} item${stats.count === 1 ? "" : "s"} (${formatBytes(
        stats.bytes
      )}) will be deleted from this phone. They stay in Telegram and Photogram will show them from the cloud.\n\nAndroid may show its own confirmation for the first item.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setRunning(true);
            setProgressFreed(0);
            void (async () => {
              let freed = 0;
              let bytes = 0;
              try {
                for (;;) {
                  const rows = await listFreeableAssets(BATCH);
                  if (rows.length === 0) break;
                  let batchBytes = 0;
                  const byAsset = new Map<string, { id: number; byte_size: number }>();
                  for (const r of rows) {
                    if (byAsset.has(r.media_library_id)) continue;
                    byAsset.set(r.media_library_id, { id: r.id, byte_size: r.byte_size });
                    batchBytes += r.byte_size;
                  }
                  if (byAsset.size === 0) break;
                  await MediaLibrary.deleteAssetsAsync([...byAsset.keys()]);
                  await markMediaCloudOnly([...byAsset.values()].map((v) => v.id));
                  freed += byAsset.size;
                  bytes += batchBytes;
                  setProgressFreed(freed);
                }
                setDone({ freed, bytes });
              } catch {
                Alert.alert(
                  "Could not finish",
                  "Some items may not have been deleted. Check Android's gallery trash, then try again — anything still on the phone will be offered again."
                );
              } finally {
                setRunning(false);
                reload();
              }
            })();
          },
        },
      ]
    );
  }, [stats, running, reload]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Free up space</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lede}>
          These originals are already safe in Telegram — deleting them from the phone keeps your
          gallery exactly the same (Photogram shows cloud copies).
        </Text>
        <Text style={styles.notice}>
          Favorites and anything from the last 7 days are never offered.
        </Text>
        {stats === null ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
        ) : (
          <>
            <View style={styles.statCard}>
              <Text style={styles.statBig}>{stats.count.toLocaleString()}</Text>
              <Text style={styles.statSub}>
                items · {formatBytes(stats.bytes)} can be freed
              </Text>
            </View>
            <Pressable
              style={[styles.cta, stats.count === 0 && styles.ctaOff]}
              onPress={freeAll}
              disabled={stats.count === 0}
            >
              <Text style={styles.ctaText}>
                {running
                  ? `Deleting… ${progressFreed.toLocaleString()} freed — keep the app open`
                  : `Free everything (${formatBytes(stats.bytes)})`}
              </Text>
            </Pressable>
            {done ? (
              <Text style={styles.doneText}>
                ✓ Freed {done.freed.toLocaleString()} items ({formatBytes(done.bytes)})
              </Text>
            ) : null}
          </>
        )}
        {running ? <ActivityIndicator color={theme.colors.primary} style={styles.loader} /> : null}
        <Text style={styles.sectionTitle}>Preview</Text>
        <View style={styles.grid}>
          {preview.map((r) => (
            <Image
              key={r.id}
              source={{ uri: r.thumb_uri ?? undefined }}
              style={styles.cell}
              contentFit="cover"
              transition={90}
            />
          ))}
        </View>
        {preview.length === 0 && stats !== null && stats.count === 0 ? (
          <Text style={styles.hint}>
            Nothing to free yet — everything either isn't backed up, is a favorite, or is recent.
          </Text>
        ) : null}
      </ScrollView>
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
    paddingBottom: theme.spacing.sm,
  },
  back: { color: theme.colors.onSurface, fontSize: 22, width: 28 },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: "700" },
  content: { padding: theme.spacing.md, gap: theme.spacing.sm },
  lede: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, lineHeight: 20 },
  notice: { color: theme.colors.onSurfaceVariant, fontSize: 12 },
  loader: { marginVertical: 12 },
  statCard: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    alignItems: "center",
    gap: 2,
  },
  statBig: { color: theme.colors.onSurface, fontSize: 26, fontWeight: "800" },
  statSub: { color: theme.colors.onSurfaceVariant, fontSize: 13 },
  cta: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 13,
    borderRadius: theme.radius.full,
    alignItems: "center",
    marginTop: theme.spacing.sm,
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: theme.colors.onPrimary, fontWeight: "700", fontSize: 15 },
  doneText: { color: theme.colors.primary, fontWeight: "700", textAlign: "center" },
  sectionTitle: {
    color: theme.colors.onSurface,
    fontWeight: "700",
    fontSize: 14,
    marginTop: theme.spacing.md,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
  cell: { width: 92, height: 92, borderRadius: 8, margin: 0 },
  hint: { color: theme.colors.onSurfaceVariant, fontSize: 13 },
});
