import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { docAlbumDef, DOC_ALBUMS, getDocMedia } from "../lib/docAlbums";
import { MediaRow, setMediaVisibility } from "../db/queries";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  EmptyState,
  ErrorState,
  MediaTile,
  Screen,
  Skeleton,
  confirmDialog,
  type MediaStatus,
} from "../ui";

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
  const def = docAlbumDef(route.params.key);
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    setLoaded(false);
    void getDocMedia(route.params.key)
      .then((media) => setRows(media ?? []))
      .catch(() => {
        setRows([]);
        setLoadError(true);
      })
      .finally(() => setLoaded(true));
  }, [route.params.key]);

  useEffect(() => {
    load();
  }, [load]);

  if (!def) {
    return (
      <Screen>
        <AppBar
          title="Unknown album"
          large
          onBack={() => navigation.goBack()}
          backLabel={t("common.back")}
        />
        <EmptyState
          icon="document-text-outline"
          title="Unknown album"
          body="This document album is no longer available."
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  const albumLabel = def.label;
  const archiveOne = (row: MediaRow) => {
    void confirmDialog({
      title: "Not a match?",
      message: `Move this out of "${albumLabel}" to the Archive?`,
      confirmLabel: "Move",
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      void setMediaVisibility(row.id, "archived")
        .then(() => setRows((prev) => prev.filter((r) => r.id !== row.id)))
        .catch(() => {});
    });
  };

  return (
    <Screen>
      <AppBar
        title={def.label}
        subtitle={
          loaded
            ? `${tCount("albums.count", rows.length)} · ${def.sub}`
            : t("state.loading")
        }
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read this album's index on this phone."
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
          renderItem={({ item }) => {
            const date = new Date(item.taken_at).toLocaleDateString();
            const status = item.state === "synced" ? null : (item.state as MediaStatus);
            return (
              <View style={styles.cell}>
                <MediaTile
                  uri={item.thumb_uri}
                  aspectRatio={1}
                  video={item.mime_type.startsWith("video/")}
                  status={status}
                  onPress={() =>
                    navigation.navigate("Viewer", {
                      ids: rows.map((r) => r.id),
                      index: rows.findIndex((r) => r.id === item.id),
                    })
                  }
                  onLongPress={() => archiveOne(item)}
                  accessibilityLabel={tf("gallery.tileLabel", { date })}
                  accessibilityHint="Long-press to move a wrong match to Archive"
                />
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            rows.length > 0 ? (
              <AppText
                variant="caption2Regular"
                color={theme.colors.onSurfaceFaint}
                style={styles.footer}
              >
                Long-press any photo to move a wrong match to Archive. Found in all:{" "}
                {DOC_ALBUMS.map((d) => d.label).join(", ")} keyword groups.
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title="Nothing found yet"
              body="Items appear after the scanner reads text in photos (Settings → Smarter gallery → Read text in photos)."
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
  footer: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing.xs,
  },
  skeletonCell: { margin: 2 },
});
