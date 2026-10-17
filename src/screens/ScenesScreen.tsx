import React, { useEffect, useState } from "react";
import { Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MediaRow } from "../db/queries";
import { Scene, SCENES, getSceneMedia, getSceneOverview } from "../lib/scenes";
import { theme } from "../theme";

// v0.36 scene auto-albums: curated scenes ("Beach days", "Food", …) rendered
// like albums, auto-built from the on-device ML tags vibe search already
// indexes (no new ML, no migration). Counts and the grid re-run on every
// open, exactly like the smart albums.
export function ScenesScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [overview, setOverview] = useState<{ scene: Scene; count: number }[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rows, setRows] = useState<MediaRow[] | null>(null);

  useEffect(() => {
    void (async () => {
      const ov = await getSceneOverview().catch(() => []);
      setOverview(ov);
      const firstNonEmpty = ov.find((o) => o.count > 0) ?? ov[0];
      if (firstNonEmpty) setSelectedKey(firstNonEmpty.scene.key);
    })();
  }, []);

  useEffect(() => {
    if (!selectedKey) return;
    setRows(null);
    void (async () => {
      const media = await getSceneMedia(selectedKey).catch(() => null);
      if (media) setRows(media);
    })();
  }, [selectedKey]);

  const selectedScene = overview?.find((o) => o.scene.key === selectedKey)?.scene ?? null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Scene albums</Text>
          <Text style={styles.sub}>Auto-built from photo tags · updates live</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {(overview ?? SCENES.map((scene) => ({ scene, count: 0 }))).map(({ scene, count }) => {
          const active = scene.key === selectedKey;
          return (
            <Pressable
              key={scene.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setSelectedKey(scene.key)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {scene.title} · {count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {selectedScene ? (
        <View style={styles.sceneHeader}>
          <Text style={styles.sceneTitle}>{selectedScene.title}</Text>
          <Text style={styles.sceneSub}>{selectedScene.sub}</Text>
        </View>
      ) : null}

      {overview === null ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Looking at your library.</Text>
        </View>
      ) : rows === null ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Loading photos.</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>No photos in this album yet.</Text>
          <Text style={styles.centerSub}>
            Scene albums fill in as photo scans add tags (Search → AI tags on).
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
                recyclingKey={`sc-${item.id}`}
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
    paddingBottom: theme.spacing.xs,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 22, fontWeight: "700" },
  sub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  chips: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  chip: {
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceContainer,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipText: { color: theme.colors.onSurfaceVariant, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: theme.colors.onPrimary },
  sceneHeader: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  sceneTitle: { color: theme.colors.onSurface, fontSize: 15.5, fontWeight: "600" },
  sceneSub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl },
  centerText: { color: theme.colors.onSurfaceVariant, fontSize: 14.5, textAlign: "center" },
  centerSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 6, textAlign: "center" },
  listContent: { paddingBottom: 32 },
  cell: { width: CELL, height: CELL, margin: 1, backgroundColor: theme.colors.surfaceContainer },
  cellImg: { width: "100%", height: "100%" },
});
