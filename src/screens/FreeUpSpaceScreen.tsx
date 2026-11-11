import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as MediaLibrary from "expo-media-library/legacy";
import {
  markMediaCloudOnly,
  countFreeable,
  listFreeable,
  listFreeableAssets,
  type FreeableAssetRow,
  type FreeableRow,
} from "../db/queries";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  ProgressBar,
  Screen,
  Section,
  Skeleton,
  Stat,
  alertDialog,
  confirmDialog,
} from "../ui";

// v0.51 "Free up space": delete ORIGINALS that are already safe in Telegram.
// Hard safety rails (probe-verified around the counts):
// - only visible + non-favorite + state='synced' + untouched-for-7-days rows;
// - only rows the scanner recorded a MediaLibrary asset id for (the thing it
//   can actually ask Android to trash);
// - batches of 40 with per-batch rollback fidelity: a row's local_uri is only
//   nulled AFTER its delete confirmed, so a stalled pass leaves the row
//   intact (owner reruns; Android's own trash dialog is the last guard).
// uploader.ts is untouched — deleting local copies cannot touch the worker
// (those rows are 'local'/'failed', never offered here).

const BATCH = 40;

// A failed batch (owner cancelled the system dialog, or an asset vanished
// between our query and the delete) must not brick the whole run: ask the OS
// which of the batch's assets are really gone and null only those. Anything
// still present keeps its local_uri and is offered again next time.
async function reconcileMissing(rows: FreeableAssetRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    // "Selected photos" access (limited) makes getAssetInfoAsync answer null for
    // files we simply cannot see — never treat that as gone.
    if (!perm?.granted || perm.accessPrivileges === "limited") return 0;
  } catch {
    return 0;
  }
  const gone: number[] = [];
  for (const r of rows) {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(r.media_library_id);
      if (!info) gone.push(r.id);
    } catch {
      // Unknown answer (permission/query error) — assume the file is still
      // there. Never drop a row on a guess.
    }
  }
  if (gone.length > 0) await markMediaCloudOnly(gone);
  return gone.length;
}

