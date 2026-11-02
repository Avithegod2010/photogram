import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { ScrollView } from "react-native-gesture-handler";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { findDuplicateGroups, DuplicateGroup } from "../lib/similar";
import { setMediaState, setMediaVisibility } from "../db/queries";
import { theme } from "../theme";

// v0.54 Duplicate merge tool. Reuses the existing findDuplicateGroups()
// clustering (same-day near-duplicates by pHash). For each group the owner
// picks the keeper; the rest are trashed (trash_reason='merge') so the v0.39
// "restore merged" flow can undo. Nothing is permanently deleted here — the
// 30-day trash window still applies, and the bytes are reclaimable via
// Free up space afterwards.
export function DuplicateMergeScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; DuplicateMerge: undefined }>;
}) {
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [merged, setMerged] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    void findDuplicateGroups()
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const mergeGroup = useCallback(
    (group: DuplicateGroup, keepId: number) => {
      Alert.alert(
        "Merge this group?",
        `Keep 1 photo, move the other ${group.items.length - 1} to Trash. You can restore them for 30 days.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Merge",
            style: "destructive",
            onPress: () => {
              setWorking(true);
              void (async () => {
                try {
                  for (const item of group.items) {
                    if (item.id === keepId) continue;
                    await setMediaVisibility(item.id, "trashed");
                    // stamp trash_reason = 'merge' so the v0.39 restore flow picks it up
                    const db = await (await import("../db")).getDb();
                    await db.runAsync(
                      "UPDATE media SET trash_reason = 'merge', trashed_at = ?, updated_at = ? WHERE id = ?",
                      [Date.now(), Date.now(), item.id]
                    );
                  }
                  setMerged((n) => n + (group.items.length - 1));
                  reload();
                } catch {
                  Alert.alert("Could not merge", "Try again — nothing was permanently deleted.");
                } finally {
                  setWorking(false);
                }
              })();
            },
          },
        ]
      );
    },
    [reload]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Merge duplicates</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lede}>
          Near-duplicate photos (same day, similar look) grouped together. Pick the one to keep;
          the rest go to Trash (restorable for 30 days).
        </Text>
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
        ) : groups.length === 0 ? (
          <Text style={styles.hint}>
            No duplicate groups found. Run a scan + the similar-analysis backfill first.
          </Text>
        ) : (
          groups.map((g, gi) => (
            <View key={gi} style={styles.group}>
              <Text style={styles.groupTitle}>
                Group {gi + 1} · {g.items.length} shots
              </Text>
              <View style={styles.row}>
                {g.items.map((it) => (
                  <Pressable
                    key={it.id}
                    style={styles.cell}
                    onPress={() => mergeGroup(g, it.id)}
                  >
                    <ExpoImage
                      source={{ uri: it.thumb_uri ?? undefined }}
                      style={styles.thumb}
                      contentFit="cover"
                      transition={90}
                    />
                    <Text style={styles.cellLabel} numberOfLines={1}>
                      {it.file_name ?? `#${it.id}`}
                    </Text>
                    <Text style={styles.cellSub}>{Math.round(it.byte_size / 1024)} KB</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.groupHint}>Tap a photo to keep it and merge the rest.</Text>
            </View>
          ))
        )}
        {merged > 0 ? (
          <Text style={styles.doneText}>✓ Merged {merged} photo{merged === 1 ? "" : "s"}.</Text>
        ) : null}
        {working ? <ActivityIndicator color={theme.colors.primary} style={styles.loader} /> : null}
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
  content: { padding: theme.spacing.md, gap: theme.spacing.md },
  lede: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, lineHeight: 20 },
  loader: { marginVertical: 12 },
  hint: { color: theme.colors.onSurfaceVariant, fontSize: 13 },
  group: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
    gap: 6,
  },
  groupTitle: { color: theme.colors.onSurface, fontWeight: "700", fontSize: 14 },
  groupHint: { color: theme.colors.onSurfaceVariant, fontSize: 11.5 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cell: { width: 96, alignItems: "center", gap: 2 },
  thumb: { width: 96, height: 96, borderRadius: 8 },
  cellLabel: { color: theme.colors.onSurface, fontSize: 10.5, maxWidth: 96 },
  cellSub: { color: theme.colors.onSurfaceVariant, fontSize: 9.5 },
  doneText: { color: theme.colors.primary, fontWeight: "700", textAlign: "center" },
});
