import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { findDuplicateGroups, type DuplicateGroup } from "../lib/similar";
import { setMediaVisibility } from "../db/queries";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Badge,
  EmptyState,
  ErrorState,
  MediaTile,
  Screen,
  Section,
  Skeleton,
  alertDialog,
  confirmDialog,
} from "../ui";

// v0.54 Duplicate merge tool. Reuses the existing findDuplicateGroups()
// clustering (same-day near-duplicates by pHash). For each group the owner
// picks the keeper; the rest are trashed (trash_reason='merge') so the v0.39
// "restore merged" flow can undo. Nothing is permanently deleted here — the
// 30-day trash window still applies, and the bytes are reclaimable via
// Free up space afterwards.
export function DuplicateMergeScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; DuplicateMerge: undefined }>;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [working, setWorking] = useState(false);
  const [merged, setMerged] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    void findDuplicateGroups()
      .then(setGroups)
      .catch(() => {
        setGroups([]);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const mergeGroup = useCallback(
    (group: DuplicateGroup, keepId: number) => {
      void confirmDialog({
        title: "Merge this group?",
        message: `Keep 1 photo, move the other ${group.items.length - 1} to Trash. You can restore them for 30 days.`,
        confirmLabel: "Merge",
        destructive: true,
      }).then((ok) => {
        if (!ok) return;
        setWorking(true);
        void (async () => {
          try {
            for (const item of group.items) {
              if (item.id === keepId) continue;
              await setMediaVisibility(item.id, "trashed");
              // stamp trash_reason = 'merge' so the v0.39 restore flow picks it up
              const db = await (await import("../db")).getDb();
              await db.runAsync(
                "UPDATE media SET trash_reason = 'merge', trashed_at = ?, updated_at = ? WHERE id = ?",
                [Date.now(), Date.now(), item.id]
              );
            }
            setMerged((n) => n + (group.items.length - 1));
            reload();
          } catch {
            void alertDialog({
              title: "Could not merge",
              message: "Try again — nothing was permanently deleted.",
            });
          } finally {
            setWorking(false);
          }
        })();
      });
    },
    [reload]
  );

  return (
    <Screen>
      <AppBar
        title="Merge duplicates"
        subtitle="Keep one shot per group — the rest go to Trash for 30 days."
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loadError ? (
          <ErrorState
            title={t("state.error")}
            body="Photogram couldn't read the duplicate groups on this phone."
            retryLabel={t("common.retry")}
            onRetry={reload}
          />
        ) : loading ? (
          <View style={styles.skeletonList}>
            {Array.from({ length: 3 }).map((_, i) => (
              <View key={i} style={styles.skeletonCard}>
                <Skeleton width="45%" height={16} />
                <View style={styles.skeletonRow}>
                  <Skeleton width={88} height={88} radius={theme.radius.control} />
                  <Skeleton width={88} height={88} radius={theme.radius.control} />
                  <Skeleton width={88} height={88} radius={theme.radius.control} />
                </View>
              </View>
            ))}
            <Skeleton width="60%" height={12} />
          </View>
        ) : groups.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            title="No duplicate groups"
            body="Near-identical shots appear here after a library scan and the similar-analysis pass."
            actionLabel={t("common.retry")}
            onAction={reload}
          />
        ) : (
          <>
            <AppText variant="footnote" color={theme.colors.onSurfaceVariant} style={styles.lede}>
              Near-duplicate photos (same day, similar look) grouped together. Pick the one to keep;
              the rest go to Trash and can be restored for 30 days.
            </AppText>

            {groups.map((g, gi) => (
              <Section
                key={gi}
                title={`Group ${gi + 1} · ${g.items.length} shot${g.items.length === 1 ? "" : "s"}`}
                subtitle="Tap the photo to keep it."
                icon="git-merge-outline"
                footer="Nothing is deleted for good — the 30-day Trash window applies."
              >
                <View style={styles.row}>
                  {g.items.map((it) => {
                    const kb = Math.round(it.byte_size / 1024);
                    const name = it.file_name ?? `#${it.id}`;
                    return (
                      <View key={it.id} style={styles.cell}>
                        <View style={styles.cellThumb}>
                          <MediaTile
                            uri={it.thumb_uri ?? undefined}
                            aspectRatio={1}
                            onPress={() => mergeGroup(g, it.id)}
                            accessibilityLabel={`Keep ${name}, ${kb} KB — the rest move to Trash`}
                            accessibilityHint="Merges every other photo in this group into Trash."
                          />
                        </View>
                        <AppText
                          variant="caption2Regular"
                          numberOfLines={1}
                          style={styles.cellName}
                        >
                          {name}
                        </AppText>
                        <AppText variant="caption2Regular" color={theme.colors.onSurfaceVariant}>
                          {kb} KB
                        </AppText>
                      </View>
                    );
                  })}
                </View>
              </Section>
            ))}

            {merged > 0 ? (
              <Badge
                label={`Merged ${merged} photo${merged === 1 ? "" : "s"} into Trash`}
                tone="success"
                icon="checkmark-circle"
                style={styles.doneBadge}
              />
            ) : null}

            {working ? (
              <View style={styles.statusRow}>
                <ActivityIndicator color={theme.colors.accent} />
                <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
                  Merging…
                </AppText>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  lede: { marginBottom: theme.spacing.lg },
  skeletonList: { gap: theme.spacing.lg, paddingTop: theme.spacing.sm },
  skeletonCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surfaceContainer,
  },
  skeletonRow: { flexDirection: "row", gap: theme.spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, padding: theme.spacing.sm },
  cell: { width: 96, gap: 2 },
  cellThumb: { width: 96, height: 96 },
  cellName: { marginTop: theme.spacing.xs },
  doneBadge: { alignSelf: "center", marginVertical: theme.spacing.md },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
  },
});
