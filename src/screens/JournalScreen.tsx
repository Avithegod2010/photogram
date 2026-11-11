import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listNotedMedia, MediaRow } from "../db/queries";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  Section,
  Skeleton,
} from "../ui";

// v0.32 Journal: every photo note (v0.17) as a diary. "Today across the
// years" on top — notes written on this calendar day in any year — then all
// notes grouped by year, newest first.
export function JournalScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const [rows, setRows] = useState<MediaRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    void listNotedMedia()
      .then(setRows)
      .catch(() => {
        setRows([]);
        setLoadError(true);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = new Date();
  const isToday = (ts: number) => {
    const d = new Date(ts);
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
  };

  const all = rows ?? [];
  const todayEntries = all.filter((r) => isToday(r.taken_at));
  const byYear = new Map<number, MediaRow[]>();
  for (const row of all) {
    const year = new Date(row.taken_at).getFullYear();
    const list = byYear.get(year) ?? [];
    list.push(row);
    byYear.set(year, list);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);

  const entry = (row: MediaRow) => {
    const date = new Date(row.taken_at).toLocaleDateString(undefined, { dateStyle: "medium" });
    return (
      <ListRow
        key={String(row.id)}
        title={row.note_text ?? ""}
        subtitle={date}
        leading={
          <Image
            source={{ uri: row.thumb_uri }}
            style={styles.thumb}
            contentFit="cover"
            recyclingKey={`jr-${row.id}`}
            accessible={false}
          />
        }
        onPress={() =>
          navigation.navigate("Viewer", {
            ids: all.map((r) => r.id),
            index: all.findIndex((r) => r.id === row.id),
          })
        }
        accessibilityLabel={`${row.note_text ?? ""}. ${date}`}
        accessibilityHint={t("viewer.tileHint")}
      />
    );
  };

  return (
    <Screen>
      <AppBar
        title={t("collections.journal")}
        subtitle={
          rows === null
            ? t("state.loading")
            : `${all.length} note${all.length === 1 ? "" : "s"} written on your photos`
        }
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read your notes on this phone."
          retryLabel={t("common.retry")}
          onRetry={load}
        />
      ) : rows === null ? (
        <View style={styles.loadingWrap}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton width={56} height={56} radius={theme.radius.md} label={i === 0 ? t("common.loading") : undefined} />
              <View style={styles.skeletonText}>
                <Skeleton width="90%" height={14} />
                <Skeleton width="45%" height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : all.length === 0 ? (
        <EmptyState
          icon="book-outline"
          title="No notes yet"
          body="Open any photo → Note, write something — it shows up here and travels as the caption in your Telegram backup."
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {todayEntries.length > 0 ? (
            <Section
              title={`Today across the years · ${today.getDate()} ${today.toLocaleString(undefined, {
                month: "long",
              })}`}
            >
              {todayEntries.map(entry)}
            </Section>
          ) : null}
          {years.map((year) => (
            <Section key={String(year)} title={String(year)}>
              {(byYear.get(year) ?? []).map(entry)}
            </Section>
          ))}
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
  thumb: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceHighest,
  },
  loadingWrap: { padding: theme.spacing.md, gap: theme.spacing.lg },
  skeletonRow: { flexDirection: "row", gap: theme.spacing.md },
  skeletonText: { flex: 1, gap: theme.spacing.sm, justifyContent: "center" },
});
