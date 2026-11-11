import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listHidden, MediaRow, setMediaVisibility } from "../db/queries";
import { unlockHiddenAlbum } from "../lib/biometrics";
import { useSettingsStore } from "../store/settingsStore";
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

export function HiddenScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const lockEnabled = useSettingsStore((s) => s.hiddenLockEnabled);
  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [locked, setLocked] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadRows = useCallback(() => {
    setLoadError(false);
    void listHidden()
      .then(setRows)
      .catch(() => {
        setRows([]);
        setLoadError(true);
      })
      .finally(() => setLoaded(true));
  }, []);

  // The gallery grid stays mounted behind the lock — data is only fetched and
  // rendered after the biometric check succeeds (or is disabled/unavailable).
  const unlock = useCallback(async () => {
    if (lockEnabled) {
      const ok = await unlockHiddenAlbum();
      if (!ok) return;
    }
    setLocked(false);
    loadRows();
  }, [lockEnabled, loadRows]);

  useEffect(() => {
    void unlock();
  }, [unlock]);

  const unhide = useCallback(async (row: MediaRow) => {
    await setMediaVisibility(row.id, "visible");
    setRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
  }, []);

  if (locked) {
    return (
      <Screen>
        <AppBar
          title={t("collections.hidden")}
          large
          onBack={() => navigation.goBack()}
          backLabel={t("common.back")}
        />
        <EmptyState
          icon="lock-closed-outline"
          title="Hidden album"
          body={
            lockEnabled
              ? "Unlock with your fingerprint or face to view hidden photos."
              : "Opening hidden photos…"
          }
          actionLabel="Unlock"
          onAction={() => void unlock()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar
        title={t("collections.hidden")}
        subtitle={
          loaded ? tCount("albums.count", rows?.length ?? 0) : t("state.loading")
        }
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the hidden items on this phone."
          retryLabel={t("common.retry")}
          onRetry={loadRows}
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
          data={rows ?? []}
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
                      ids: (rows ?? []).map((r) => r.id),
                      index: (rows ?? []).findIndex((r) => r.id === item.id),
                    })
                  }
                  accessibilityLabel={tf("gallery.tileLabel", { date })}
                  accessibilityHint={t("viewer.tileHint")}
                />
                <IconButton
                  icon="eye-outline"
                  label="Unhide"
                  variant="onMedia"
                  size={40}
                  onPress={() => void unhide(item)}
                  style={styles.cellAction}
                />
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="eye-off-outline"
              title="No hidden photos"
              body="Photos you hide from the gallery are locked here behind your fingerprint or face."
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
