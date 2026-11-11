import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { formatBytes } from "../lib/stats";
import { getWrapped, getWrappedYears, WrappedStats } from "../lib/wrapped";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Screen,
  Section,
  Skeleton,
  Stat,
} from "../ui";

type WrappedCard = {
  key: string;
  title: string;
  big: string;
  sub?: string;
  thumbs?: string[];
};

const photoCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "photo" : "photos"}`;
const dayCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "day" : "days"}`;
const itemCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "item" : "items"}`;

export function WrappedScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{ ThenNow: undefined }>;
  route: { params?: { year?: number } };
}) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(route.params?.year ?? new Date().getFullYear());
  const [stats, setStats] = useState<WrappedStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void getWrappedYears()
      .then((ys) => {
        setYears(ys);
        if (ys.length > 0 && !ys.includes(year)) setYear(ys[0]);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoaded(false);
    setLoadError(null);
    try {
      setStats(await getWrapped(year));
    } catch (e) {
      setStats(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = useCallback((): WrappedCard[] => {
    if (!stats) return [];
    const c: WrappedCard[] = [];
    const total = stats.photos + stats.videos;
    c.push({
      key: "total",
      title: `${stats.year} in photos`,
      big: `${total.toLocaleString()} captured`,
      sub: `${photoCount(stats.photos)} · ${stats.videos.toLocaleString()} ${
        stats.videos === 1 ? "video" : "videos"
      }`,
    });
    c.push({
      key: "safe",
      title: "Safely in Telegram",
      big: `${formatBytes(stats.syncedBytes)} backed up`,
    });
    if (stats.busiestMonth && stats.busiestMonth.count > 0) {
      c.push({
        key: "month",
        title: "Busiest month",
        big: stats.busiestMonth.label,
        sub: itemCount(stats.busiestMonth.count),
      });
    }
    for (const [i, day] of stats.topDays.entries()) {
      c.push({
        key: `day${i}`,
        title: i === 0 ? "Top day" : `#${i + 1} day`,
        big: new Date(day.label + "T12:00:00").toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
        sub: itemCount(day.count),
        thumbs: day.thumbs,
      });
    }
    c.push({
      key: "days",
      title: "Days you used the camera",
      big: dayCount(stats.daysCaptured),
    });
    c.push({
      key: "favs",
      title: "Favorites",
      big: `${stats.favorites.toLocaleString()} ♥`,
      sub: "Marked with a heart this year",
    });
    // v0.45 Wrapped v2 superlatives — people (P&P library) + places (place tags).
    for (const [i, person] of stats.topPeople.entries()) {
      c.push({
        key: `person${i}`,
        title: i === 0 ? "Most-snapshotted person" : `#${i + 1} person`,
        big: person.name,
        sub: `${photoCount(person.count)} this year`,
        thumbs: person.thumbs,
      });
    }
    for (const [i, place] of stats.topPlaces.entries()) {
      c.push({
        key: `place${i}`,
        title: i === 0 ? "Where the camera went" : `#${i + 1} place`,
        big: place.place,
        sub: `${photoCount(place.count)} this year`,
        thumbs: place.thumbs,
      });
    }
    return c;
  }, [stats]);

  const total = stats ? stats.photos + stats.videos : 0;

  return (
    <Screen edges={["top"]}>
      <AppBar
        title="Wrapped"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {years.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.yearRow}
          style={styles.yearRowScroll}
        >
          <Button
            label="Then & now"
            icon="git-compare-outline"
            size="sm"
            variant="secondary"
            onPress={() => navigation.navigate("ThenNow")}
          />
          {years.map((y) => (
            <Chip key={y} label={String(y)} selected={y === year} onPress={() => setYear(y)} />
          ))}
        </ScrollView>
      ) : null}

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body={loadError}
          retryLabel={t("common.retry")}
          onRetry={() => void load()}
        />
      ) : !loaded ? (
        <View style={styles.loadingWrap}>
          <Skeleton height={96} radius={theme.radius.card} label={t("state.loading")} />
          <Skeleton height={96} radius={theme.radius.card} />
          <Skeleton height={96} radius={theme.radius.card} />
        </View>
      ) : total === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title={`Nothing captured in ${year}`}
          body={`No photos or videos are dated ${year}. Pick another year from the chips above.`}
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + theme.spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={reduced ? undefined : FadeInDown.duration(theme.motion.duration.slow)}>
            {cards().map((card) => (
              <Section key={card.key} card title={card.title}>
                <View style={styles.cardBody}>
                  <AppText variant="display" numberOfLines={2}>
                    {card.big}
                  </AppText>
                  {card.key === "total" && stats ? (
                    <View style={styles.statRow}>
                      <Stat
                        value={stats.photos.toLocaleString()}
                        label="Photos"
                        icon="image-outline"
                      />
                      <Stat
                        value={stats.videos.toLocaleString()}
                        label="Videos"
                        icon="videocam-outline"
                      />
                    </View>
                  ) : card.sub ? (
                    <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
                      {card.sub}
                    </AppText>
                  ) : null}
                  {card.thumbs && card.thumbs.length > 0 ? (
                    <View style={styles.thumbRow}>
                      {card.thumbs.map((thumb) => (
                        <Image
                          key={thumb}
                          source={{ uri: thumb }}
                          style={styles.thumb}
                          contentFit="cover"
                          transition={reduced ? 0 : 150}
                          accessible={false}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              </Section>
            ))}
          </Animated.View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  yearRowScroll: { flexGrow: 0 },
  yearRow: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    alignItems: "center",
  },
  loadingWrap: {
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.md,
  },
  content: {
    paddingHorizontal: theme.spacing.md,
  },
  cardBody: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.compact,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  statRow: { flexDirection: "row", gap: theme.spacing.md },
  thumbRow: { flexDirection: "row", gap: theme.spacing.sm },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surfaceHighest,
  },
});
