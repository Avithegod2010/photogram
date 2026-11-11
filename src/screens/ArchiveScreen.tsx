import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listArchived, MediaRow, setMediaVisibility } from "../db/queries";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  EmptyState,
  ErrorState,
  IconButton,
  MediaTile,
  Screen,
  Skeleton,
  type MediaStatus,
} from "../ui";

export function ArchiveScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(() => {
    setLoadError(false);
    void listArchived()
      .then(setRows)
      .catch(() => {
        setRows([]);
        setLoadError(true);
      })
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
    <Screen>
      <AppBar
        title={t("collections.archive")}
        subtitle={loaded ? tCount("albums.count", rows.length) : t("state.loading")}
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the archived items on this phone."
          retryLabel={t("common.retry")}
          onRetry={reload}
        />
      ) : !loaded ? (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton
              key={i}
              width="31%"
              height={132}
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
          renderItem={({ item }) => {
            const date = new Date(item.taken_at).toLocaleDateString();
            const status = item.state === "synced" ? null : (item.state as MediaStatus);
            return (
              <View style={styles.cell}>
                <MediaTile
                  uri={item.thumb_uri}
                  aspectRatio={0.8}
                  video={item.mime_type.startsWith("video/")}
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
                <IconButton
                  icon="arrow-undo-outline"
                  label="Unarchive"
                  variant="onMedia"
                  size={40}
                  onPress={() => void unarchive(item)}
                  style={styles.cellAction}
                />
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="archive-outline"
              title="Nothing archived yet"
              body="Decluttered media is safe in your Telegram cloud and hidden from the main timeline. Long-press photos in the gallery to archive them."
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
  cellAction: {
    position: "absolute",
    bottom: theme.spacing.xs,
    right: theme.spacing.xs,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing.xs,
  },
  skeletonCell: { margin: 2 },
});
