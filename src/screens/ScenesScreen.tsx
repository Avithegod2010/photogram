import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MediaRow } from "../db/queries";
import { Scene, getSceneMedia, getSceneOverview } from "../lib/scenes";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Chip,
  EmptyState,
  ErrorState,
  MediaTile,
  Screen,
  Skeleton,
  type MediaStatus,
} from "../ui";

// v0.36 scene auto-albums: curated scenes ("Beach days", "Food", …) rendered
// like albums, auto-built from the on-device ML tags vibe search already
// indexes (no new ML, no migration). Counts and the grid re-run on every
// open, exactly like the smart albums.
export function ScenesScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const [overview, setOverview] = useState<{ scene: Scene; count: number }[] | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [rowsError, setRowsError] = useState(false);

  const loadOverview = useCallback(() => {
    setOverviewError(false);
    setOverview(null);
    void getSceneOverview()
      .then((ov) => {
        setOverview(ov);
        const firstNonEmpty = ov.find((o) => o.count > 0) ?? ov[0];
        if (firstNonEmpty) setSelectedKey(firstNonEmpty.scene.key);
      })
      .catch(() => {
        setOverview([]);
        setOverviewError(true);
      });
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const loadRows = useCallback((key: string) => {
    setRows(null);
    setRowsError(false);
    void getSceneMedia(key)
      .then((media) => setRows(media ?? []))
      .catch(() => {
        setRows([]);
        setRowsError(true);
      });
  }, []);

  useEffect(() => {
    if (!selectedKey) return;
    loadRows(selectedKey);
  }, [selectedKey, loadRows]);

  const selectedScene = overview?.find((o) => o.scene.key === selectedKey)?.scene ?? null;
  const mediaRows = rows ?? [];

  return (
    <Screen>
      <AppBar
        title={t("collections.scenes")}
        subtitle="Auto-built from photo tags · updates live"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
        bottom={
          overview && overview.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {overview.map(({ scene, count }) => (
                <Chip
                  key={scene.key}
                  label={`${scene.title} · ${count}`}
                  selected={scene.key === selectedKey}
                  onPress={() => setSelectedKey(scene.key)}
                  accessibilityLabel={`${scene.title}, ${tCount("albums.count", count)}`}
                />
              ))}
            </ScrollView>
          ) : null
        }
      />

      {overviewError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the scene counts on this phone."
          retryLabel={t("common.retry")}
          onRetry={loadOverview}
        />
      ) : overview === null ? (
        <View style={styles.skeletonWrap}>
          <Skeleton width="55%" height={18} label={t("common.loading")} />
          <View style={styles.skeletonGrid}>
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton
                key={i}
                width="31%"
                height={110}
                radius={theme.radius.thumb}
                style={styles.skeletonCell}
              />
            ))}
          </View>
        </View>
      ) : overview.length === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title="No scene albums yet"
          body="Scene albums are built from on-device photo tags. Turn on smart tags in Settings → Search, then scan your library."
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      ) : (
        <>
          {selectedScene ? (
            <AppText
              variant="callout"
              color={theme.colors.onSurfaceVariant}
              style={styles.sceneSub}
            >
              {selectedScene.sub}
            </AppText>
          ) : null}

          {rowsError ? (
            <ErrorState
              title={t("state.error")}
              body="This scene's photos could not be read. Try again."
              retryLabel={t("common.retry")}
              onRetry={() => {
                if (selectedKey) loadRows(selectedKey);
                else loadOverview();
              }}
            />
          ) : rows === null ? (
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
          ) : mediaRows.length === 0 ? (
            <EmptyState
              icon="sparkles-outline"
              title="No photos in this album yet"
              body="Scene albums fill in as photo scans add tags (Search → AI tags on)."
              actionLabel={t("common.back")}
              onAction={() => navigation.goBack()}
            />
          ) : (
            <FlashList
              data={mediaRows}
              numColumns={3}
              keyExtractor={(r) => String(r.id)}
              renderItem={({ item, index }) => {
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
                          ids: mediaRows.map((r) => r.id),
                          index,
                        })
                      }
                      accessibilityLabel={tf("gallery.tileLabel", { date })}
                      accessibilityHint={t("viewer.tileHint")}
                    />
                  </View>
                );
              }}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { gap: theme.spacing.sm, paddingRight: theme.spacing.md },
  sceneSub: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm },
  listContent: { paddingBottom: theme.spacing.xl },
  cell: { flex: 1, margin: 1 },
  skeletonWrap: { paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", padding: theme.spacing.xs },
  skeletonCell: { margin: 2 },
});
