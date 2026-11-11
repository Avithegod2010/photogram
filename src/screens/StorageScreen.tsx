import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  formatBytes,
  getCategoryUsage,
  getLargestItems,
  getMonthlyBuckets,
  type CategoryUsage,
  type LargeItem,
  type MonthBucket,
} from "../lib/stats";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  EmptyState,
  ErrorState,
  ListRow,
  ProgressBar,
  Screen,
  Section,
  Skeleton,
} from "../ui";

// v0.29 Storage deep-dive: "what's eating my phone". Biggest items, bytes per
// month (12) and per-category bloat — all read-only aggregations over the
// same "my library" universe the Settings dashboard uses.
export function StorageScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; FreeUpSpace: undefined; DuplicateMerge: undefined }>;
}) {
  const [largest, setLargest] = useState<LargeItem[] | null>(null);
  const [months, setMonths] = useState<MonthBucket[]>([]);
  const [categories, setCategories] = useState<CategoryUsage[]>([]);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    let failed = false;
    void Promise.all([
      getLargestItems(12)
        .then(setLargest)
        .catch(() => {
          setLargest([]);
          failed = true;
        }),
      getMonthlyBuckets(12)
        .then(setMonths)
        .catch(() => {
          setMonths([]);
          failed = true;
        }),
      getCategoryUsage()
        .then(setCategories)
        .catch(() => {
          setCategories([]);
          failed = true;
        }),
    ]).then(() => {
      if (failed) setLoadError(true);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const maxBytes = Math.max(1, ...months.map((m) => m.bytes));
  const screenshots = categories.find((c) => c.key === "screenshots");

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-");
    return `${new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "short" })} ${y.slice(2)}`;
  };

  return (
    <Screen>
      <AppBar
        title="What's using space"
        subtitle="Sizes are read from this phone's index — nothing is uploaded or deleted here."
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loadError ? (
          <ErrorState
            title={t("state.error")}
            body="Photogram couldn't read the storage counts. Your photos are still on this phone."
            retryLabel={t("common.retry")}
            onRetry={load}
          />
        ) : (
          <>
            <Section title="Biggest items" icon="images-outline">
              {largest === null ? (
                <View style={styles.skeletonList}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <View key={i} style={styles.skeletonRow}>
                      <Skeleton width={52} height={52} radius={theme.radius.control} />
                      <View style={styles.flex}>
                        <Skeleton width="60%" height={16} />
                        <Skeleton width="35%" height={12} style={styles.skeletonGap} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : largest.length === 0 ? (
                <EmptyState
                  compact
                  icon="images-outline"
                  title="Nothing scanned yet"
                  body="Run a scan from Gallery — item sizes appear here once the index knows your library."
                  actionLabel={t("common.back")}
                  onAction={() => navigation.goBack()}
                />
              ) : (
                largest.map((item, i) => (
                  <ListRow
                    key={String(item.id)}
                    leading={
                      <Image
                        source={{ uri: item.thumb_uri }}
                        style={styles.thumb}
                        contentFit="cover"
                        recyclingKey={`big-${item.id}`}
                        accessible={false}
                      />
                    }
                    title={item.file_name ?? "Untitled"}
                    subtitle={`${item.mime_type?.startsWith("video/") ? "Video" : "Photo"} · ${formatBytes(
                      item.byte_size
                    )}`}
                    accessory="chevron"
                    onPress={() =>
                      navigation.navigate("Viewer", {
                        ids: largest.map((l) => l.id),
                        index: i,
                      })
                    }
                  />
                ))
              )}
            </Section>

            <Section title="By month" icon="calendar-outline">
              {largest === null ? (
                <View>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <View key={i} style={styles.monthRow}>
                      <Skeleton width={56} height={12} />
                      <Skeleton width="55%" height={6} radius={3} />
                      <Skeleton width={48} height={12} />
                    </View>
                  ))}
                </View>
              ) : months.length === 0 ? (
                <EmptyState compact icon="calendar-outline" title="No months yet" />
              ) : (
                months.map((m) => (
                  <View
                    key={m.ym}
                    style={styles.monthRow}
                    accessible
                    accessibilityLabel={`${monthLabel(m.ym)}: ${
                      m.bytes > 0 ? formatBytes(m.bytes) : "no items"
                    }`}
                  >
                    <AppText
                      variant="caption"
                      color={theme.colors.onSurfaceVariant}
                      style={styles.monthLabel}
                    >
                      {monthLabel(m.ym)}
                    </AppText>
                    <ProgressBar
                      progress={m.bytes > 0 ? m.bytes / maxBytes : 0}
                      label={monthLabel(m.ym)}
                      style={styles.flex}
                    />
                    <AppText variant="caption" weight="medium" tabular style={styles.monthBytes}>
                      {m.bytes > 0 ? formatBytes(m.bytes) : "—"}
                    </AppText>
                  </View>
                ))
              )}
            </Section>

            <Section
              title="By category"
              icon="pie-chart-outline"
              footer={
                screenshots && screenshots.count > 0
                  ? "Screenshots pile up fast — the Junk Sweeper flags ones older than 90 days.\n\nCategories can overlap (a WhatsApp video is both). Trash and edited copies are never counted."
                  : "Categories can overlap (a WhatsApp video is both). Trash and edited copies are never counted."
              }
            >
              {largest === null ? (
                <View style={styles.skeletonList}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <View key={i} style={styles.skeletonRow}>
                      <View style={styles.flex}>
                        <Skeleton width="45%" height={16} />
                        <Skeleton width="25%" height={12} style={styles.skeletonGap} />
                      </View>
                      <Skeleton width={56} height={16} />
                    </View>
                  ))}
                </View>
              ) : categories.length === 0 ? (
                <EmptyState compact icon="pie-chart-outline" title="No categories to show yet" />
              ) : (
                categories.map((c) => (
                  <ListRow
                    key={c.key}
                    title={c.label}
                    subtitle={`${c.count} item${c.count === 1 ? "" : "s"}`}
                    trailing={
                      <AppText variant="body" weight="semibold" tabular>
                        {formatBytes(c.bytes)}
                      </AppText>
                    }
                  />
                ))
              )}
            </Section>

            <Section title="Clean up" icon="sparkles-outline">
              <ListRow
                title="Free up space"
                subtitle="Delete originals already safe in Telegram — 7+ day-old, non-favorite, fully synced items only."
                icon="trash-outline"
                accessory="chevron"
                onPress={() => navigation.navigate("FreeUpSpace")}
              />
              <ListRow
                title="Merge duplicates"
                subtitle="Group near-identical shots and keep one — the rest go to Trash (restorable)."
                icon="git-merge-outline"
                accessory="chevron"
                onPress={() => navigation.navigate("DuplicateMerge")}
              />
            </Section>
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
  flex: { flex: 1, minWidth: 0 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surfaceHighest,
  },
  skeletonList: { padding: theme.spacing.md, gap: theme.spacing.md },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.compact },
  skeletonGap: { marginTop: theme.spacing.xs },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.compact,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.compact,
    minHeight: theme.layout.touch,
  },
  monthLabel: { width: 56 },
  monthBytes: { width: 68, textAlign: "right" },
});
