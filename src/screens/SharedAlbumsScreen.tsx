import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

type SharedNav = NativeStackNavigationProp<{
  Album: { key: string; label: string; sharedAlbumId: number };
}>;

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function SharedAlbumsScreen({ navigation }: { navigation: SharedNav }) {
  const insets = useSafeAreaInsets();
  const [albums, setAlbums] = useState<SharedAlbumRow[] | null>(null);
  const [activity, setActivity] = useState<Array<AlbumActivityItem & { senderName: string }> | null>(null);
  const [picking, setPicking] = useState(false);
  const [groups, setGroups] = useState<TelegramGroup[] | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [progress, setProgress] = useState<ClaimProgress | null>(null);

  const reload = useCallback(() => {
    void listSharedAlbums()
      .then(setAlbums)
      .catch(() => setAlbums([]));
    void listRecentAlbumActivity(12)
      .then(async (items) => {
        const names = await resolveSenderNames(items.map((i) => i.senderId));
        setActivity(items.map((i) => ({ ...i, senderName: names.get(i.senderId ?? "") ?? "Someone" })));
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
          Alert.alert(
            "Shared album ready",
            `Claimed ${p.claimed} new item${p.claimed === 1 ? "" : "s"}${
              p.duplicates ? ` · ${p.duplicates} already in your library` : ""
            }${p.failed ? ` · ${p.failed} failed${p.lastError ? ` — ${p.lastError}` : ""}` : ""}.`
          );
        })
        .catch((err) =>
          Alert.alert("Claim failed", err instanceof Error ? err.message : String(err))
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
      Alert.alert(
        "Link this group?",
        `Everyone in "${group.title}" can already see everything sent to it — Photogram simply shows those photos as an album here.\n\nFamily members keep sending photos the way they do today; Photogram copies them into your library.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: many ? "Link despite size" : "Link album",
            style: "default",
            onPress: () => {
              void (async () => {
                const albumId = await createSharedAlbum(group.title, group.id);
                setPicking(false);
                reload();
                runFirstClaim(albumId, group.title);
              })();
            },
          },
        ]
      );
    },
    [reload, runFirstClaim]
  );

  const reClaim = useCallback(
    (album: SharedAlbumRow) => {
      setClaiming(album.title);
      setProgress({ claimed: 0, duplicates: 0, failed: 0, done: false });
      void claimAlbumMedia(album.id, setProgress)
        .then((p) => {
          Alert.alert(
            "Up to date",
            `Claimed ${p.claimed} new · ${p.duplicates} duplicates · ${p.failed} failed${
              p.lastError ? ` — ${p.lastError}` : ""
            }.`
          );
        })
        .catch((err) =>
          Alert.alert("Claim failed", err instanceof Error ? err.message : String(err))
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
      Alert.alert(
        "Unlink album?",
        `"${album.title}" will disappear from Photogram. The Telegram group and its messages are untouched. Claimed photos already in your library keep their local copies and are never deleted (your storage rule).`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unlink",
            style: "destructive",
            onPress: () => {
              void deleteSharedAlbum(album.id).then(reload);
            },
          },
        ]
      );
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

  const pickerContent = () => (
    <ScrollView style={styles.pickerWrap} contentContainerStyle={styles.pickerContent}>
      <Text style={styles.pickerTitle}>Pick a Telegram group</Text>
      <Text style={styles.pickerNote}>
        One group = one album. Everyone in the group can see everything sent to it.
      </Text>
      {groups === null ? (
        <Text style={styles.pickerEmpty}>Loading your groups…</Text>
      ) : groups.length === 0 ? (
        <Text style={styles.pickerEmpty}>
          No groups found. Create a private group in Telegram with your family first, then come back.
        </Text>
      ) : (
        groups.map((g) => (
          <Pressable key={g.id} style={styles.groupRow} onPress={() => linkGroup(g)}>
            <View style={styles.groupText}>
              <Text style={styles.groupName} numberOfLines={1}>
                {g.title}
              </Text>
              <Text style={styles.groupSub}>
                {g.kind === "supergroup" ? "Group" : "Group"}
                {g.memberCount ? ` · ${g.memberCount} members` : ""}
              </Text>
            </View>
            {(g.memberCount ?? 0) > 10 ? <Text style={styles.caution}>⚠ many members</Text> : null}
          </Pressable>
        ))
      )}
      <Pressable style={styles.cancelBtn} onPress={() => setPicking(false)}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Shared albums</Text>
        <Pressable style={styles.addBtn} onPress={openPicker} hitSlop={6}>
          <Text style={styles.addText}>+ Link group</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>
        Family sends photos to a private Telegram group — Photogram claims them here. Album-only by
        default; each album can opt into your timeline.
      </Text>

      {activity !== null && activity.length > 0 && !picking ? (
        <View style={styles.activityCard}>
          <Text style={styles.activityTitle}>Recent activity</Text>
          {activity.slice(0, 5).map((item) => (
            <View key={`${item.mediaId}-${item.addedAt}`} style={styles.activityRow}>
              <Image
                source={{ uri: item.thumbUri }}
                style={styles.activityThumb}
                contentFit="cover"
                recyclingKey={`act-${item.mediaId}`}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityText} numberOfLines={1}>
                  <Text style={styles.activityName}>{item.senderName}</Text> added a photo to{" "}
                  <Text style={styles.activityName}>{item.albumTitle}</Text>
                </Text>
                <Text style={styles.activityTime}>{timeAgo(item.addedAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {claiming ? (
        <View style={styles.claimBanner}>
          <Text style={styles.claimText}>
            Claiming "{claiming}"… {progress ? `${progress.claimed} new · ${progress.duplicates} dup` : ""}
          </Text>
        </View>
      ) : null}

      {picking ? (
        pickerContent()
      ) : (
        <FlashList
          data={albums ?? []}
          numColumns={2}
          keyExtractor={(a) => String(a.id)}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() =>
                navigation.navigate("Album", {
                  key: `shared-${item.id}`,
                  label: item.title,
                  sharedAlbumId: item.id,
                })
              }
            >
              <View style={styles.coverWrap}>
                {item.cover ? (
                  <Image
                    source={{ uri: item.cover }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={150}
                  />
                ) : (
                  <Text style={styles.coverEmpty}>No photos claimed yet</Text>
                )}
              </View>
              <Text style={styles.cardLabel} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.cardCount}>
                {item.count} item{item.count === 1 ? "" : "s"}
                {item.show_in_timeline ? " · in timeline" : ""}
              </Text>
              <View style={styles.cardActions}>
                <Pressable style={styles.miniBtn} onPress={() => reClaim(item)}>
                  <Text style={styles.miniBtnText}>⟳ Claim new</Text>
                </Pressable>
                <Pressable style={[styles.miniBtn, styles.dangerBtn]} onPress={() => unlink(item)}>
                  <Text style={[styles.miniBtnText, styles.dangerText]}>Unlink</Text>
                </Pressable>
              </View>
            </Pressable>
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            albums !== null && albums.length === 0 ? (
              <Text style={styles.empty}>
                No shared albums yet. Tap "+ Link group" and pick your family's Telegram group.
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 4,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700", flex: 1 },
  addBtn: {
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addText: { color: theme.colors.onPrimaryContainer, fontSize: 12.5, fontWeight: "700" },
  note: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12.5,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  claimBanner: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  activityCard: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  activityTitle: { color: theme.colors.onSurface, fontSize: 13, fontWeight: "700", marginBottom: 8 },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  activityThumb: { width: 34, height: 34, borderRadius: 8, backgroundColor: theme.colors.surfaceHighest },
  activityText: { color: theme.colors.onSurfaceVariant, fontSize: 12.5 },
  activityName: { color: theme.colors.onSurface, fontWeight: "600" },
  activityTime: { color: theme.colors.onSurfaceVariant, fontSize: 10.5, marginTop: 1 },
  claimText: { color: theme.colors.onSurface, fontSize: 13 },
  listContent: { padding: theme.spacing.sm, paddingBottom: 40 },
  card: { flex: 1, margin: theme.spacing.sm, flexBasis: "45%" },
  coverWrap: {
    aspectRatio: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
    alignItems: "center",
    justifyContent: "center",
  },
  coverEmpty: { color: theme.colors.onSurfaceVariant, fontSize: 11, textAlign: "center", padding: 8 },
  cardLabel: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "600", marginTop: theme.spacing.sm },
  cardCount: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  cardActions: { flexDirection: "row", gap: 6, marginTop: 6 },
  miniBtn: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  dangerBtn: { backgroundColor: theme.colors.errorContainer },
  miniBtnText: { color: theme.colors.onSurface, fontSize: 10.5, fontWeight: "600" },
  dangerText: { color: theme.colors.error },
  pickerWrap: { padding: theme.spacing.md },
  pickerContent: { paddingBottom: theme.spacing.lg },
  pickerTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: "700" },
  pickerNote: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 4, marginBottom: theme.spacing.md },
  pickerEmpty: { color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: theme.spacing.md },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  groupText: { flex: 1 },
  groupName: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "600" },
  groupSub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  caution: { color: theme.colors.error, fontSize: 11, marginLeft: 8 },
  cancelBtn: { alignSelf: "center", padding: theme.spacing.md },
  cancelText: { color: theme.colors.primary, fontWeight: "600" },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 60, paddingHorizontal: theme.spacing.lg },
});
