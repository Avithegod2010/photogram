import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listArchived, MediaRow, setMediaVisibility } from "../db/queries";
import { theme } from "../theme";

export function ArchiveScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    void listArchived()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", reload);
    return unsub;
  }, [navigation, reload]);

  const unarchive = useCallback(async (row: MediaRow) => {
    await setMediaVisibility(row.id, "visible");
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Archive</Text>
      </View>
      <Text style={styles.note}>
        Decluttered media — safe in your Telegram cloud, hidden from the main timeline.
      </Text>
      <FlashList
        data={rows}
        numColumns={3}
        masonry
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() =>
                navigation.navigate("Viewer", {
                  ids: rows.map((r) => r.id),
                  index: rows.findIndex((r) => r.id === item.id),
                })
              }
            >
              <Image
                source={{ uri: item.thumb_uri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={`ar-${item.id}`}
                transition={120}
              />
            </Pressable>
            <Pressable style={styles.miniBtn} onPress={() => void unarchive(item)}>
              <Text style={styles.miniBtnText}>Unarchive</Text>
            </Pressable>
          </View>
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loaded ? <Text style={styles.empty}>Nothing archived yet.</Text> : null
        }
      />
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
    paddingBottom: 4,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  note: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12.5,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
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
