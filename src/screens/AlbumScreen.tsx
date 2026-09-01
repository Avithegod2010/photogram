import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getAlbumMedia } from "../lib/albums";
import {
  getSharedAlbum,
  listAlbumMedia,
  listAlbumTopics,
  setAlbumShowInTimeline,
  AlbumTopicRow,
  MediaRow,
} from "../db/queries";
import { theme } from "../theme";

export function AlbumScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
  route: { params: { key: string; label: string; sharedAlbumId?: number } };
}) {
  const insets = useSafeAreaInsets();
  const { key, label, sharedAlbumId } = route.params;
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [inTimeline, setInTimeline] = useState(false);
  // Forum topic sub-albums (docs/PLAN-S9-TOPICS.md D6): empty for groups
  // without topics — the screen then renders exactly as before.
  const [topics, setTopics] = useState<AlbumTopicRow[]>([]);
  const [activeTopic, setActiveTopic] = useState<string | "all">("all");
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (sharedAlbumId === undefined) {
      void getAlbumMedia(key)
        .then(setRows)
        .catch(() => setRows([]))
        .finally(() => setLoaded(true));
      return;
    }
    void Promise.all([
      listAlbumMedia(sharedAlbumId, activeTopic === "all" ? undefined : activeTopic),
      listAlbumTopics(sharedAlbumId),
    ])
      .then(([media, topicList]) => {
        setRows(media);
        setTopics(topicList);
      })
      .catch(() => {
        setRows([]);
        setTopics([]);
      })
      .finally(() => setLoaded(true));
  }, [key, sharedAlbumId, activeTopic]);

  // Shared albums: load the "show in my timeline" choice and the album's total
  // item count (the All chip's label must not follow the active topic filter).
  useEffect(() => {
    if (sharedAlbumId === undefined) return;
    void getSharedAlbum(sharedAlbumId)
      .then((a) => {
        setInTimeline(!!a?.show_in_timeline);
        setTotalCount(a?.count ?? 0);
      })
      .catch(() => {});
  }, [sharedAlbumId]);

  const toggleTimeline = useCallback(
    (value: boolean) => {
      if (sharedAlbumId === undefined) return;
      setInTimeline(value);
      void setAlbumShowInTimeline(sharedAlbumId, value);
    },
    [sharedAlbumId]
  );

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
          recyclingKey={`a-${item.id}`}
          transition={120}
        />
        {item.mime_type.startsWith("video/") ? (
          <View style={styles.videoFlag}>
            <Text style={styles.videoFlagText}>▶</Text>
          </View>
        ) : null}
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
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.count}>{rows.length > 0 ? `${rows.length}` : ""}</Text>
      </View>
      {sharedAlbumId !== undefined ? (
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Show in my timeline</Text>
            <Text style={styles.toggleNote}>Off = these photos live only in this album</Text>
          </View>
          <Switch value={inTimeline} onValueChange={toggleTimeline} />
        </View>
      ) : null}
      {sharedAlbumId !== undefined && topics.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Pressable
            style={[styles.chip, activeTopic === "all" && styles.chipOn]}
            onPress={() => setActiveTopic("all")}
          >
            <Text style={[styles.chipText, activeTopic === "all" && styles.chipTextOn]}>
              All ({totalCount})
            </Text>
          </Pressable>
          {topics.map((t) => {
            // D4: a hidden General topic with no claimed media is just noise.
            if (t.thread_id === "1" && t.is_hidden === 1 && t.count === 0) return null;
            const selected = activeTopic === t.thread_id;
            return (
              <Pressable
                key={t.thread_id}
                style={[styles.chip, selected && styles.chipOn]}
                onPress={() => setActiveTopic(t.thread_id)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>
                  {t.title}
                  {t.count ? ` · ${t.count}` : ""}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      <FlashList
        data={rows}
        numColumns={3}
        masonry
        keyExtractor={(r) => String(r.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loaded ? <Text style={styles.empty}>No items in this album yet.</Text> : null
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.md,
  },
  toggleLabel: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "600" },
  toggleNote: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: 1 },
  // Topic sub-album chips (D6), matching the SharedAlbumsScreen mini-chip look.
  chipRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  chip: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chipText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: "600" },
  chipOn: { backgroundColor: theme.colors.primaryContainer },
  chipTextOn: { color: theme.colors.onPrimaryContainer },
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
  stateDot: { position: "absolute", bottom: 6, right: 6, width: 8, height: 8, borderRadius: 4 },
  dot_local: { backgroundColor: "#9AA0A6" },
  dot_queued: { backgroundColor: "#FBBC05" },
  dot_uploading: { backgroundColor: "#FBBC05" },
  dot_failed: { backgroundColor: "#EA4335" },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 60 },
});
