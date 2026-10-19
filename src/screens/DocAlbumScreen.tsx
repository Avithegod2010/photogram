import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { docAlbumDef, DOC_ALBUMS, getDocMedia } from "../lib/docAlbums";
import { MediaRow, setMediaVisibility } from "../db/queries";
import { theme } from "../theme";

// v0.39 Doc albums: browse the OCR-found receipt/document groups. Same grid
// language as ScenesScreen; long-press a cell lets the owner say "not a
// receipt" through the archive shortcut (move to Archive), which is the
// corrective loop for keyword false-positives.
export function DocAlbumScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; Archive: undefined }>;
  route: { params: { key: "receipts" | "documents" } };
}) {
  const insets = useSafeAreaInsets();
  const def = docAlbumDef(route.params.key);
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getDocMedia(route.params.key)
      .then((media) => setRows(media ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, [route.params.key]);

  if (!def) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.empty}>Unknown album.</Text>
      </View>
    );
  }

  const archiveOne = (row: MediaRow) => {
    Alert.alert("Not a match?", `Move this out of "${def.label}" to the Archive?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Move",
        style: "destructive",
        onPress: () => {
          void setMediaVisibility(row.id, "archived")
            .then(() => setRows((prev) => prev.filter((r) => r.id !== row.id)))
            .catch(() => {});
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>{def.label}</Text>
        <Text style={styles.count}>{rows.length > 0 ? `${rows.length}` : ""}</Text>
      </View>
      <Text style={styles.note}>{def.sub}</Text>
      <FlashList
        data={rows}
        numColumns={3}
        masonry
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => (
          <Pressable
            style={styles.cell}
            onPress={() =>
              navigation.navigate("Viewer", {
                ids: rows.map((r) => r.id),
                index: rows.findIndex((r) => r.id === item.id),
              })
            }
            onLongPress={() => archiveOne(item)}
          >
            <Image
              source={{ uri: item.thumb_uri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={`doc-${item.id}`}
              transition={120}
            />
          </Pressable>
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loaded ? (
            <Text style={styles.empty}>
              Nothing found yet — items appear after the scanner reads text in photos (Settings →
              Smarter gallery → Read text in photos).
            </Text>
          ) : null
        }
      />
      <Text style={styles.footer}>
        Long-press any photo to move a wrong match to Archive. Found in all:{" "}
        {DOC_ALBUMS.map((d) => d.label).join(", ")} keyword groups.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { alignItems: "center", justifyContent: "center" },
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
  note: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
  listContent: { paddingBottom: 40, paddingTop: theme.spacing.sm },
  cell: {
    flex: 1,
    margin: 1,
    aspectRatio: 1,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 60, marginHorizontal: theme.spacing.xl, lineHeight: 20 },
  footer: { color: theme.colors.onSurfaceVariant, fontSize: 10.5, marginHorizontal: theme.spacing.md, marginTop: theme.spacing.sm, lineHeight: 14 },
});
