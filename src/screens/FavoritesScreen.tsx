import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listFavorites, MediaRow } from "../db/queries";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  Button,
  EmptyState,
  ErrorState,
  MediaTile,
  Screen,
  Skeleton,
  type MediaStatus,
} from "../ui";

export function FavoritesScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; Slideshow: { ids: number[]; index: number } }>;
}) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    setLoaded(false);
    void listFavorites()
      .then(setRows)
      .catch(() => {
        setRows([]);
        setLoadError(true);
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const renderItem = useCallback(
    ({ item }: { item: MediaRow }) => {
      const date = new Date(item.taken_at).toLocaleDateString();
      const status = item.state === "synced" ? null : (item.state as MediaStatus);
      return (
        <View style={styles.cell}>
          <MediaTile
            uri={item.thumb_uri}
            aspectRatio={1}
            video={item.mime_type.startsWith("video/")}
            favorite
            status={status}
            onPress={() =>
              navigation.navigate("Viewer", {
                ids: rows.map((r) => r.id),
                index: rows.findIndex((r) => r.id === item.id),
              })
            }
            accessibilityLabel={tf("gallery.tileLabel", { date })}
            accessibilityHint={t("viewer.tileHint")}
          />
        </View>
      );
    },
    [navigation, rows]
  );

  return (
    <Screen>
      <AppBar
        title={t("collections.favorites")}
        subtitle={loaded ? tCount("albums.count", rows.length) : t("state.loading")}
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
        actions={
          rows.length > 1 ? (
            <Button
              label={t("album.play")}
              icon="play"
              size="sm"
              onPress={() => navigation.navigate("Slideshow", { ids: rows.map((r) => r.id), index: 0 })}
            />
          ) : null
        }
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read your favorites on this phone."
          retryLabel={t("common.retry")}
          onRetry={load}
        />
      ) : !loaded ? (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton
              key={i}
              width="31%"
              height={110}
              radius={theme.radius.thumb}
              style={styles.skeletonCell}
              label={i === 0 ? t("common.loading") : undefined}
            />
          ))}
        </View>
      ) : (
        <FlashList
          data={rows}
          numColumns={3}
          keyExtractor={(r) => String(r.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="heart-outline"
              title="No favorites yet"
              body="Tap the ♥ on any photo to keep it here."
              actionLabel={t("common.back")}
              onAction={() => navigation.goBack()}
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: theme.spacing.xl },
  cell: { flex: 1, margin: 1 },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing.xs,
  },
  skeletonCell: { margin: 2 },
});
