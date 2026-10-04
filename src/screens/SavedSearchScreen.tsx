import React, { useEffect, useState } from "react";
import { Alert, Dimensions, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { deleteSavedSearch, getSavedSearch, MediaRow } from "../db/queries";
import { runSearch } from "../lib/search";
import { theme } from "../theme";

// v0.27 Smart albums: a saved search rendered as an auto-updating collection.
// Every open re-runs the query through the normal search pipeline (runSearch),
// so the grid always reflects the library as it is right now.
export function SavedSearchScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
  route: { params: { id: number } };
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<MediaRow[] | null>(null);

  useEffect(() => {
    void (async () => {
      const saved = await getSavedSearch(route.params.id).catch(() => null);
      if (!saved) {
        Alert.alert("Search removed", "This saved search no longer exists.");
        navigation.goBack();
        return;
      }
      setName(saved.name);
      setQuery(saved.query);
      setRows(await runSearch(saved.query).catch(() => []));
    })();
  }, [route.params.id, navigation]);

  const confirmDelete = () => {
    Alert.alert(
      "Remove saved search?",
      `"${name}" disappears from Collections. Your photos are not touched.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void deleteSavedSearch(route.params.id).finally(() => navigation.goBack());
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {name || "Smart album"}
          </Text>
          <Text style={styles.sub}>Auto-updating · search "{query}"</Text>
        </View>
        <Pressable onPress={confirmDelete} hitSlop={10}>
          <Text style={styles.trash}>🗑</Text>
        </Pressable>
      </View>

      {rows === null ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Searching…</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>No photos match right now.</Text>
          <Text style={styles.centerSub}>
            This collection updates automatically as your library changes.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          numColumns={3}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item, index }) => (
            <Pressable
              style={styles.cell}
              onPress={() => navigation.navigate("Viewer", { ids: rows.map((r) => r.id), index })}
            >
              <Image
                source={{ uri: item.thumb_uri }}
                style={styles.cellImg}
                contentFit="cover"
                transition={120}
                recyclingKey={`ss-${item.id}`}
              />
            </Pressable>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const CELL = Math.floor(Dimensions.get("window").width / 3) - 2;

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
  title: { color: theme.colors.onSurface, fontSize: 20, fontWeight: "700" },
  sub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  trash: { fontSize: 18 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl },
  centerText: { color: theme.colors.onSurfaceVariant, fontSize: 14.5, textAlign: "center" },
  centerSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 6, textAlign: "center" },
  listContent: { paddingBottom: 32 },
  cell: { width: CELL, height: CELL, margin: 1, backgroundColor: theme.colors.surfaceContainer },
  cellImg: { width: "100%", height: "100%" },
});
