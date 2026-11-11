import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { countMissingAnalysis, type MediaRow } from "../db/queries";
import {
  backfillAnalysis,
  findDuplicateGroups,
  findSimilarTo,
  type DuplicateGroup,
} from "../lib/similar";
import { mergeDuplicateGroup } from "../lib/merge";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";
import { t, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  MediaTile,
  ProgressBar,
  Screen,
  Section,
  Sheet,
  Skeleton,
  confirmDialog,
} from "../ui";

// v0.24 "Find similar" / visual duplicate finder (docs: the similarity engine
// is src/lib/similar.ts). Two modes: "similar" ranks photos close to an
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
  const cancelRef = useRef({ cancelled: false });
  // Hashed-so-far while the one-time indexing pass runs; null when idle.
  const [indexing, setIndexing] = useState<number | null>(null);
  const [indexTotal, setIndexTotal] = useState(0);
  const [similar, setSimilar] = useState<MediaRow[] | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // v0.36 duplicate merge: active picker state (group + chosen keeper).
  const [merging, setMerging] = useState<{ group: DuplicateGroup; keeperId: number } | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  const loadResults = useCallback(async () => {
    setLoadError(false);
    try {
      if (mode === "similar") {
        setSimilar(await findSimilarTo(mediaId));
      } else {
        setGroups(await findDuplicateGroups());
      }
    } catch {
      if (mode === "similar") setSimilar([]);
      else setGroups([]);
      setLoadError(true);
    }
  }, [mode, mediaId]);

  useEffect(() => {
    cancelRef.current = { cancelled: false };
    void (async () => {
      try {
        const missing = await countMissingAnalysis();
        if (missing > 0) {
          setIndexTotal(missing);
          setIndexing(0);
          await backfillAnalysis((processed) => setIndexing(processed), cancelRef.current);
        }
      } catch {}
      setIndexing(null);
      if (cancelRef.current.cancelled) return;
      await loadResults();
    })();
    return () => {
      cancelRef.current.cancelled = true;
    };
  }, [loadResults]);

  const startMerge = (group: DuplicateGroup) => {
    setMerging({ group, keeperId: group.items[0].id });
  };

  const confirmMerge = useCallback(() => {
    if (!merging || mergeBusy) return;
    const { group, keeperId } = merging;
    const others = group.items.filter((r) => r.id !== keeperId);
    const bytes = others.reduce((sum, r) => sum + r.byte_size, 0);
    void confirmDialog({
      title: "Merge duplicates?",
      message:
        `Keeping 1 photo. The other ${others.length} move${others.length === 1 ? "s" : ""} to Trash — ` +
        `about ${formatBytes(bytes)}. The 30-day trash count-down applies, and the purge ` +
        `afterwards also clears their Telegram copies.`,
      confirmLabel: "Move to Trash",
      destructive: true,
    }).then((ok) => {
      if (!ok) {
        setMerging(null);
        return;
      }
      setMergeBusy(true);
      void mergeDuplicateGroup(group, keeperId)
        .then(() => {
          setGroups((prev) => (prev ? prev.filter((g) => g !== group) : prev));
        })
        .finally(() => {
          setMergeBusy(false);
          setMerging(null);
        });
    });
  }, [merging, mergeBusy]);

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
    <Screen>
      <AppBar
        title={mode === "similar" ? "Similar photos" : "Find duplicates"}
        subtitle={sub}
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {indexing !== null ? (
        <View style={styles.stateBlock}>
          <ProgressBar
            progress={indexTotal > 0 ? indexing / indexTotal : 0}
            label="Indexing photos for visual search"
            valueText={`${indexing} of ${indexTotal} indexed — this runs only once`}
            live
          />
          <Skeleton width="70%" height={14} style={styles.gapTop} />
          <Skeleton width="45%" height={14} />
        </View>
      ) : loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't compare these photos. Nothing was changed."
          retryLabel={t("common.retry")}
          onRetry={() => void loadResults()}
        />
      ) : mode === "similar" ? (
        similar === null ? (
          <View style={styles.skeletonGrid}>
            {Array.from({ length: 9 }).map((_, i) => (
              <View key={i} style={styles.skeletonCell}>
                <Skeleton width="100%" height={110} radius={theme.radius.thumb} />
              </View>
            ))}
          </View>
        ) : similar.length === 0 ? (
          <EmptyState
            icon="images-outline"
            title="No similar photos found"
            body="Nothing in the library looks close to this one right now."
            actionLabel={t("common.back")}
            onAction={() => navigation.goBack()}
          />
        ) : (
          <FlashList
            data={similar}
            numColumns={3}
            keyExtractor={(r) => String(r.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => {
              const status = item.state === "synced" ? null : item.state;
              const date = new Date(item.taken_at).toLocaleDateString();
              return (
                <View style={styles.cell}>
                  <MediaTile
                    uri={item.thumb_uri}
                    aspectRatio={1}
                    status={status}
                    onPress={() =>
                      navigation.navigate("Viewer", { ids: similar.map((r) => r.id), index })
                    }
                    accessibilityLabel={tf("gallery.tileLabel", { date })}
                  />
                </View>
              );
            }}
          />
        )
      ) : groups === null ? (
        <View style={styles.groupSkeletons}>
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} style={styles.groupSkeleton}>
              <Skeleton width="55%" height={16} />
              <Skeleton width="75%" height={12} />
              <View style={styles.groupSkeletonRow}>
                <Skeleton width={72} height={72} radius={theme.radius.control} />
                <Skeleton width={72} height={72} radius={theme.radius.control} />
                <Skeleton width={72} height={72} radius={theme.radius.control} />
              </View>
            </View>
          ))}
        </View>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="No near-duplicates found"
          body="Nothing to clean up — every photo in your library looks distinct."
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      ) : (
        <FlashList
          data={groups}
          keyExtractor={(g) => String(g.items[0].id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <GroupCard
              group={item}
              onOpen={(index) =>
                navigation.navigate("Viewer", { ids: item.items.map((r) => r.id), index })
              }
              onMerge={() => startMerge(item)}
            />
          )}
        />
      )}

      <Sheet
        visible={merging !== null}
        onClose={() => {
          if (!mergeBusy) setMerging(null);
        }}
        title="Choose the keeper"
        subtitle="Tap a photo to keep it — the rest of the group moves to Trash."
        scroll
        footer={
          <>
            <Button
              label={t("common.cancel")}
              variant="quiet"
              disabled={mergeBusy}
              onPress={() => setMerging(null)}
            />
            <Button
              label="Move rest to Trash"
              variant="danger"
              loading={mergeBusy}
              disabled={mergeBusy}
              onPress={confirmMerge}
            />
          </>
        }
      >
        {merging !== null ? (
          <View style={styles.keeperRow}>
            {merging.group.items.map((r) => {
              const isKeeper = r.id === merging.keeperId;
              return (
                <Pressable
                  key={String(r.id)}
                  onPress={() => setMerging({ ...merging, keeperId: r.id })}
                  disabled={mergeBusy}
                  accessibilityRole="radio"
                  accessibilityLabel={`Keep ${r.file_name ?? "this photo"}`}
                  accessibilityState={{ checked: isKeeper, disabled: mergeBusy || undefined }}
                  style={[styles.keeperCell, isKeeper && styles.keeperSelected]}
                >
                  <Image
                    source={{ uri: r.thumb_uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={120}
                    recyclingKey={`keep-${r.id}`}
                    accessible={false}
                  />
                  {isKeeper ? (
                    <Badge
                      label="Keeper"
                      tone="accent"
                      icon="checkmark-circle"
                      style={styles.keeperBadge}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <AppText variant="captionRegular" color={theme.colors.onSurfaceFaint} style={styles.sheetNote}>
          Nothing is deleted now — the rest goes to Trash for 30 days and can be restored.
        </AppText>
      </Sheet>
    </Screen>
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
    <Section
      style={styles.groupSection}
      title={`${group.items.length} near-identical · ${new Date(leader.taken_at).toLocaleDateString()}`}
      subtitle={`Largest: ${formatBytes(leader.byte_size)} · group total ${formatBytes(bytes)}`}
      action={
        <Button
          label="Merge"
          size="sm"
          variant="secondary"
          icon="git-merge-outline"
          onPress={onMerge}
        />
      }
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {group.items.map((r, i) => (
          <View key={String(r.id)} style={styles.stripCell}>
            <MediaTile
              uri={r.thumb_uri}
              aspectRatio={1}
              onPress={() => onOpen(i)}
              accessibilityLabel={tf("gallery.tileLabel", {
                date: new Date(r.taken_at).toLocaleDateString(),
              })}
            />
          </View>
        ))}
      </ScrollView>
    </Section>
  );
}

const styles = StyleSheet.create({
  stateBlock: { padding: theme.spacing.md, gap: theme.spacing.xs },
  gapTop: { marginTop: theme.spacing.md },
  listContent: { paddingBottom: theme.spacing.xl },
  cell: { flex: 1, margin: 1 },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", padding: theme.spacing.xs },
  skeletonCell: { width: "33.33%", padding: 2 },
  groupSkeletons: { padding: theme.spacing.md, gap: theme.spacing.lg },
  groupSkeleton: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surfaceContainer,
  },
  groupSkeletonRow: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  groupSection: { marginHorizontal: theme.spacing.md, marginTop: theme.spacing.md },
  strip: { gap: theme.spacing.sm, padding: theme.spacing.sm },
  stripCell: { width: 88, height: 88 },
  keeperRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  keeperCell: {
    width: 132,
    height: 132,
    borderRadius: theme.radius.card,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.transparent,
    backgroundColor: theme.colors.surfaceHighest,
  },
  keeperSelected: { borderColor: theme.colors.accent },
  keeperBadge: { position: "absolute", left: theme.spacing.sm, bottom: theme.spacing.sm },
  sheetNote: { marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
});
