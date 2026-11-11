import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getAlbumMedia } from "../lib/albums";
import { setAlbumCover, clearAlbumCover, getAlbumCoverId } from "../lib/albumCovers";
import { listMyGroups, resolveSenderNames, type TelegramGroup } from "../lib/chats";
import { sendPhotoRequest } from "../lib/photoRequest";
import { listAlbumActivity } from "../db/queries";
import { shareAlbumToChat } from "../lib/shareToChat";
import { authenticateLocal } from "../lib/biometrics";
import { useSettingsStore } from "../store/settingsStore";
import { fetchProfile } from "../lib/tdlib";
import {
  getSharedAlbum,
  listAlbumMedia,
  listAlbumTopics,
  setAlbumShowInTimeline,
  type AlbumMediaRow,
  type AlbumTopicRow,
  type AlbumActivityEntry,
} from "../db/queries";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ListRow,
  MediaTile,
  Screen,
  Sheet,
  Skeleton,
  ToggleRow,
  alertDialog,
  confirmDialog,
  type MediaStatus,
} from "../ui";

// Album organizer (shared albums only): optional grouping of the grid with
// full-width section headers, mirroring GalleryScreen's day headers.
type AlbumGroupMode = "all" | "sender" | "month";

interface AlbumGridMedia {
  __type: "media";
  row: AlbumMediaRow;
}

interface AlbumGridHeader {
  __type: "groupHeader";
  key: string;
  label: string;
  count: number;
}

type AlbumGridItem = AlbumGridMedia | AlbumGridHeader;

