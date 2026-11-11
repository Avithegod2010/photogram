import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { claimAlbumMedia, ClaimProgress } from "../lib/claimer";
import { listMyGroups, resolveSenderNames, TelegramGroup } from "../lib/chats";
import {
  createSharedAlbum,
  deleteSharedAlbum,
  listRecentAlbumActivity,
  AlbumActivityItem,
  listSharedAlbums,
  SharedAlbumRow,
} from "../db/queries";
import { theme } from "../theme";
import { t, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  PressableScale,
  Screen,
  Section,
  Sheet,
  Skeleton,
  alertDialog,
  confirmDialog,
} from "../ui";

type SharedNav = NativeStackNavigationProp<{
  Album: { key: string; label: string; sharedAlbumId: number };
}>;

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return tf("time.minAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tf("time.hAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t("time.yesterday") : tf("time.dAgo", { count: days });
}

export function SharedAlbumsScreen({ navigation }: { navigation: SharedNav }) {
  const [albums, setAlbums] = useState<SharedAlbumRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [activity, setActivity] = useState<Array<AlbumActivityItem & { senderName: string }> | null>(null);
  const [picking, setPicking] = useState(false);
  const [groups, setGroups] = useState<TelegramGroup[] | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [progress, setProgress] = useState<ClaimProgress | null>(null);

  const reload = useCallback(() => {
    setLoadError(false);
    void listSharedAlbums()
      .then(setAlbums)
      .catch(() => {
        setAlbums([]);
        setLoadError(true);
      });
    void listRecentAlbumActivity(12)
      .then(async (items) => {
        const names = await resolveSenderNames(items.map((i) => i.senderId));
        setActivity(items.map((i) => ({ ...i, senderName: names.get(i.senderId ?? "") ?? t("album.someone") })));
      })
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", reload);
    return unsub;
  }, [navigation, reload]);

  const runFirstClaim = useCallback(
    (albumId: number, title: string) => {
      setClaiming(title);
      setProgress({ claimed: 0, duplicates: 0, failed: 0, done: false });
      void claimAlbumMedia(albumId, setProgress)
        .then((p) => {
          void alertDialog({
            title: "Shared album ready",
            message: `Claimed ${p.claimed} new item${p.claimed === 1 ? "" : "s"}${
              p.duplicates ? ` · ${p.duplicates} already in your library` : ""
            }${p.failed ? ` · ${p.failed} failed${p.lastError ? ` — ${p.lastError}` : ""}` : ""}.`,
          });
        })
        .catch((err) =>
          void alertDialog({
            title: "Claim failed",
            message: err instanceof Error ? err.message : String(err),
          })
        )
        .finally(() => {
          setClaiming(null);
          setProgress(null);
          reload();
        });
    },
    [reload]
  );

  const linkGroup = useCallback(
    (group: TelegramGroup) => {
      const many = (group.memberCount ?? 0) > 10;
      void confirmDialog({
        title: "Link this group?",
        message: `Everyone in "${group.title}" can already see everything sent to it — Photogram simply shows those photos as an album here.\n\nFamily members keep sending photos the way they do today; Photogram copies them into your library.`,
        confirmLabel: many ? "Link despite size" : "Link album",
      }).then((ok) => {
        if (!ok) return;
        void (async () => {
          const albumId = await createSharedAlbum(group.title, group.id);
          setPicking(false);
          reload();
          runFirstClaim(albumId, group.title);
        })();
      });
    },
    [reload, runFirstClaim]
  );

  const reClaim = useCallback(
    (album: SharedAlbumRow) => {
      setClaiming(album.title);
      setProgress({ claimed: 0, duplicates: 0, failed: 0, done: false });
      void claimAlbumMedia(album.id, setProgress)
        .then((p) => {
          void alertDialog({
            title: "Up to date",
            message: `Claimed ${p.claimed} new · ${p.duplicates} duplicates · ${p.failed} failed${
              p.lastError ? ` — ${p.lastError}` : ""
            }.`,
          });
        })
        .catch((err) =>
          void alertDialog({
            title: "Claim failed",
            message: err instanceof Error ? err.message : String(err),
          })
        )
        .finally(() => {
          setClaiming(null);
          setProgress(null);
          reload();
        });
    },
    [reload]
  );

  const unlink = useCallback(
    (album: SharedAlbumRow) => {
      void confirmDialog({
        title: "Unlink album?",
        message: `"${album.title}" will disappear from Photogram. The Telegram group and its messages are untouched. Claimed photos already in your library keep their local copies and are never deleted (your storage rule).`,
        confirmLabel: "Unlink",
        destructive: true,
      }).then((ok) => {
        if (!ok) return;
        void deleteSharedAlbum(album.id).then(reload);
      });
    },
    [reload]
  );

  const openPicker = useCallback(() => {
    setPicking(true);
    setGroups(null);
    void listMyGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  return (
    <Screen>
      <AppBar
        title="Shared albums"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
        actions={
          <Button
            label="Link group"
            size="sm"
            variant="secondary"
            icon="add"
            onPress={openPicker}
          />
        }
      />

      <View style={styles.noteWrap}>
        <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
          Family sends photos to a private Telegram group — Photogram claims them here. Album-only
          by default; each album can opt into your timeline.
        </AppText>
      </View>

      {claiming ? (
        <View style={styles.statusStrip}>
          <AppText
            variant="footnote"
            color={theme.colors.onSurfaceVariant}
            accessibilityLiveRegion="polite"
          >
            {`Claiming “${claiming}”… `}
            {progress ? `${progress.claimed} new · ${progress.duplicates} dup` : ""}
          </AppText>
        </View>
      ) : null}

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the shared albums on this phone. Nothing was changed."
          retryLabel={t("common.retry")}
          onRetry={() => reload()}
        />
      ) : albums === null ? (
        <View
          style={styles.skeletonGrid}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading shared albums"
        >
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
          style={styles.fill}
          data={albums}
          numColumns={2}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            activity !== null && activity.length > 0 && !picking ? (
              <View style={styles.activityHeader}>
                <Section title="Recent activity" icon="time-outline" style={styles.activitySection}>
                  {activity.slice(0, 5).map((item) => (
                    <ListRow
                      key={`${item.mediaId}-${item.addedAt}`}
                      title={`${item.senderName} added a photo`}
                      subtitle={`${item.albumTitle} · ${timeAgo(item.addedAt)}`}
                      leading={
                        <Image
                          source={{ uri: item.thumbUri }}
                          style={styles.activityThumb}
                          contentFit="cover"
                          recyclingKey={`act-${item.mediaId}`}
                          accessible={false}
                        />
                      }
                    />
                  ))}
                </Section>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="No shared albums yet"
              body="One family Telegram group = one album here. Link the group and Photogram claims the photos sent to it."
              actionLabel="Link a group"
              onAction={openPicker}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <View style={styles.card}>
                <PressableScale
                  onPress={() =>
                    navigation.navigate("Album", {
                      key: `shared-${item.id}`,
                      label: item.title,
                      sharedAlbumId: item.id,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${item.count} item${
                    item.count === 1 ? "" : "s"
                  }${item.show_in_timeline ? ", shown in your timeline" : ""}`}
                  accessibilityHint="Opens this shared album."
                  style={styles.cardOpen}
                  contentStyle={styles.cardOpenContent}
                >
                  <View style={styles.coverWrap}>
                    {item.cover ? (
                      <Image
                        source={{ uri: item.cover }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={150}
                        recyclingKey={`shared-${item.id}`}
                        cachePolicy="memory-disk"
                        accessible={false}
                      />
                    ) : (
                      <AppText
                        variant="captionRegular"
                        color={theme.colors.onSurfaceFaint}
                        align="center"
                        style={styles.coverEmpty}
                      >
                        No photos claimed yet
                      </AppText>
                    )}
                  </View>
                  <AppText
                    variant="body"
                    weight="semibold"
                    numberOfLines={1}
                    style={styles.cardTitle}
                  >
                    {item.title}
                  </AppText>
                  <AppText
                    variant="captionRegular"
                    color={theme.colors.onSurfaceVariant}
                    numberOfLines={1}
                  >
                    {item.count} item{item.count === 1 ? "" : "s"}
                    {item.show_in_timeline ? " · in timeline" : ""}
                  </AppText>
                </PressableScale>
                <View style={styles.cardActions}>
                  <Button
                    label="Claim new"
                    size="sm"
                    variant="secondary"
                    icon="refresh"
                    fullWidth
                    onPress={() => reClaim(item)}
                    accessibilityLabel={`Claim new photos into ${item.title}`}
                  />
                  <Button
                    label="Unlink"
                    size="sm"
                    variant="danger"
                    icon="unlink-outline"
                    fullWidth
                    onPress={() => unlink(item)}
                    accessibilityLabel={`Unlink ${item.title}`}
                  />
                </View>
              </View>
            </View>
          )}
        />
      )}

      <Sheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Pick a Telegram group"
        subtitle="One group = one album. Everyone in the group can see everything sent to it."
        scroll
        footer={
          <Button label={t("common.cancel")} variant="quiet" onPress={() => setPicking(false)} />
        }
      >
        {groups === null ? (
          <View
            style={styles.sheetSkeleton}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading your Telegram groups"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={56} radius={theme.radius.control} />
            ))}
          </View>
        ) : groups.length === 0 ? (
          <EmptyState
            compact
            icon="people-outline"
            title="No groups found"
            body="Create a private group in Telegram with your family first, then come back."
          />
        ) : (
          groups.map((g) => {
            const many = (g.memberCount ?? 0) > 10;
            return (
              <ListRow
                key={g.id}
                title={g.title}
                subtitle={`${g.kind === "supergroup" ? "Supergroup" : "Group"}${
                  g.memberCount ? ` · ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` : ""
                }${many ? " · many members" : ""}`}
                accessory="chevron"
                onPress={() => linkGroup(g)}
                accessibilityLabel={`${g.title}, ${g.kind === "supergroup" ? "supergroup" : "group"}${
                  g.memberCount ? `, ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` : ""
                }${many ? ", large group" : ""}`}
                accessibilityHint="Links this group as a shared album."
              />
            );
          })
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  noteWrap: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  statusStrip: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  activityHeader: { paddingHorizontal: theme.spacing.sm },
  activitySection: { marginBottom: theme.spacing.sm },
  activityThumb: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.thumb,
    backgroundColor: theme.colors.surfaceHighest,
  },
  listContent: {
    paddingHorizontal: theme.spacing.sm,
    paddingBottom: theme.spacing.xl,
  },
  cell: { flex: 1, padding: theme.spacing.sm },
  card: {
    flex: 1,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.card,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  cardOpen: { flex: 1 },
  cardOpenContent: {
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
  },
  coverWrap: {
    aspectRatio: 1,
    borderRadius: theme.radius.control,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
    alignItems: "center",
    justifyContent: "center",
  },
  coverEmpty: { padding: theme.spacing.sm },
  cardTitle: { marginTop: theme.spacing.sm },
  cardActions: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  sheetSkeleton: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing.sm,
  },
  skeletonCell: { width: "50%", padding: theme.spacing.sm, gap: theme.spacing.sm },
});
