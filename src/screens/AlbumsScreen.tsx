import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getAutoAlbums, type AutoAlbum } from "../lib/albums";
import { authenticateLocal, canUseBiometrics } from "../lib/biometrics";
import { useSettingsStore } from "../store/settingsStore";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Badge,
  EmptyState,
  ErrorState,
  IconButton,
  PressableScale,
  Screen,
  Skeleton,
} from "../ui";

export function AlbumsScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Album: { key: string; label: string } }>;
}) {
  const [albums, setAlbums] = useState<AutoAlbum[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // v0.28 Album locks: per-album biometric gate. Locking needs the device to
  // have enrolled biometrics (same requirement as the Hidden lock); removing
  // a lock asks for biometrics so a peeker can't just switch it off.
  const lockedKeys = useSettingsStore((s) => s.lockedAlbumKeys);
  const setAlbumLocked = useSettingsStore((s) => s.setAlbumLocked);
  const pinnedKeys = useSettingsStore((s) => s.pinnedAlbumKeys);
  const setAlbumPinned = useSettingsStore((s) => s.setAlbumPinned);
  const [bioReady, setBioReady] = useState(false);

  useEffect(() => {
    void canUseBiometrics().then(({ hardware, enrolled }) => setBioReady(hardware && enrolled));
  }, []);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const list = await getAutoAlbums();
      setAlbums(list);
    } catch {
      setAlbums([]);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      void load();
    });
    return unsub;
  }, [navigation, load]);

  const sorted = useMemo(
    () =>
      [...(albums ?? [])].sort(
        (a, b) => (pinnedKeys.includes(b.key) ? 1 : 0) - (pinnedKeys.includes(a.key) ? 1 : 0)
      ),
    [albums, pinnedKeys]
  );

  const toggleLock = (album: AutoAlbum) => {
    if (!bioReady) return;
    if (lockedKeys.includes(album.key)) {
      void authenticateLocal(`Remove the lock from "${album.label}"`).then((ok) => {
        if (ok) setAlbumLocked(album.key, false);
      });
    } else {
      setAlbumLocked(album.key, true);
    }
  };

  return (
    <Screen>
      <AppBar
        title={t("albums.title")}
        subtitle={t("albums.note")}
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />
      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the auto-albums on this phone."
          retryLabel={t("common.retry")}
          onRetry={() => void load()}
        />
      ) : albums === null ? (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.skeletonCell}>
              <Skeleton width="100%" height={150} radius={theme.radius.card} />
              <Skeleton width="70%" height={16} />
              <Skeleton width="40%" height={12} />
            </View>
          ))}
        </View>
      ) : (
        <FlashList
          data={sorted}
          numColumns={2}
          keyExtractor={(a) => a.key}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="albums-outline"
              title={t("albums.empty.title")}
              body={t("albums.empty.body")}
              actionLabel={t("albums.empty.action")}
              onAction={() => navigation.goBack()}
            />
          }
          renderItem={({ item }) => {
            const pinned = pinnedKeys.includes(item.key);
            const locked = lockedKeys.includes(item.key);
            return (
              <View style={styles.cell}>
                <PressableScale
                  onPress={() => navigation.navigate("Album", { key: item.key, label: item.label })}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label}, ${tCount("albums.count", item.count)}${
                    pinned ? `, ${t("albums.pinned")}` : ""
                  }${locked ? ", locked" : ""}`}
                  style={styles.card}
                  contentStyle={styles.cardContent}
                >
                  <View style={styles.coverWrap}>
                    {item.coverThumb ? (
                      <Image
                        source={{ uri: item.coverThumb }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        recyclingKey={`album-${item.key}`}
                        cachePolicy="memory-disk"
                        transition={120}
                        accessible={false}
                      />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
                        <Ionicons name="images-outline" size={32} color={theme.colors.onSurfaceFaint} importantForAccessibility="no" />
                      </View>
                    )}
                    <IconButton
                      icon={locked ? "lock-closed" : "lock-open-outline"}
                      label={
                        !bioReady
                          ? t("albums.lockUnavailable")
                          : locked
                            ? t("albums.unlock")
                            : t("albums.lock")
                      }
                      variant="onMedia"
                      size={40}
                      disabled={!bioReady}
                      selected={locked}
                      onPress={() => toggleLock(item)}
                      style={styles.lockButton}
                    />
                  </View>
                  <View style={styles.labelRow}>
                    <AppText variant="body" weight="semibold" numberOfLines={1} style={styles.label}>
                      {item.label}
                    </AppText>
                    <Pressable
                      onPress={() => setAlbumPinned(item.key, !pinned)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={pinned ? t("albums.unpin") : t("albums.pin")}
                      accessibilityState={{ selected: pinned }}
                      style={styles.pinButton}
                    >
                      <Ionicons
                        name={pinned ? "pin" : "pin-outline"}
                        size={18}
                        color={pinned ? theme.colors.accent : theme.colors.onSurfaceVariant}
                      />
                    </Pressable>
                  </View>
                  <View style={styles.metaRow}>
                    <AppText variant="caption" color={theme.colors.onSurfaceVariant}>
                      {tCount("albums.count", item.count)}
                    </AppText>
                    {pinned ? <Badge label={t("albums.pinned")} tone="accent" icon="pin" /> : null}
                  </View>
                </PressableScale>
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.xl },
  cell: { flex: 1, padding: theme.spacing.sm },
  card: { flex: 1 },
  cardContent: { flex: 1, flexDirection: "column", alignItems: "stretch" },
  coverWrap: {
    aspectRatio: 1,
    borderRadius: theme.radius.card,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  lockButton: { position: "absolute", top: theme.spacing.xs, right: theme.spacing.xs },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    marginTop: theme.spacing.sm,
  },
  label: { flex: 1 },
  pinButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.xs,
    marginTop: -theme.spacing.xs,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing.sm,
  },
  skeletonCell: { width: "50%", padding: theme.spacing.sm, gap: theme.spacing.sm },
});
