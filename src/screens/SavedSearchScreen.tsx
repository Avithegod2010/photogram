import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { deleteSavedSearch, getSavedSearch, parseRules, type MediaRow } from "../db/queries";
import { runSearch, runRulesSearch } from "../lib/search";
import { theme } from "../theme";
import { t, tf } from "../lib/i18n";
import {
  AppBar,
  EmptyState,
  ErrorState,
  IconButton,
  MediaTile,
  Screen,
  Skeleton,
  alertDialog,
  confirmDialog,
} from "../ui";

// v0.27 Smart albums: a saved search rendered as an auto-updating collection.
// Every open re-runs the query through the normal search pipeline (runSearch),
// so the grid always reflects the library as it is right now.
export function SavedSearchScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
  route: { params: { id: number } };
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [isRules, setIsRules] = useState(false);
  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const saved = await getSavedSearch(route.params.id);
      if (!saved) {
        await alertDialog({
          title: "Search removed",
          message: "This saved search no longer exists.",
        });
        navigation.goBack();
        return;
      }
      setName(saved.name);
      setIsRules(saved.rules != null);
      const rules = parseRules(saved.rules);
      if (rules) {
        setRows(await runRulesSearch(rules));
      } else {
        setQuery(saved.query);
        setRows(await runSearch(saved.query));
      }
    } catch {
      setRows([]);
      setLoadError(true);
    }
  }, [route.params.id, navigation]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = () => {
    void confirmDialog({
      title: "Remove saved search?",
      message: `"${name}" disappears from Collections. Your photos are not touched.`,
      confirmLabel: t("common.remove"),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      void deleteSavedSearch(route.params.id).finally(() => navigation.goBack());
    });
  };

  return (
    <Screen>
      <AppBar
        title={name || "Smart album"}
        subtitle={
          rows === null
            ? t("common.loading")
            : isRules
              ? "Rules album · auto-updating"
              : `Auto-updating · search "${query}"`
        }
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
        actions={
          <IconButton
            icon="trash-outline"
            label="Remove saved search"
            variant="plain"
            onPress={confirmDelete}
          />
        }
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't run this smart album. Your photos and saved searches are untouched."
          retryLabel={t("common.retry")}
          onRetry={() => void load()}
        />
      ) : rows === null ? (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={i} style={styles.skeletonCell}>
              <Skeleton width="100%" height={110} radius={theme.radius.thumb} />
            </View>
          ))}
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="bookmark-outline"
          title="No photos match right now"
          body="This collection updates automatically as your library changes."
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      ) : (
        <FlashList
          data={rows}
          numColumns={3}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <View style={styles.cell}>
              <MediaTile
                uri={item.thumb_uri}
                aspectRatio={1}
                status={item.state === "synced" ? null : item.state}
                onPress={() =>
                  navigation.navigate("Viewer", { ids: rows.map((r) => r.id), index })
                }
                accessibilityLabel={tf("gallery.tileLabel", {
                  date: new Date(item.taken_at).toLocaleDateString(),
                })}
              />
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: theme.spacing.xl },
  cell: { flex: 1, margin: 1 },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", padding: theme.spacing.xs },
  skeletonCell: { width: "33.33%", padding: 2 },
});