function monthKeyOf(ts: number): { key: string; label: string } {
  const d = new Date(ts);
  return {
    key: `${d.getFullYear()}-${d.getMonth()}`,
    label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

function timeAgoOf(ts: number): string {
  if (!ts) return "";
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t("time.justNow");
  if (m < 60) return tf("time.minAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return tf("time.hAgo", { count: h });
  const d = Math.floor(h / 24);
  if (d < 30) return tf("time.dAgo", { count: d });
  return new Date(ts).toLocaleDateString();
}

export function AlbumScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{
    Viewer: { ids: number[]; index: number };
    Slideshow: { ids: number[]; index: number };
  }>;
  route: { params: { key: string; label: string; sharedAlbumId?: number } };
}) {
  const { key, label, sharedAlbumId } = route.params;
  const [rows, setRows] = useState<AlbumMediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [inTimeline, setInTimeline] = useState(false);
  // Forum topic sub-albums: empty for groups without topics.
  const [topics, setTopics] = useState<AlbumTopicRow[]>([]);
  const [activeTopic, setActiveTopic] = useState<string | "all">("all");
  const [totalCount, setTotalCount] = useState(0);
  // Album organizer (shared mode only): chips All / By sender / By month.
  const [groupMode, setGroupMode] = useState<AlbumGroupMode>("all");
  const [senderNames, setSenderNames] = useState<Map<string, string>>(new Map());
  // v0.44 activity feed: claims made by the family, newest first.
  const [activity, setActivity] = useState<AlbumActivityEntry[] | null>(null);
  // v0.44 photo requests: a plain prompt into the family chat.
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSubject, setRequestSubject] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  // v0.47 cover picker: the album's hand-picked cover (this album only).
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverId, setCoverId] = useState<number | null>(null);
  const [ownUserId, setOwnUserId] = useState<string | null>(null);
  // v0.39 "Share album": pick a Telegram group, then queue every local copy.
  const [shareModal, setShareModal] = useState(false);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [sharing, setSharing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  // v0.28 Album locks: fail-open semantics — with no enrolled biometric the
  // gate opens, so the owner can never be locked out of their own content.
  const lockedKeys = useSettingsStore((s) => s.lockedAlbumKeys);
  const needsUnlock = lockedKeys.includes(key);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    setCoverId(getAlbumCoverId(key));
  }, [key]);

  const tryUnlock = useCallback(() => {
    void authenticateLocal(`Unlock "${label}"`).then((ok) => {
      if (ok) setUnlocked(true);
      else navigation.goBack();
    });
  }, [label, navigation]);

  useEffect(() => {
    if (!needsUnlock || unlocked) return;
    tryUnlock();
  }, [needsUnlock, unlocked, tryUnlock]);

  const loadRows = useCallback(async () => {
    if (needsUnlock && !unlocked) return;
    setLoadError(false);
    try {
      if (sharedAlbumId === undefined) {
        const media = await getAlbumMedia(key);
        setRows(media);
      } else {
        const [media, topicList] = await Promise.all([
          listAlbumMedia(sharedAlbumId, activeTopic === "all" ? undefined : activeTopic),
          listAlbumTopics(sharedAlbumId),
        ]);
        setRows(media);
        setTopics(topicList);
      }
    } catch {
      setRows([]);
      setTopics([]);
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [key, sharedAlbumId, activeTopic, needsUnlock, unlocked]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // Shared albums: load the timeline choice and the album's total item count
  // (the All chip's label must not follow the active topic filter).
  useEffect(() => {
    if (sharedAlbumId === undefined) return;
    void getSharedAlbum(sharedAlbumId)
      .then((a) => {
        setInTimeline(!!a?.show_in_timeline);
        setTotalCount(a?.count ?? 0);
      })
      .catch(() => {});
  }, [sharedAlbumId]);

  // Sender grouping needs the owner's id ("You") and display names resolved
  // through the SAME mechanism as the Recent-activity feed.
  useEffect(() => {
    if (sharedAlbumId === undefined) return;
    void fetchProfile()
      .then((profile) => {
        const id = (profile as { id?: unknown } | null)?.id;
        if (id !== undefined && id !== null) setOwnUserId(String(id));
      })
      .catch(() => {});
  }, [sharedAlbumId]);

  useEffect(() => {
    if (sharedAlbumId === undefined || groupMode !== "sender") return;
    void resolveSenderNames(rows.map((r) => r.sender_id ?? null))
      .then(setSenderNames)
      .catch(() => setSenderNames(new Map()));
  }, [sharedAlbumId, groupMode, rows]);

  // v0.44 activity feed — refresh on entry and on every rows refresh.
  useEffect(() => {
    if (sharedAlbumId === undefined) return;
    void listAlbumActivity(sharedAlbumId)
      .then((entries) => {
        setActivity(entries);
        return resolveSenderNames(entries.map((e) => e.senderId));
      })
      .then((names) => {
        if (names && names.size > 0) {
          setSenderNames((prev) => {
            const merged = new Map(prev);
            names.forEach((v, k) => merged.set(k, v));
            return merged;
          });
        }
      })
      .catch(() => setActivity([]));
  }, [sharedAlbumId, rows.length]);

  const data: AlbumGridItem[] = useMemo(() => {
    const media: AlbumGridMedia[] = rows.map((row) => ({ __type: "media", row }));
    if (sharedAlbumId === undefined || groupMode === "all") return media;
    const grouped = new Map<string, { label: string; rows: AlbumGridMedia[] }>();
    for (const item of media) {
      let groupKey: string;
      let groupLabel: string;
      if (groupMode === "sender") {
        const senderId = item.row.sender_id ?? "";
        groupKey = senderId;
        groupLabel =
          senderId && senderId === ownUserId
            ? t("album.you")
            : (senderNames.get(senderId) ?? t("album.someone"));
      } else {
        const month = monthKeyOf(item.row.taken_at);
        groupKey = month.key;
        groupLabel = month.label;
      }
      const entry = grouped.get(groupKey);
      if (entry) entry.rows.push(item);
      else grouped.set(groupKey, { label: groupLabel, rows: [item] });
    }
    const withHeaders: AlbumGridItem[] = [];
    grouped.forEach((entry, groupKey) => {
      withHeaders.push({
        __type: "groupHeader",
        key: `h-${groupMode}-${groupKey}`,
        label: entry.label,
        count: entry.rows.length,
      });
      withHeaders.push(...entry.rows);
    });
    return withHeaders;
  }, [rows, sharedAlbumId, groupMode, senderNames, ownUserId]);

  const toggleTimeline = useCallback(
    (value: boolean) => {
      if (sharedAlbumId === undefined) return;
      setInTimeline(value);
      void setAlbumShowInTimeline(sharedAlbumId, value);
    },
    [sharedAlbumId]
  );

  const renderItem = useCallback(
    ({ item }: { item: AlbumGridItem }) => {
      if (item.__type === "groupHeader") {
        return (
          <View style={styles.groupHeaderWrap}>
            <AppText variant="body" weight="semibold">
              {item.label}
            </AppText>
            <AppText variant="caption" color={theme.colors.onSurfaceVariant} tabular>
              {item.count}
            </AppText>
          </View>
        );
      }
      const row = item.row;
      return (
        <View style={styles.cell}>
          <MediaTile
            uri={row.thumb_uri}
            aspectRatio={1}
            video={row.mime_type.startsWith("video/")}
            status={row.state === "synced" ? null : (row.state as MediaStatus)}
            onPress={() =>
              navigation.navigate("Viewer", {
                ids: rows.map((r) => r.id),
                index: rows.findIndex((r) => r.id === row.id),
              })
            }
            accessibilityLabel={tf("gallery.tileLabel", {
              date: new Date(row.taken_at).toLocaleDateString(),
            })}
            accessibilityHint={t("viewer.tileHint")}
          />
        </View>
      );
    },
    [navigation, rows]
  );

  if (needsUnlock && !unlocked) {
    return (
      <Screen>
        <AppBar title={label} large onBack={() => navigation.goBack()} backLabel={t("common.back")} />
        <EmptyState
          icon="lock-closed-outline"
          title={t("album.lockedTitle")}
          body={t("album.lockedBody")}
          actionLabel={t("album.unlock")}
          onAction={tryUnlock}
        />
      </Screen>
    );
  }

  const localCount = rows.filter((r) => r.local_uri).length;

  return (
    <Screen>
      <AppBar
        title={label}
        subtitle={loaded ? tCount("albums.count", rows.length) : t("state.loading")}
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
        actions={
          <>
            {rows.length >= 2 ? (
              <IconButton
                icon="play"
                label={t("album.play")}
                onPress={() => navigation.navigate("Slideshow", { ids: rows.map((r) => r.id), index: 0 })}
              />
            ) : null}
            <IconButton
              icon="ellipsis-horizontal"
              label={t("album.actions")}
              onPress={() => setActionsOpen(true)}
            />
          </>
        }
      />

      {sharedAlbumId !== undefined && topics.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip
            label={`${t("album.all")} · ${totalCount}`}
            selected={activeTopic === "all"}
            onPress={() => setActiveTopic("all")}
          />
          {topics.map((topic) => {
            // D4: a hidden General topic with no claimed media is just noise.
            if (topic.thread_id === "1" && topic.is_hidden === 1 && topic.count === 0) return null;
            return (
              <Chip
                key={topic.thread_id}
                label={topic.count ? `${topic.title} · ${topic.count}` : topic.title}
                selected={activeTopic === topic.thread_id}
                onPress={() => setActiveTopic(topic.thread_id)}
              />
            );
          })}
        </ScrollView>
      ) : null}

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="This album's index could not be read. Your photos are untouched."
          retryLabel={t("common.retry")}
          onRetry={() => void loadRows()}
        />
      ) : !loaded ? (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} width="31%" height={110} radius={theme.radius.thumb} style={styles.skeletonCell} />
          ))}
        </View>
      ) : (
        <FlashList
          data={data}
          numColumns={3}
          keyExtractor={(it) => (it.__type === "media" ? String(it.row.id) : it.key)}
          getItemType={(it) => it.__type}
          overrideItemLayout={(layout, it) => {
            if (it.__type === "groupHeader") layout.span = 3;
          }}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            sharedAlbumId !== undefined && activity !== null && activity.length > 0 ? (
              <View style={styles.activityWrap}>
                <AppText variant="callout" color={theme.colors.onSurfaceVariant} style={styles.activityTitle}>
                  {t("album.recent")}
                </AppText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityRow}>
                  {activity.map((entry) => {
                    const senderName =
                      entry.senderId && entry.senderId === ownUserId
                        ? t("album.you")
                        : (senderNames.get(entry.senderId ?? "") ?? t("album.someone"));
                    return (
                      <Pressable
                        key={`${entry.mediaId}-${entry.addedAt}`}
                        style={({ pressed }) => [styles.activityCard, pressed && styles.pressed]}
                        onPress={() =>
                          navigation.navigate("Viewer", {
                            ids: activity.map((a) => a.mediaId),
                            index: activity.findIndex((a) => a.mediaId === entry.mediaId),
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`${senderName}, ${timeAgoOf(entry.addedAt)}${
                          entry.caption ? `, ${entry.caption}` : ""
                        }`}
                      >
                        {entry.thumb ? (
                          <Image
                            source={{ uri: entry.thumb }}
                            style={styles.activityThumb}
                            contentFit="cover"
                            recyclingKey={`act-${entry.mediaId}`}
                            transition={120}
                            accessible={false}
                          />
                        ) : (
                          <View style={[styles.activityThumb, styles.activityThumbEmpty]} />
                        )}
                        <AppText variant="caption" weight="semibold" numberOfLines={1}>
                          {senderName}
                        </AppText>
                        <AppText variant="caption2Regular" color={theme.colors.onSurfaceVariant} numberOfLines={1}>
                          {timeAgoOf(entry.addedAt)}
                        </AppText>
                        {entry.caption ? (
                          <AppText variant="caption2Regular" color={theme.colors.onSurfaceFaint} numberOfLines={1}>
                            “{entry.caption}”
                          </AppText>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="images-outline"
              title={t("album.empty")}
              body={t("album.emptyBody")}
              actionLabel={sharedAlbumId !== undefined ? t("album.ask") : undefined}
              onAction={
                sharedAlbumId !== undefined
                  ? () => {
                      setRequestSubject("");
                      setRequestOpen(true);
                    }
                  : undefined
              }
            />
          }
        />
      )}

      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title={t("album.actions")} scroll>
        {sharedAlbumId !== undefined ? (
          <>
            <View style={styles.sheetControl}>
              <AppText variant="callout" color={theme.colors.onSurfaceVariant}>
                {t("album.groupBy")}
              </AppText>
              <View style={styles.sheetChips}>
                {(
                  [
                    { mode: "all" as const, label: t("album.all") },
                    { mode: "sender" as const, label: t("album.bySender") },
                    { mode: "month" as const, label: t("album.byMonth") },
                  ]
                ).map((m) => (
                  <Chip
                    key={m.mode}
                    label={m.label}
                    selected={groupMode === m.mode}
                    onPress={() => {
                      setGroupMode(m.mode);
                      setActionsOpen(false);
                    }}
                  />
                ))}
              </View>
            </View>
            <View style={styles.sheetControl}>
              <ToggleRow
                title={t("album.timeline")}
                subtitle={t("album.timelineNote")}
                value={inTimeline}
                onValueChange={toggleTimeline}
                style={styles.sheetToggle}
              />
            </View>
          </>
        ) : null}
        {sharedAlbumId !== undefined ? (
          <ListRow
            title={t("album.ask")}
            icon="camera-outline"
            onPress={() => {
              setActionsOpen(false);
              setRequestSubject("");
              setRequestOpen(true);
            }}
          />
        ) : null}
        {localCount > 0 ? (
          <ListRow
            title={t("album.share")}
            icon="share-social-outline"
            onPress={() => {
              setActionsOpen(false);
              setSharing(false);
              void listMyGroups()
                .then(setGroups)
                .catch(() => setGroups([]))
                .finally(() => setShareModal(true));
            }}
          />
        ) : null}
        {rows.length > 0 ? (
          <ListRow
            title={t("album.cover")}
            icon="image-outline"
            onPress={() => {
              setActionsOpen(false);
              setCoverOpen(true);
            }}
          />
        ) : null}
      </Sheet>

      {/* v0.47 cover picker */}
      <Sheet
        visible={coverOpen}
        onClose={() => setCoverOpen(false)}
        title={t("album.coverTitle")}
        subtitle={t("album.coverHint")}
        scroll
      >
        <View style={styles.coverGrid}>
          <Pressable
            style={[styles.coverCell, styles.coverAuto, coverId === null && styles.coverCellOn]}
            onPress={() => {
              clearAlbumCover(key);
              setCoverId(null);
              setCoverOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${t("album.auto")}, ${coverId === null ? "selected" : ""}`}
          >
            <AppText variant="callout" weight="semibold">
              {t("album.auto")}
            </AppText>
          </Pressable>
          {rows.slice(0, 36).map((r) => (
            <Pressable
              key={r.id}
              style={[styles.coverCell, r.id === coverId && styles.coverCellOn]}
              onPress={() => {
                void setAlbumCover(key, r.id)
                  .then(() => {
                    setCoverId(r.id);
                    setCoverOpen(false);
                  })
                  .catch(() =>
                    void alertDialog({
                      title: "Could not set cover",
                      message: "That photo is no longer available. Try another one.",
                    })
                  );
              }}
              accessibilityRole="button"
              accessibilityLabel={`Use photo from ${new Date(r.taken_at).toLocaleDateString()}`}
            >
              {r.thumb_uri ? (
                <Image
                  source={{ uri: r.thumb_uri }}
                  style={styles.coverImage}
                  contentFit="cover"
                  recyclingKey={`cover-${r.id}`}
                  transition={90}
                  accessible={false}
                />
              ) : (
                <View style={[styles.coverImage, styles.coverEmpty]} />
              )}
            </Pressable>
          ))}
        </View>
      </Sheet>

      {/* v0.44 photo request */}
      <Sheet
        visible={requestOpen}
        onClose={() => setRequestOpen(false)}
        title={t("album.requestTitle")}
        subtitle={t("album.requestHint")}
        scroll
        footer={
          <>
            <Button
              label={t("common.cancel")}
              variant="quiet"
              onPress={() => setRequestOpen(false)}
              disabled={requestBusy}
            />
            <Button
              label={t("album.sendRequest")}
              loading={requestBusy}
              onPress={() => {
                if (sharedAlbumId === undefined) return;
                setRequestBusy(true);
                void (async () => {
                  try {
                    const album = await getSharedAlbum(sharedAlbumId);
                    const chatId = album?.chat_id ?? "";
                    await sendPhotoRequest(chatId, requestSubject);
                    setRequestOpen(false);
                  } catch {
                    void alertDialog({
                      title: "Could not send",
                      message:
                        "The message did not go out — the album may not be linked to its chat yet. Try again after the next sync.",
                    });
                  } finally {
                    setRequestBusy(false);
                  }
                })();
              }}
            />
          </>
        }
      >
        <Input
          value={requestSubject}
          onChangeText={setRequestSubject}
          placeholder={t("album.requestPlaceholder")}
          maxLength={120}
          autoFocus
          accessibilityLabel={t("album.requestTitle")}
        />
      </Sheet>

      {/* v0.39 share-to-group picker */}
      <Sheet
        visible={shareModal}
        onClose={() => setShareModal(false)}
        title={t("album.shareTitle")}
        subtitle={t("album.shareHint")}
        scroll
      >
        {groups.length === 0 ? (
          <AppText variant="body" color={theme.colors.onSurfaceVariant} style={styles.shareEmpty}>
            {t("album.noGroups")}
          </AppText>
        ) : (
          groups.map((g) => (
            <ListRow
              key={g.id}
              title={g.title}
              subtitle={g.memberCount !== null ? `${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` : g.kind}
              disabled={sharing}
              onPress={() => {
                void confirmDialog({
                  title: t("album.share"),
                  message: `Send ${localCount} item${localCount === 1 ? "" : "s"} to “${g.title}”?`,
                  confirmLabel: t("album.send"),
                }).then((ok) => {
                  if (!ok) return;
                  setSharing(true);
                  void shareAlbumToChat(rows, g.id)
                    .then((res) => {
                      setShareModal(false);
                      void alertDialog({
                        title: t("album.queued"),
                        message:
                          `${res.queued} item${res.queued === 1 ? "" : "s"} will upload to “${g.title}”` +
                          (res.skipped > 0 ? ` — ${res.skipped} skipped (cloud-only).` : "."),
                      });
                    })
                    .catch(() => void alertDialog({ title: "Failed", message: "Could not queue the share — try again." }))
                    .finally(() => setSharing(false));
                });
              }}
            />
          ))
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  listContent: { paddingBottom: theme.spacing.xl },
  cell: { flex: 1, margin: 1 },
  groupHeaderWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  activityWrap: { paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.sm },
  activityTitle: { paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.xs },
  activityRow: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
  activityCard: {
    width: 100,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.control,
    padding: theme.spacing.xs,
    gap: 2,
  },
  activityThumb: {
    width: "100%",
    height: 64,
    borderRadius: theme.radius.thumb,
    backgroundColor: theme.colors.surfaceHighest,
    marginBottom: 2,
  },
  activityThumbEmpty: { height: 64 },
  pressed: { opacity: 0.85 },
  coverGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
  coverCell: {
    width: 88,
    height: 88,
    borderRadius: theme.radius.control,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  coverCellOn: { borderWidth: 2, borderColor: theme.colors.accent },
  coverAuto: { alignItems: "center", justifyContent: "center" },
  coverImage: { width: "100%", height: "100%" },
  coverEmpty: { backgroundColor: theme.colors.surfaceHighest },
  shareEmpty: { paddingVertical: theme.spacing.md },
  sheetControl: { paddingBottom: theme.spacing.md, gap: theme.spacing.sm },
  sheetChips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  sheetToggle: { paddingHorizontal: 0 },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: theme.spacing.xs,
    gap: theme.spacing.xs,
  },
  skeletonCell: { margin: 1 },
});
