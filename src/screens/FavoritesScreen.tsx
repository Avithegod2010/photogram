import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listFavorites, MediaRow } from "../db/queries";
import { theme } from "../theme";

export function FavoritesScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void listFavorites()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: MediaRow }) => (
      <Pressable
        style={styles.cell}
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
          recyclingKey={`f-${item.id}`}
          transition={120}
        />
        {item.mime_type.startsWith("video/") ? (
          <View style={styles.videoFlag}>
            <Text style={styles.videoFlagText}>▶</Text>
          </View>
        ) : null}
        <Ionicons name="heart" size={13} style={styles.favIcon} />
        {item.state !== "synced" ? (
          <View style={[styles.stateDot, styles[`dot_${item.state}` as const]]} />
        ) : null}
      </Pressable>
    ),
    [navigation, rows]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Favorites</Text>
        <Text style={styles.count}>{rows.length > 0 ? `${rows.length}` : ""}</Text>
      </View>
      <FlashList
        data={rows}
        numColumns={3}
        masonry
        keyExtractor={(r) => String(r.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.empty}>No favorites yet</Text>
              <Text style={styles.emptyHint}>Tap the ♥ on any photo to keep it here.</Text>
            </View>
          ) : null
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
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700", flex: 1 },
  count: { color: theme.colors.onSurfaceVariant, fontSize: 14 },
  listContent: { paddingBottom: 40, paddingTop: theme.spacing.sm },
  cell: {
    flex: 1,
    margin: 1,
    aspectRatio: 1,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  videoFlag: {
    position: "absolute",
    bottom: 5,
    left: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#00000088",
    alignItems: "center",
    justifyContent: "center",
  },
  videoFlagText: { color: "#FFFFFF", fontSize: 9 },
  favIcon: { position: "absolute", top: 5, left: 5, color: "#EA4335" },
  stateDot: { position: "absolute", bottom: 6, right: 6, width: 8, height: 8, borderRadius: 4 },
  dot_local: { backgroundColor: "#9AA0A6" },
  dot_queued: { backgroundColor: "#FBBC05" },
  dot_uploading: { backgroundColor: "#FBBC05" },
  dot_failed: { backgroundColor: "#EA4335" },
  emptyWrap: { alignItems: "center", marginTop: 60, paddingHorizontal: theme.spacing.xl },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", fontSize: 16 },
  emptyHint: {
    color: theme.colors.onSurfaceVariant,
    textAlign: "center",
    fontSize: 13,
    marginTop: theme.spacing.sm,
    opacity: 0.8,
  },
});
