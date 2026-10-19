import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getAlbumMedia } from "../lib/albums";
import { listMyGroups, resolveSenderNames, TelegramGroup } from "../lib/chats";
import { shareAlbumToChat } from "../lib/shareToChat";
import { authenticateLocal } from "../lib/biometrics";
import { useSettingsStore } from "../store/settingsStore";
import { fetchProfile } from "../lib/tdlib";
import {
  getSharedAlbum,
  listAlbumMedia,
  listAlbumTopics,
  setAlbumShowInTimeline,
  AlbumMediaRow,
  AlbumTopicRow,
  MediaRow,
} from "../db/queries";
import { theme } from "../theme";

// Album organizer (shared albums only): optional grouping of the grid with
// full-width section headers, mirroring GalleryScreen's day headers. "all"
// renders the plain grid exactly as before.
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

export function AlbumScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; Slideshow: { ids: number[]; index: number } }>;
  route: { params: { key: string; label: string; sharedAlbumId?: number } };
}) {
  const insets = useSafeAreaInsets();
  const { key, label, sharedAlbumId } = route.params;
  const [rows, setRows] = useState<AlbumMediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [inTimeline, setInTimeline] = useState(false);
  // Forum topic sub-albums (docs/PLAN-S9-TOPICS.md D6): empty for groups
  // without topics — the screen then renders exactly as before.
  const [topics, setTopics] = useState<AlbumTopicRow[]>([]);
  const [activeTopic, setActiveTopic] = useState<string | "all">("all");
  const [totalCount, setTotalCount] = useState(0);
  // Album organizer (shared mode only): chips All / By sender / By month.
  const [groupMode, setGroupMode] = useState<AlbumGroupMode>("all");
  const [senderNames, setSenderNames] = useState<Map<string, string>>(new Map());
  const [ownUserId, setOwnUserId] = useState<string | null>(null);
  // v0.39 "Share album": pick a Telegram group, then queue every local copy
  // in the album for upload to that chat (normal queue, side-effect-free).
  const [shareModal, setShareModal] = useState(false);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [sharing, setSharing] = useState(false);

  // v0.28 Album locks: a locked album shows nothing and loads nothing until
  // the biometric check succeeds (same fail-open semantics as Hidden — with
  // no enrolled biometric the gate opens, so the owner can never be locked
  // out of their own content).
  const lockedKeys = useSettingsStore((s) => s.lockedAlbumKeys);
  const needsUnlock = lockedKeys.includes(key);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (!needsUnlock || unlocked) return;
    void authenticateLocal(`Unlock "${label}"`).then((ok) => {
      if (ok) setUnlocked(true);
      else navigation.goBack();
    });
  }, [needsUnlock, unlocked, key, label, navigation]);

  useEffect(() => {
    if (needsUnlock && !unlocked) return;
    if (sharedAlbumId === undefined) {
      void getAlbumMedia(key)
        .then(setRows)
        .catch(() => setRows([]))
        .finally(() => setLoaded(true));
      return;
    }
    void Promise.all([
      listAlbumMedia(sharedAlbumId, activeTopic === "all" ? undefined : activeTopic),
      listAlbumTopics(sharedAlbumId),
    ])
      .then(([media, topicList]) => {
        setRows(media);
        setTopics(topicList);
      })
      .catch(() => {
        setRows([]);
        setTopics([]);
      })
      .finally(() => setLoaded(true));
  }, [key, sharedAlbumId, activeTopic, needsUnlock, unlocked]);

  // Shared albums: load the "show in my timeline" choice and the album's total
  // item count (the All chip's label must not follow the active topic filter).
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
  // through the SAME mechanism as the Recent-activity feed (resolveSenderNames,
  // cached in lib/chats).
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

  // Grid data with optional full-width section headers (GalleryScreen's day
  // header pattern: header items + overrideItemLayout span). rows arrive
  // newest-first from SQL, so a single pass keeps both the group order (a
  // group's position = its newest item) and the within-group order (taken_at
  // DESC) correct — grouping composes with the active topic filter because it
  // only re-shapes whatever rows are already loaded.
  const data: AlbumGridItem[] = useMemo(() => {
    const media: AlbumGridMedia[] = rows.map((row) => ({ __type: "media", row }));
    if (sharedAlbumId === undefined || groupMode === "all") return media;
    const groups = new Map<string, { label: string; rows: AlbumGridMedia[] }>();
    for (const item of media) {
      let groupKey: string;
      let groupLabel: string;
      if (groupMode === "sender") {
        const senderId = item.row.sender_id ?? "";
        groupKey = senderId;
        groupLabel =
          senderId && senderId === ownUserId ? "You" : (senderNames.get(senderId) ?? "Someone");
      } else {
        const month = monthKeyOf(item.row.taken_at);
        groupKey = month.key;
        groupLabel = month.label;
      }
      const entry = groups.get(groupKey);
      if (entry) entry.rows.push(item);
      else groups.set(groupKey, { label: groupLabel, rows: [item] });
    }
    const withHeaders: AlbumGridItem[] = [];
    groups.forEach((entry, groupKey) => {
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
            <Text style={styles.groupHeaderText}>{item.label}</Text>
            <Text style={styles.groupHeaderCount}>{item.count}</Text>
          </View>
        );
      }
      const row = item.row;
      return (
        <Pressable
          style={styles.cell}
          onPress={() =>
            navigation.navigate("Viewer", {
              ids: rows.map((r) => r.id),
              index: rows.findIndex((r) => r.id === row.id),
            })
          }
        >
          <Image
            source={{ uri: row.thumb_uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`a-${row.id}`}
            transition={120}
          />
          {row.mime_type.startsWith("video/") ? (
            <View style={styles.videoFlag}>
              <Text style={styles.videoFlagText}>▶</Text>
            </View>
          ) : null}
          {row.state !== "synced" ? (
            <View style={[styles.stateDot, styles[`dot_${row.state}` as const]]} />
          ) : null}
        </Pressable>
      );
    },
    [navigation, rows]
  );

  if (needsUnlock && !unlocked) {
    return (
      <View style={[styles.root, styles.lockedRoot, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockTitle}>{label}</Text>
        <Text style={styles.lockBody}>
          Unlock with your fingerprint or face to open this album.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.count}>{rows.length > 0 ? `${rows.length}` : ""}</Text>
        {rows.length >= 2 ? (
          <Pressable
            style={styles.shareBtn}
            hitSlop={8}
            onPress={() => navigation.navigate("Slideshow", { ids: rows.map((r) => r.id), index: 0 })}
          >
            <Text style={styles.shareBtnText}>▶ Play</Text>
          </Pressable>
        ) : null}
        {rows.some((r) => r.local_uri) ? (
          <Pressable
            style={styles.shareBtn}
            hitSlop={8}
            onPress={() => {
              setSharing(false);
              void listMyGroups()
                .then(setGroups)
                .catch(() => setGroups([]))
                .finally(() => setShareModal(true));
            }}
          >
            <Text style={styles.shareBtnText}>⇪ Share</Text>
          </Pressable>
        ) : null}
      </View>
      {sharedAlbumId !== undefined ? (
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Show in my timeline</Text>
            <Text style={styles.toggleNote}>Off = these photos live only in this album</Text>
          </View>
          <Switch value={inTimeline} onValueChange={toggleTimeline} />
        </View>
      ) : null}
      {sharedAlbumId !== undefined && topics.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Pressable
            style={[styles.chip, activeTopic === "all" && styles.chipOn]}
            onPress={() => setActiveTopic("all")}
          >
            <Text style={[styles.chipText, activeTopic === "all" && styles.chipTextOn]}>
              All ({totalCount})
            </Text>
          </Pressable>
          {topics.map((t) => {
            // D4: a hidden General topic with no claimed media is just noise.
            if (t.thread_id === "1" && t.is_hidden === 1 && t.count === 0) return null;
            const selected = activeTopic === t.thread_id;
            return (
              <Pressable
                key={t.thread_id}
                style={[styles.chip, selected && styles.chipOn]}
                onPress={() => setActiveTopic(t.thread_id)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>
                  {t.title}
                  {t.count ? ` · ${t.count}` : ""}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {sharedAlbumId !== undefined ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {(["all", "sender", "month"] as AlbumGroupMode[]).map((mode) => {
            const label = mode === "all" ? "All" : mode === "sender" ? "By sender" : "By month";
            const selected = groupMode === mode;
            return (
              <Pressable
                key={mode}
                style={[styles.chip, selected && styles.chipOn]}
                onPress={() => setGroupMode(mode)}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      <FlashList
        data={data}
        numColumns={3}
        masonry
        keyExtractor={(it) =>
          it.__type === "media" ? String(it.row.id) : (it as AlbumGridHeader).key
        }
        getItemType={(it) => it.__type}
        overrideItemLayout={(layout, it) => {
          // Full-width section headers, same trick as GalleryScreen's day
          // headers (span = numColumns).
          if (it.__type === "groupHeader") {
            layout.span = 3;
          }
        }}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loaded ? <Text style={styles.empty}>No items in this album yet.</Text> : null
        }
      />

      {/* v0.39 share-to-group picker */}
      <Modal visible={shareModal} transparent animationType="fade" onRequestClose={() => setShareModal(false)}>
        <Pressable style={styles.shareBackdrop} onPress={() => setShareModal(false)}>
          <Pressable style={styles.shareCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.shareTitle}>Share "{label}" to a chat</Text>
            <Text style={styles.shareHint}>
              Copies each local photo/video to the picked chat — Telegram storage only, like Saved
              Messages. Uses the normal upload queue.
            </Text>
            {sharing ? (
              <Text style={styles.shareHint}>Queuing…</Text>
            ) : groups.length === 0 ? (
              <Text style={styles.shareHint}>No groups found — create one in Telegram first.</Text>
            ) : (
              groups.map((g) => (
                <Pressable
                  key={g.id}
                  style={styles.shareRow}
                  onPress={() => {
                    Alert.alert(
                      "Share album",
                      `Send ${rows.filter((r) => r.local_uri).length} item${rows.filter((r) => r.local_uri).length === 1 ? "" : "s"} to "${g.title}"?`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Send",
                          onPress: () => {
                            setSharing(true);
                            void shareAlbumToChat(rows, g.id)
                              .then((res) => {
                                setShareModal(false);
                                Alert.alert(
                                  "Queued",
                                  `${res.queued} item${res.queued === 1 ? "" : "s"} will upload to "${g.title}"` +
                                    (res.skipped > 0 ? ` — ${res.skipped} skipped (cloud-only).` : ".")
                                );
                              })
                              .catch(() => Alert.alert("Failed", "Could not queue the share — try again."))
                              .finally(() => setSharing(false));
                          },
                        },
                      ]
                    );
                  }}
                >
                  <Text style={styles.shareRowTitle} numberOfLines={1}>
                    {g.title}
                  </Text>
                  <Text style={styles.shareRowSub}>
                    {g.memberCount !== null ? `${g.memberCount} members` : g.kind}
                  </Text>
                </Pressable>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  // v0.28 locked-album placeholder (Hidden's pattern).
  lockedRoot: { alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing.xl },
  lockIcon: { fontSize: 40, marginBottom: theme.spacing.md },
  lockTitle: { color: theme.colors.onSurface, fontSize: 22, fontWeight: "700", marginBottom: theme.spacing.sm },
  lockBody: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, textAlign: "center" },
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
  // v0.39 share chip + picker modal
  shareBtn: {
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  shareBtnText: { color: theme.colors.onPrimaryContainer, fontSize: 12, fontWeight: "700" },
  shareBackdrop: { flex: 1, backgroundColor: "#000000AA", justifyContent: "center", padding: theme.spacing.xl },
  shareCard: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.lg,
    maxHeight: "70%",
  },
  shareTitle: { color: theme.colors.onSurface, fontSize: 17, fontWeight: "700" },
  shareHint: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 4, marginBottom: theme.spacing.sm },
  shareRow: {
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outlineVariant,
  },
  shareRowTitle: { color: theme.colors.onSurface, fontSize: 14.5, fontWeight: "600" },
  shareRowSub: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: 1 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.md,
  },
  toggleLabel: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "600" },
  toggleNote: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: 1 },
  // Topic sub-album chips (D6), matching the SharedAlbumsScreen mini-chip look.
  chipRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  chip: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chipText: { color: theme.colors.onSurface, fontSize: 12, fontWeight: "600" },
  chipOn: { backgroundColor: theme.colors.primaryContainer },
  chipTextOn: { color: theme.colors.onPrimaryContainer },
  listContent: { paddingBottom: 40, paddingTop: theme.spacing.sm },
  // Album organizer section headers (full-width via overrideItemLayout span).
  groupHeaderWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  groupHeaderText: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "700" },
  groupHeaderCount: { color: theme.colors.onSurfaceVariant, fontSize: 12 },
  cell: {
    flex: 1,
    margin: 1,
    aspectRatio: 1,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  videoFlag: {
    position: "absolute",
    bottom: 5,
    left: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#00000088",
    alignItems: "center",
    justifyContent: "center",
  },
  videoFlagText: { color: "#FFFFFF", fontSize: 9 },
  stateDot: { position: "absolute", bottom: 6, right: 6, width: 8, height: 8, borderRadius: 4 },
  dot_local: { backgroundColor: "#9AA0A6" },
  dot_queued: { backgroundColor: "#FBBC05" },
  dot_uploading: { backgroundColor: "#FBBC05" },
  dot_failed: { backgroundColor: "#EA4335" },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 60 },
});
