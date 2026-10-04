import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { countMissingAnalysis } from "../db/queries";
import { HighlightMonth, getHighlights } from "../lib/highlights";
import { backfillAnalysis } from "../lib/similar";
import { theme } from "../theme";

// v0.33 "Highlights": the sharpest, non-soft shots of each month as
// auto-curated month cards. The analyzer is the Junk Sweeper's sharpness
// metric; the per-photo numbers are computed by the scanner and the one-time
// backfill (shared with "Find duplicates" — same pass, same progress).
export function HighlightsScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const cancelRef = useRef({ cancelled: false });
  const [indexing, setIndexing] = useState<number | null>(null);
  const [months, setMonths] = useState<HighlightMonth[] | null>(null);

  useEffect(() => {
    cancelRef.current = { cancelled: false };
    void (async () => {
      try {
        if ((await countMissingAnalysis()) > 0) {
          setIndexing(0);
          await backfillAnalysis((done) => setIndexing(done), cancelRef.current);
        }
      } catch {}
      setIndexing(null);
      if (cancelRef.current.cancelled) return;
      setMonths(await getHighlights().catch(() => []));
    })();
    return () => {
      cancelRef.current.cancelled = true;
    };
  }, []);

  const sub =
    indexing !== null
      ? `Indexing your photos… ${indexing} done so far`
      : months !== null
      ? `${months.length} month${months.length === 1 ? "" : "s"} with highlights`
      : "Finding your best shots…";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Highlights</Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
      </View>

      {indexing !== null ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Scoring your photos…</Text>
          <Text style={styles.centerSub}>{indexing} done — this runs only once.</Text>
        </View>
      ) : months === null ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>Finding your best shots…</Text>
        </View>
      ) : months.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>No highlights yet — keep taking photos.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {months.map((month) => (
            <View key={month.ym} style={styles.monthCard}>
              <Text style={styles.monthTitle}>{month.label}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {month.items.map((r, i) => (
                  <Pressable
                    key={String(r.id)}
                    onPress={() =>
                      navigation.navigate("Viewer", { ids: month.items.map((x) => x.id), index: i })
                    }
                  >
                    <Image
                      source={{ uri: r.thumb_uri }}
                      style={styles.thumb}
                      contentFit="cover"
                      transition={120}
                      recyclingKey={`hl-${r.id}`}
                    />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 22, fontWeight: "700" },
  sub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl },
  centerText: { color: theme.colors.onSurfaceVariant, fontSize: 14.5, textAlign: "center" },
  centerSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 6, textAlign: "center" },
  content: { paddingBottom: 32 },
  monthCard: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    marginHorizontal: theme.spacing.lg,
  },
  monthTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "700", marginBottom: theme.spacing.sm },
  row: { gap: 6, paddingVertical: 2 },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceHighest,
  },
});
