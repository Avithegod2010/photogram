import React, { useEffect, useRef, useState } from "react";
import { Alert, Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { countMissingAnalysis, MediaRow } from "../db/queries";
import { DuplicateGroup, backfillAnalysis, findDuplicateGroups, findSimilarTo } from "../lib/similar";
import { mergeDuplicateGroup } from "../lib/merge";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";

// v0.24 "Find similar" / visual duplicate finder (docs: the similarity engine
// is src/lib/similar.ts). Two modes: "similar" ranks photos close to one
// anchor photo; "groups" (Collections entry) lists same-day near-duplicate
// groups. Both make sure the library is hashed first — a one-time indexing
// pass with visible progress.
export function SimilarScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
  route: { params?: { mode?: "similar" | "groups"; mediaId?: number } };
}) {
  const mode = route.params?.mode ?? "groups";
  const mediaId = route.params?.mediaId ?? 0;
  const insets = useSafeAreaInsets();
  const cancelRef = useRef({ cancelled: false });
  // Hashed-so-far while the one-time indexing pass runs; null when idle.
  const [indexing, setIndexing] = useState<number | null>(null);
  const [similar, setSimilar] = useState<MediaRow[] | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  // v0.36 duplicate merge: active picker state (group + chosen keeper).
  const [merging, setMerging] = useState<{ group: DuplicateGroup; keeperId: number } | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  useEffect(() => {
    cancelRef.current = { cancelled: false };
    void (async () => {
      try {
        if ((await countMissingAnalysis()) > 0) {
          setIndexing(0);
          await backfillAnalysis((processed) => setIndexing(processed), cancelRef.current);
        }
      } catch {}
      setIndexing(null);
      if (cancelRef.current.cancelled) return;
      if (mode === "similar") {
        setSimilar(await findSimilarTo(mediaId).catch(() => []));
      } else {
        setGroups(await findDuplicateGroups().catch(() => []));
      }
    })();
    return () => {
      cancelRef.current.cancelled = true;
    };
  }, [mode, mediaId]);

  const startMerge = (group: DuplicateGroup) => {
    setMerging({ group, keeperId: group.items[0].id });
  };

  const confirmMerge = () => {
    if (!merging || mergeBusy) return;
    const { group, keeperId } = merging;
    const others = group.items.filter((r) => r.id !== keeperId);
    const bytes = others.reduce((sum, r) => sum + r.byte_size, 0);
    Alert.alert(
      "Merge duplicates?",
      `Keeping 1 photo. The other ${others.length} move${others.length === 1 ? "s" : ""} to Trash — ` +
        `about ${formatBytes(bytes)}. The 30-day trash count-down applies, and the purge ` +
        `afterwards also clears their Telegram copies.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => setMerging(null) },
        {
          text: "Move to Trash",
          style: "destructive",
          onPress: () => {
            setMergeBusy(true);
            void mergeDuplicateGroup(group, keeperId)
              .then(() => {
                setGroups((prev) => (prev ? prev.filter((g) => g !== group) : prev));
              })
              .finally(() => {
                setMergeBusy(false);
                setMerging(null);
              });
          },
        },
      ]
    );
  };

  const sub =
    indexing !== null
      ? `Indexing your photos. ${indexing} done so far`
      : merging
      ? "Reading the group."
      : mode === "similar"
      ? "Photos that look like the one you opened"
      : groups !== null
      ? `${groups.length} group${groups.length === 1 ? "" : "s"} · same-day near-duplicates`
      : "Looking for near-duplicates…";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{mode === "similar" ? "Similar photos" : "Find duplicates"}</Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
      </View>

      {indexing !== null ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Indexing photos for visual search…</Text>
          <Text style={styles.centerSub}>{indexing} done — this runs only once.</Text>
        </View>
      ) : mode === "similar" ? (
        similar === null ? (
          <View style={styles.center}>
            <Text style={styles.centerText}>Comparing.</Text>
          </View>
        ) : similar.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.centerText}>No similar photos found.</Text>
          </View>
        ) : (
          <FlatList
            data={similar}
            numColumns={3}
            keyExtractor={(r) => String(r.id)}
            renderItem={({ item, index }) => (
              <Pressable
                style={styles.cell}
                onPress={() => navigation.navigate("Viewer", { ids: similar.map((r) => r.id), index })}
              >
                <Image
                  source={{ uri: item.thumb_uri }}
                  style={styles.cellImg}
                  contentFit="cover"
                  transition={120}
                  recyclingKey={`sim-${item.id}`}
                />
              </Pressable>
            )}
            contentContainerStyle={styles.listContent}
          />
        )
      ) : merging !== null ? (
        <View style={styles.pickerRoot}>
          <Text style={styles.pickerTitle}>Choose the keeper</Text>
          <Text style={styles.pickerSub}>
            Tap a photo to keep it — the rest of the group moves to Trash.
          </Text>
          <View style={styles.pickerRow}>
            {merging.group.items.map((r) => {
              const isKeeper = r.id === merging.keeperId;
              return (
                <Pressable
                  key={String(r.id)}
                  style={[styles.pickerCell, isKeeper && styles.pickerSelected]}
                  onPress={() => setMerging({ ...merging, keeperId: r.id })}
                  disabled={mergeBusy}
                >
                  <Image
                    source={{ uri: r.thumb_uri }}
                    style={styles.pickerImg}
                    contentFit="cover"
                    transition={120}
                    recyclingKey={`keep-${r.id}`}
                  />
                  {isKeeper ? (
                    <View style={styles.pickerBadge}>
                      <Text style={styles.pickerBadgeText}>KEEP</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.mergeButtons}>
            <Pressable
              style={[styles.mergeBtn, mergeBusy && styles.mergeBtnDisabled]}
              onPress={() => setMerging(null)}
              disabled={mergeBusy}
            >
              <Text style={styles.mergeBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.mergeBtnDanger, mergeBusy && styles.mergeBtnDisabled]}
              onPress={confirmMerge}
              disabled={mergeBusy}
            >
              <Text style={styles.mergeBtnDangerText}>
                {mergeBusy ? "Working…" : "Move rest to Trash"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : groups === null ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Looking…</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>No near-duplicates found — nice and tidy.</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => String(g.items[0].id)}
          renderItem={({ item }) => (
            <GroupCard
              group={item}
              onOpen={(index) =>
                navigation.navigate("Viewer", { ids: item.items.map((r) => r.id), index })
              }
              onMerge={() => startMerge(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

function GroupCard({
  group,
  onOpen,
  onMerge,
}: {
  group: DuplicateGroup;
  onOpen: (index: number) => void;
  onMerge: () => void;
}) {
  const leader = group.items[0];
  const bytes = group.items.reduce((sum, r) => sum + r.byte_size, 0);
  return (
    <View style={styles.groupCard}>
      <View style={styles.groupHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.groupTitle}>
            {group.items.length} near-identical · {new Date(leader.taken_at).toLocaleDateString()}
          </Text>
          <Text style={styles.groupSub}>
            Largest: {formatBytes(leader.byte_size)} · group total {formatBytes(bytes)}
          </Text>
        </View>
        <Pressable style={styles.groupMergeBtn} onPress={onMerge}>
          <Text style={styles.groupMergeText}>Merge</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupRow}>
        {group.items.map((r, i) => (
          <Pressable key={String(r.id)} onPress={() => onOpen(i)}>
            <Image
              source={{ uri: r.thumb_uri }}
              style={styles.groupThumb}
              contentFit="cover"
              transition={120}
              recyclingKey={`dup-${r.id}`}
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const CELL = Math.floor(Dimensions.get("window").width / 3) - 2;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 22, fontWeight: "700" },
  sub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl },
  centerText: { color: theme.colors.onSurfaceVariant, fontSize: 14.5, textAlign: "center" },
  centerSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 6, textAlign: "center" },
  listContent: { paddingBottom: 32 },
  cell: { width: CELL, height: CELL, margin: 1, backgroundColor: theme.colors.surfaceContainer },
  cellImg: { width: "100%", height: "100%" },
  groupCard: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    marginHorizontal: theme.spacing.lg,
  },
  groupTitle: { color: theme.colors.onSurface, fontSize: 14.5, fontWeight: "600" },
  groupSub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2, marginBottom: theme.spacing.sm },
  groupRow: { gap: 6, paddingVertical: 2 },
  groupThumb: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceHighest,
  },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  groupMergeBtn: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  groupMergeText: { color: theme.colors.primary, fontSize: 13, fontWeight: "700" },
  pickerRoot: { flex: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm },
  pickerTitle: { color: theme.colors.onSurface, fontSize: 17, fontWeight: "700" },
  pickerSub: { color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 4 },
  pickerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: theme.spacing.md,
  },
  pickerCell: {
    width: 132,
    height: 132,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "transparent",
  },
  pickerSelected: { borderColor: theme.colors.primary },
  pickerImg: { width: "100%", height: "100%" },
  pickerBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pickerBadgeText: { color: theme.colors.onPrimary, fontSize: 10, fontWeight: "800" },
  mergeButtons: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  mergeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceContainer,
  },
  mergeBtnDanger: {
    flex: 2,
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
  },
  mergeBtnDisabled: { opacity: 0.5 },
  mergeBtnText: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "600" },
  mergeBtnDangerText: { color: theme.colors.onPrimary, fontSize: 14, fontWeight: "700" },
});
