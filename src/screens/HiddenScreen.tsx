import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listHidden, MediaRow, setMediaVisibility } from "../db/queries";
import { unlockHiddenAlbum } from "../lib/biometrics";
import { useSettingsStore } from "../store/settingsStore";
import { theme } from "../theme";

export function HiddenScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const lockEnabled = useSettingsStore((s) => s.hiddenLockEnabled);
  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [locked, setLocked] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // The gallery grid stays mounted behind the lock — data is only fetched and
  // rendered after the biometric check succeeds (or is disabled/unavailable).
  const unlock = useCallback(async () => {
    if (lockEnabled) {
      const ok = await unlockHiddenAlbum();
      if (!ok) return;
    }
    setLocked(false);
    void listHidden()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, [lockEnabled]);

  useEffect(() => {
    void unlock();
  }, [unlock]);

  const unhide = useCallback(async (row: MediaRow) => {
    await setMediaVisibility(row.id, "visible");
    setRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
  }, []);

  if (locked) {
    return (
      <View style={[styles.root, styles.lockedRoot, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockTitle}>Hidden album</Text>
        <Text style={styles.lockBody}>
          Unlock with your fingerprint or face to view hidden photos.
        </Text>
        <Pressable style={styles.unlockBtn} onPress={() => void unlock()}>
          <Text style={styles.unlockBtnText}>Unlock</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Hidden</Text>
      </View>
      <FlashList
        data={rows ?? []}
        numColumns={3}
        masonry
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() =>
                navigation.navigate("Viewer", {
                  ids: (rows ?? []).map((r) => r.id),
                  index: (rows ?? []).findIndex((r) => r.id === item.id),
                })
              }
            >
              <Image
                source={{ uri: item.thumb_uri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={`h-${item.id}`}
                transition={120}
              />
            </Pressable>
            <Pressable style={styles.miniBtn} onPress={() => void unhide(item)}>
              <Text style={styles.miniBtnText}>Unhide</Text>
            </Pressable>
          </View>
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loaded ? <Text style={styles.empty}>No hidden photos.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  lockedRoot: { alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing.xl },
  lockIcon: { fontSize: 40, marginBottom: theme.spacing.md },
  lockTitle: { color: theme.colors.onSurface, fontSize: 22, fontWeight: "700", marginBottom: theme.spacing.sm },
  lockBody: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, textAlign: "center", marginBottom: theme.spacing.lg },
  unlockBtn: {
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: 12,
  },
  unlockBtnText: { color: theme.colors.onPrimaryContainer, fontWeight: "700", fontSize: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 4,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  listContent: { paddingBottom: 40 },
  cell: {
    flex: 1,
    margin: 1,
    aspectRatio: 0.8,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  miniBtn: {
    backgroundColor: "#FFFFFF22",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 6,
  },
  miniBtnText: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "600" },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 60 },
});
