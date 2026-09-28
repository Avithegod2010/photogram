import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { formatBytes } from "../lib/stats";
import { getWrapped, getWrappedYears, WrappedStats } from "../lib/wrapped";
import { theme } from "../theme";

export function WrappedScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<Record<string, undefined>>;
  route: { params?: { year?: number } };
}) {
  const insets = useSafeAreaInsets();
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(route.params?.year ?? new Date().getFullYear());
  const [stats, setStats] = useState<WrappedStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getWrappedYears()
      .then((ys) => {
        setYears(ys);
        if (ys.length > 0 && !ys.includes(year)) setYear(ys[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoaded(false);
    void getWrapped(year)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoaded(true));
  }, [year]);

  const cards = useCallback((): Array<{ key: string; title: string; big: string; sub?: string; thumbs?: string[] }> => {
    if (!stats) return [];
    const c: Array<{ key: string; title: string; big: string; sub?: string; thumbs?: string[] }> = [];
    const total = stats.photos + stats.videos;
    c.push({
      key: "total",
      title: `${stats.year} in photos`,
      big: `${total.toLocaleString()} captured`,
      sub: `${stats.photos.toLocaleString()} photos · ${stats.videos.toLocaleString()} videos`,
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
        sub: `${stats.busiestMonth.count.toLocaleString()} items`,
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
        sub: `${day.count.toLocaleString()} items`,
        thumbs: day.thumbs,
      });
    }
    c.push({
      key: "days",
      title: "Days you used the camera",
      big: `${stats.daysCaptured.toLocaleString()} days`,
    });
    c.push({
      key: "favs",
      title: "Favorites",
      big: `${stats.favorites.toLocaleString()} ♥`,
      sub: "Marked with a heart this year",
    });
    return c;
  }, [stats]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Wrapped</Text>
      </View>
      {years.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearRow}>
          {years.map((y) => (
            <Pressable key={y} style={[styles.yearChip, y === year && styles.yearChipOn]} onPress={() => setYear(y)}>
              <Text style={[styles.yearChipText, y === year && styles.yearChipTextOn]}>{y}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        {cards().map((card, i) => (
          <Animated.View key={card.key} entering={FadeInDown.delay(i * 80).springify()}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardBig}>{card.big}</Text>
              {card.sub ? <Text style={styles.cardSub}>{card.sub}</Text> : null}
              {card.thumbs && card.thumbs.length > 0 ? (
                <View style={styles.thumbRow}>
                  {card.thumbs.map((t) => (
                    <Image key={t} source={{ uri: t }} style={styles.thumb} contentFit="cover" transition={150} />
                  ))}
                </View>
              ) : null}
            </View>
          </Animated.View>
        ))}
        {loaded && stats && stats.photos + stats.videos === 0 ? (
          <Text style={styles.empty}>Nothing captured in {year} yet.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.md },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  yearRow: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  yearChip: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  yearChipOn: { backgroundColor: theme.colors.primaryContainer },
  yearChipText: { color: theme.colors.onSurfaceVariant, fontSize: 13, fontWeight: "600" },
  yearChipTextOn: { color: theme.colors.onPrimaryContainer },
  content: { padding: theme.spacing.md, paddingBottom: 48, gap: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    padding: theme.spacing.lg,
  },
  cardTitle: { color: theme.colors.onSurfaceVariant, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  cardBig: { color: theme.colors.onSurface, fontSize: 26, fontWeight: "700", marginTop: 6 },
  cardSub: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, marginTop: 4 },
  thumbRow: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  thumb: { width: 72, height: 72, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceHighest },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 40 },
});
