import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import TdLib from "react-native-tdlib";
import {
  countMergedInTrash,
  deleteMediaRow,
  listTrashed,
  restoreMergedFromTrash,
  setMediaVisibility,
  MediaRow,
} from "../db/queries";
import { TRASH_RETENTION_DAYS } from "../lib/trash";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  MediaTile,
  Screen,
  Section,
  Skeleton,
  confirmDialog,
} from "../ui";

function daysLeft(trashedAt: number | null): number {
  if (!trashedAt) return TRASH_RETENTION_DAYS;
  const elapsedDays = Math.floor((Date.now() - trashedAt) / (24 * 60 * 60 * 1000));
  return Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
}

export function TrashScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Tabs: undefined }>;
}) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [mergedCount, setMergedCount] = useState(0);
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(() => {
    setLoadError(false);
    void (async () => {
      try {
        const [trashed, merged] = await Promise.all([listTrashed(), countMergedInTrash()]);
        setRows(trashed);
        setMergedCount(merged);
      } catch {
        setLoadError(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    reload();
  }, [reload, tick]);

  const undoMerge = useCallback(() => {
    void confirmDialog({
      title: "Undo duplicate merge",
      message: `Bring the ${mergedCount} merged duplicate${
        mergedCount === 1 ? "" : "s"
      } back to the gallery? Telegram keeps both copies either way.`,
      confirmLabel: "Restore",
    }).then((ok) => {
      if (!ok) return;
      void restoreMergedFromTrash().then(() => {
        setMergedCount(0);
        setTick((t) => t + 1);
      });
    });
  }, [mergedCount]);

  const restore = useCallback(async (row: MediaRow) => {
    await setMediaVisibility(row.id, "visible");
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }, []);

  const deleteForever = useCallback((row: MediaRow) => {
    void confirmDialog({
      title: "Delete forever?",
      message: `${row.file_name ?? "This item"} will be removed from Telegram too.`,
      confirmLabel: t("common.delete"),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      void (async () => {
        if (row.remote_chat_id && row.remote_message_id && row.remote_message_id !== "0") {
          try {
            await TdLib.deleteMessages(Number(row.remote_chat_id), [Number(row.remote_message_id)], false);
          } catch {}
        }
        await deleteMediaRow(row.id);
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      })();
    });
  }, []);

  return (
    <Screen>
      <AppBar
        title={t("collections.trash")}
        subtitle={`Items are permanently deleted after ${TRASH_RETENTION_DAYS} days.`}
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {mergedCount > 0 ? (
        <View style={styles.section}>
          <Section>
            <ListRow
              title="Undo duplicate merge"
              subtitle={`${mergedCount} duplicate${
                mergedCount === 1 ? "" : "s"
              } hidden by duplicate-merge live here`}
              icon="copy-outline"
              accessory="chevron"
              onPress={undoMerge}
            />
          </Section>
        </View>
      ) : null}

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the Trash on this phone. Nothing has been deleted."
          retryLabel={t("common.retry")}
          onRetry={reload}
        />
      ) : !loaded ? (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton
              key={i}
              width="31%"
              height={132}
              radius={theme.radius.thumb}
              style={styles.skeletonCell}
              label={i === 0 ? t("common.loading") : undefined}
            />
          ))}
        </View>
      ) : (
        <FlashList
          data={rows}
          numColumns={3}
          keyExtractor={(r) => String(r.id)}
          extraData={tick}
          renderItem={({ item }) => {
            const left = daysLeft(item.trashed_at ?? null);
            const daysLabel = left <= 1 ? "1 day" : `${left} days`;
            return (
              <View style={styles.cell}>
                <MediaTile
                  uri={item.thumb_uri}
                  aspectRatio={0.8}
                  video={item.mime_type.startsWith("video/")}
                  accessibilityLabel={`${item.file_name ?? "Item"}, ${daysLabel} left in Trash`}
                />
                <View style={styles.daysPill}>
                  <AppText
                    variant="caption2"
                    weight="semibold"
                    color={left <= 1 ? theme.colors.error : theme.colors.onViewer}
                  >
                    {daysLabel}
                  </AppText>
                </View>
                <View style={styles.cellActions}>
                  <IconButton
                    icon="arrow-undo-outline"
                    label="Restore"
                    variant="onMedia"
                    size={40}
                    onPress={() => void restore(item)}
                  />
                  <IconButton
                    icon="trash-outline"
                    label={t("common.delete")}
                    variant="danger"
                    size={40}
                    onPress={() => deleteForever(item)}
                  />
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="trash-outline"
              title="Trash is empty"
              body={`Deleted photos wait here for ${TRASH_RETENTION_DAYS} days, then they are removed from Telegram too.`}
              actionLabel={t("common.back")}
              onAction={() => navigation.goBack()}
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: theme.spacing.md },
  listContent: { paddingBottom: theme.spacing.xl },
  cell: { flex: 1, margin: 1 },
  daysPill: {
    position: "absolute",
    top: theme.spacing.xs,
    left: theme.spacing.xs,
    backgroundColor: theme.colors.mediaScrim,
    borderRadius: theme.radius.thumb,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 1,
  },
  cellActions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: theme.spacing.xs,
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing.xs,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing.xs,
  },
  skeletonCell: { margin: 2 },
});