export function FreeUpSpaceScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; FreeUpSpace: undefined }>;
}) {
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null);
  const [preview, setPreview] = useState<FreeableRow[]>([]);
  const [running, setRunning] = useState(false);
  const [progressFreed, setProgressFreed] = useState(0);
  const [done, setDone] = useState<{ freed: number; bytes: number } | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(() => {
    setLoadError(false);
    let failed = false;
    void Promise.all([
      countFreeable()
        .then(setStats)
        .catch(() => {
          setStats({ count: 0, bytes: 0 });
          failed = true;
        }),
      listFreeable(48)
        .then(setPreview)
        .catch(() => {
          setPreview([]);
          failed = true;
        }),
    ]).then(() => {
      if (failed) setLoadError(true);
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const freeAll = useCallback(() => {
    if (!stats || stats.count === 0 || running) return;
    void confirmDialog({
      title: "Delete from your phone?",
      message:
        `${stats.count.toLocaleString()} item${stats.count === 1 ? "" : "s"} (${formatBytes(
          stats.bytes
        )}) will be deleted from this phone. They stay in Telegram and Photogram will show them from the cloud.\n\nAndroid will show its own "Allow" dialog for each batch of ${BATCH}, and it keeps the files in the gallery's Trash for 30 days — empty the Trash to get the space back right away.`,
      confirmLabel: t("common.delete"),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setRunning(true);
      setProgressFreed(0);
      void (async () => {
        let freed = 0;
        let bytes = 0;
        let batchRows: FreeableAssetRow[] = [];
        try {
          for (;;) {
            const rows = await listFreeableAssets(BATCH);
            if (rows.length === 0) break;
            let batchBytes = 0;
            const byAsset = new Map<string, { id: number; byte_size: number }>();
            for (const r of rows) {
              if (byAsset.has(r.media_library_id)) continue;
              byAsset.set(r.media_library_id, { id: r.id, byte_size: r.byte_size });
              batchBytes += r.byte_size;
            }
            if (byAsset.size === 0) break;
            batchRows = rows;
            await MediaLibrary.deleteAssetsAsync([...byAsset.keys()]);
            await markMediaCloudOnly([...byAsset.values()].map((v) => v.id));
            batchRows = [];
            freed += byAsset.size;
            bytes += batchBytes;
            setProgressFreed(freed);
          }
          setDone({ freed, bytes });
        } catch {
          const recovered = await reconcileMissing(batchRows);
          if (recovered > 0) {
            freed += recovered;
            setProgressFreed(freed);
          }
          void alertDialog({
            title: "Could not finish",
            message:
              recovered > 0
                ? `${recovered} item${recovered === 1 ? "" : "s"} were already gone and are now marked as cloud copies. Check Android's gallery trash, then run it again — anything still on the phone will be offered again.`
                : "Some items may not have been deleted. Check Android's gallery trash, then try again — anything still on the phone will be offered again.",
          });
        } finally {
          setRunning(false);
          reload();
        }
      })();
    });
  }, [stats, running, reload]);

  const nothingToFree = stats !== null && stats.count === 0 && !running && done === null;

  return (
    <Screen>
      <AppBar
        title="Free up space"
        subtitle="Delete phone copies that are already safe in Telegram"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loadError ? (
          <ErrorState
            title={t("state.error")}
            body="Photogram couldn't count what can be freed. Nothing was deleted."
            retryLabel={t("common.retry")}
            onRetry={reload}
          />
        ) : (
          <>
            <AppText variant="body" color={theme.colors.onSurfaceVariant} style={styles.lede}>
              These originals are already safe in Telegram — deleting them from the phone keeps
              your gallery exactly the same, because Photogram shows the cloud copies.
            </AppText>

            <Section title="Safety rails" icon="shield-checkmark-outline">
              <ListRow
                icon="heart-outline"
                title="Favorites and the last 7 days"
                subtitle="Never offered for deletion, no matter how much space they use."
              />
              <ListRow
                icon="trash-outline"
                title="Android keeps its own Trash"
                subtitle="Deleted items sit in the gallery's Trash for 30 days, so the space comes back when you empty it."
              />
            </Section>

            {stats !== null && !nothingToFree ? (
              <Section
                title="Preview"
                icon="images-outline"
                subtitle={tCount("gallery.itemsCount", preview.length)}
              >
                {preview.length === 0 ? (
                  <View style={styles.emptyPreview}>
                    <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
                      Nothing to preview right now.
                    </AppText>
                  </View>
                ) : (
                  <View style={styles.grid}>
                    {preview.map((r) => (
                      <View key={r.id} style={styles.cell}>
                        <Image
                          source={{ uri: r.thumb_uri ?? undefined }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          transition={90}
                          recyclingKey={`free-${r.id}`}
                          accessible={false}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </Section>
            ) : null}

            {stats === null ? (
              <View style={styles.skeletonCard}>
                <Skeleton width="35%" height={28} />
                <Skeleton width="60%" height={14} />
                <Skeleton width="100%" height={48} radius={theme.radius.pill} style={styles.skeletonCta} />
              </View>
            ) : nothingToFree ? (
              <EmptyState
                icon="checkmark-circle-outline"
                title="Nothing to free yet"
                body="Everything on this phone is either not backed up, a favorite, or from the last 7 days."
                actionLabel={t("common.back")}
                onAction={() => navigation.goBack()}
              />
            ) : (
              <Section
                title="Ready to free"
                icon="trash-outline"
                footer={
                  done ? "Empty the gallery's Trash to actually reclaim that space." : undefined
                }
              >
                <View style={styles.statRow}>
                  <Stat value={stats.count.toLocaleString()} label="items can be freed" />
                  <Stat value={formatBytes(stats.bytes)} label="space they take" />
                </View>
                <View style={styles.actionWrap}>
                  <Button
                    label={`Free everything (${formatBytes(stats.bytes)})`}
                    icon="trash-outline"
                    fullWidth
                    loading={running}
                    disabled={running || stats.count === 0}
                    onPress={freeAll}
                  />
                </View>
                {running ? (
                  <View style={styles.progressWrap}>
                    <ProgressBar
                      progress={stats.count > 0 ? progressFreed / stats.count : 0}
                      label="Deleting originals"
                      valueText={`${progressFreed.toLocaleString()} of ${stats.count.toLocaleString()} moved — keep the app open`}
                      live
                    />
                  </View>
                ) : null}
                {done ? (
                  <View style={styles.doneRow}>
                    <Badge
                      label={`Moved ${done.freed.toLocaleString()} item${
                        done.freed === 1 ? "" : "s"
                      } (${formatBytes(done.bytes)}) to Trash`}
                      tone="success"
                      icon="checkmark-circle"
                    />
                  </View>
                ) : null}
              </Section>
            )}
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
  skeletonCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surfaceContainer,
  },
  skeletonCta: { marginTop: theme.spacing.sm },
  statRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  actionWrap: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  progressWrap: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md },
  doneRow: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.xs, padding: theme.spacing.sm },
  cell: {
    width: 92,
    height: 92,
    borderRadius: theme.radius.control,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  emptyPreview: { padding: theme.spacing.md },
});
