import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listRejectionDetails, unblockRejection, type RejectionDetail } from "../db/queries";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  EmptyState,
  ErrorState,
  Screen,
  Skeleton,
  confirmDialog,
} from "../ui";

// v0.40 Review corrections — every blocked face pair ("Not this person" /
// split-off memories) with its two photos side by side. Undo deletes the
// canonical pair so the next "Group faces" can reconsider it; the samples
// stay unassigned either way. Nothing here is auto-suggested back at the
// person until the owner re-runs grouping.
export function FaceCorrectionsScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; People: undefined }>;
}) {
  const [rows, setRows] = useState<RejectionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      setRows(await listRejectionDetails());
    } catch {
      setRows([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const undo = useCallback(
    (r: RejectionDetail) => {
      void confirmDialog({
        title: "Undo correction",
        message:
          'This pair stops being blocked — tap "Group faces" on the People screen to let the app reconsider it.',
        confirmLabel: "Undo",
        destructive: true,
      }).then((ok) => {
        if (!ok) return;
        setBusy(true);
        void unblockRejection(r.sampleId, r.blockedSampleId)
          .then(reload)
          .finally(() => setBusy(false));
      });
    },
    [reload]
  );

  return (
    <Screen>
      <AppBar
        title="Review corrections"
        subtitle='Every "not this person" / split-off face pair you taught the app'
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read your saved corrections. Nothing was changed."
          retryLabel={t("common.retry")}
          onRetry={() => void reload()}
        />
      ) : loading ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={styles.skeletonCard}>
              <Skeleton width={108} height={52} radius={theme.radius.control} />
              <View style={styles.flex}>
                <Skeleton width="55%" height={16} />
                <Skeleton width="75%" height={12} style={styles.skeletonGap} />
              </View>
              <Skeleton width={64} height={36} radius={theme.radius.pill} />
            </View>
          ))}
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => `${r.sampleId}-${r.blockedSampleId}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <AppText variant="footnote" color={theme.colors.onSurfaceVariant} style={styles.note}>
              Undo one to let "Group faces" consider the pair again. Corrections keep working even
              after merges, renames or splits — that is by design.
            </AppText>
          }
          ListEmptyComponent={
            <EmptyState
              icon="shield-checkmark-outline"
              title="No corrections yet"
              body="Nothing is blocked, so there is nothing to review. Corrections appear here whenever you mark “not this person” or split faces off."
              actionLabel={t("common.back")}
              onAction={() => navigation.goBack()}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable
                style={styles.thumbPair}
                onPress={() =>
                  navigation.navigate("Viewer", {
                    ids: [item.mediaIdA, item.mediaIdB].filter((id) => id > 0),
                    index: 0,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Open the two photos in this correction"
                accessibilityHint="Opens the pair in the photo viewer."
              >
                <View style={styles.thumb}>
                  <Image
                    source={{ uri: item.thumbA ?? undefined }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    recyclingKey={`corr-a-${item.sampleId}`}
                    accessible={false}
                  />
                </View>
                <View style={styles.thumb}>
                  <Image
                    source={{ uri: item.thumbB ?? undefined }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    recyclingKey={`corr-b-${item.sampleId}`}
                    accessible={false}
                  />
                </View>
              </Pressable>
              <View style={styles.flex}>
                <AppText variant="body" weight="medium" numberOfLines={2}>
                  {item.personName ? `"${item.personName}"` : "Unknown person"}
                  {item.personStillExists ? "" : " (person deleted)"}
                </AppText>
                <AppText
                  variant="captionRegular"
                  color={theme.colors.onSurfaceVariant}
                  style={styles.dateLine}
                >
                  Blocked {new Date(item.createdAt).toLocaleDateString()} · tap photos to open
                </AppText>
              </View>
              <Button
                label="Undo"
                size="sm"
                variant="secondary"
                disabled={busy}
                accessibilityLabel="Undo this correction"
                onPress={() => undo(item)}
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  note: { marginBottom: theme.spacing.md },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  thumbPair: { flexDirection: "row", gap: theme.spacing.xs },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.control,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  dateLine: { marginTop: 2 },
  skeletonList: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
  },
  skeletonGap: { marginTop: theme.spacing.xs },
});
