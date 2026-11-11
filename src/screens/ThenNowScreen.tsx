import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listOnThisDay, type MediaRow } from "../db/queries";
import { theme } from "../theme";
import { t, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  EmptyState,
  ErrorState,
  MediaTile,
  Screen,
  Section,
  Skeleton,
} from "../ui";

// v0.40 Then & now — "on this day" for EVERY past year at once (±3 days so
// real-world dates still line up). Rows group by year, newest first; tapping
// a tile opens the full-screen viewer.
export function ThenNowScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    setLoadError(false);
    setLoaded(false);
    try {
      setRows(await listOnThisDay(3, 400));
    } catch {
      setRows([]);
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const years = [...new Set(rows.map((r) => (r.taken_at ? new Date(r.taken_at) : null)?.getFullYear() ?? 0))]
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  return (
    <Screen>
      <AppBar
        title="Then & now"
        subtitle="Photos from this day (±3 days), every year you have"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read this day's photos on this phone."
          retryLabel={t("common.retry")}
          onRetry={() => void reload()}
        />
      ) : !loaded ? (
        <View style={styles.loadingWrap}>
          {Array.from({ length: 2 }).map((_, block) => (
            <View key={block} style={styles.skeletonBlock}>
              <Skeleton width="45%" height={16} label={block === 0 ? t("common.loading") : undefined} />
              <View style={styles.skeletonRow}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    width={108}
                    height={108}
                    radius={theme.radius.md}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : years.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title="Nothing from this day yet"
          body="Come back as your library grows — every past year shows up here on its date."
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {years.map((year) => {
            const yearRows = rows.filter(
              (r) => (r.taken_at ? new Date(r.taken_at).getFullYear() : 0) === year
            );
            const ago = new Date().getFullYear() - year;
            return (
              <Section
                key={year}
                title={`${ago === 0 ? "This year" : `${ago} year${ago === 1 ? "" : "s"} ago`} · ${year}`}
                card={false}
                style={styles.yearBlock}
              >
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.strip}
                >
                  {yearRows.map((r) => {
                    const idxInAll = rows.findIndex((x) => x.id === r.id);
                    const date = new Date(r.taken_at).toLocaleDateString();
                    return (
                      <View key={r.id} style={styles.thumbWrap}>
                        <MediaTile
                          uri={r.thumb_uri}
                          aspectRatio={1}
                          onPress={() =>
                            navigation.navigate("Viewer", {
                              ids: rows.map((x) => x.id),
                              index: Math.max(idxInAll, 0),
                            })
                          }
                          accessibilityLabel={tf("gallery.tileLabel", { date })}
                          accessibilityHint={t("viewer.tileHint")}
                        />
                        <AppText
                          variant="caption2Regular"
                          color={theme.colors.onSurfaceVariant}
                          numberOfLines={1}
                          style={styles.dateLine}
                        >
                          {date}
                        </AppText>
                      </View>
                    );
                  })}
                </ScrollView>
              </Section>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  yearBlock: { marginBottom: theme.spacing.md },
  strip: { gap: theme.spacing.sm },
  thumbWrap: { width: 108 },
  dateLine: { marginTop: theme.spacing.xs },
  loadingWrap: { padding: theme.spacing.md, gap: theme.spacing.lg },
  skeletonBlock: { gap: theme.spacing.sm },
  skeletonRow: { flexDirection: "row", gap: theme.spacing.sm },
});
