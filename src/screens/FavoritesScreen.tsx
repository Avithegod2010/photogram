import React, { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listFavorites, MediaRow } from "../db/queries";
import { theme } from "../theme";
import { t, tCount, mediaTileLabel } from "../lib/i18n";
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
  // The list is reloaded every time this screen gets focus, because the heart can
  // be tapped in the Viewer that sits on top of it. The first load owns the
  // skeleton; later reloads are silent so the grid never flashes.
  const hasLoaded = useRef(false);

  const load = useCallback((silent: boolean) => {
    if (!silent) setLoaded(false);
    setLoadError(false);
    void listFavorites()
      .then(setRows)
      .catch(() => {
        // A silent refresh keeps what is already on screen: a slightly stale grid
        // beats replacing the user's favorites with an error page.
        if (silent) return;
        setRows([]);
        setLoadError(true);
      })
      .finally(() => setLoaded(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(hasLoaded.current);
      hasLoaded.current = true;
    }, [load])
  );

  // The retry button is an explicit request, so it may show the skeleton again.
  const retry = useCallback(() => load(false), [load]);

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
            accessibilityLabel={mediaTileLabel(date, item.mime_type.startsWith("video/"))}
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
          body={t("favorites.errorBody")}
          retryLabel={t("common.retry")}
          onRetry={retry}
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
              title={t("favorites.emptyTitle")}
              body={t("favorites.emptyBody")}
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
