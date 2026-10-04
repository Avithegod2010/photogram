import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  formatBytes,
  getCategoryUsage,
  getLargestItems,
  getMonthlyBuckets,
  CategoryUsage,
  LargeItem,
  MonthBucket,
} from "../lib/stats";
import { theme } from "../theme";

// v0.29 Storage deep-dive: "what's eating my phone". Biggest items, bytes per
// month (12) and per-category bloat — all read-only aggregations over the
// same "my library" universe the Settings dashboard uses.
export function StorageScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [largest, setLargest] = useState<LargeItem[] | null>(null);
  const [months, setMonths] = useState<MonthBucket[]>([]);
  const [categories, setCategories] = useState<CategoryUsage[]>([]);

  useEffect(() => {
    void getLargestItems(12)
      .then(setLargest)
      .catch(() => setLargest([]));
    void getMonthlyBuckets(12)
      .then(setMonths)
      .catch(() => setMonths([]));
    void getCategoryUsage()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const maxBytes = Math.max(1, ...months.map((m) => m.bytes));
  const screenshots = categories.find((c) => c.key === "screenshots");

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-");
    return `${new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "short" })} ${y.slice(2)}`;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>What's using space</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Biggest items</Text>
        {largest === null ? (
          <Text style={styles.hint}>Counting…</Text>
        ) : largest.length === 0 ? (
          <Text style={styles.hint}>Nothing scanned yet.</Text>
        ) : (
          largest.map((item, i) => (
            <Pressable
              key={String(item.id)}
              style={styles.itemRow}
              onPress={() =>
                navigation.navigate("Viewer", {
                  ids: largest.map((l) => l.id),
                  index: i,
                })
              }
              android_ripple={{ color: theme.colors.outlineVariant }}
            >
              <Image source={{ uri: item.thumb_uri }} style={styles.itemThumb} contentFit="cover" recyclingKey={`big-${item.id}`} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.file_name ?? "Untitled"}
                </Text>
                <Text style={styles.itemSub}>
                  {item.mime_type?.startsWith("video/") ? "Video" : "Photo"}
                </Text>
              </View>
              <Text style={styles.itemBytes}>{formatBytes(item.byte_size)}</Text>
            </Pressable>
          ))
        )}

        <Text style={styles.sectionTitle}>By month</Text>
        <View style={styles.card}>
          {months.map((m) => (
            <View key={m.ym} style={styles.monthRow}>
              <Text style={styles.monthLabel}>{monthLabel(m.ym)}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { flex: m.bytes > 0 ? Math.max(0.02, m.bytes / maxBytes) : 0 },
                  ]}
                />
              </View>
              <Text style={styles.monthBytes}>{m.bytes > 0 ? formatBytes(m.bytes) : "—"}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>By category</Text>
        <View style={styles.card}>
          {categories.map((c) => (
            <View key={c.key} style={styles.catRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.catLabel}>{c.label}</Text>
                <Text style={styles.catSub}>
                  {c.count} item{c.count === 1 ? "" : "s"}
                </Text>
              </View>
              <Text style={styles.catBytes}>{formatBytes(c.bytes)}</Text>
            </View>
          ))}
          {screenshots && screenshots.count > 0 ? (
            <Text style={styles.insight}>
              Screenshots pile up fast — the Junk Sweeper flags ones older than 90 days.
            </Text>
          ) : null}
        </View>
        <Text style={styles.footnote}>
          Categories can overlap (a WhatsApp video is both). Trash and edited copies are never counted.
        </Text>
      </ScrollView>
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
  content: { paddingBottom: 40, paddingHorizontal: theme.spacing.lg },
  sectionTitle: {
    color: theme.colors.onSurface,
    fontSize: 16,
    fontWeight: "700",
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  hint: { color: theme.colors.onSurfaceVariant, fontSize: 13 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: 8,
  },
  itemThumb: { width: 52, height: 52, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceHighest },
  itemName: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "600" },
  itemSub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  itemBytes: { color: theme.colors.onSurface, fontSize: 13, fontWeight: "600" },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    padding: theme.spacing.md,
  },
  monthRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 4 },
  monthLabel: { color: theme.colors.onSurfaceVariant, fontSize: 12, width: 52 },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.surfaceHighest,
    overflow: "hidden",
    flexDirection: "row",
  },
  barFill: { backgroundColor: theme.colors.primary, borderRadius: 5 },
  monthBytes: { color: theme.colors.onSurface, fontSize: 12, width: 64, textAlign: "right" },
  catRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  catLabel: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "600" },
  catSub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  catBytes: { color: theme.colors.onSurface, fontSize: 13.5, fontWeight: "600" },
  insight: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12.5,
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.outlineVariant,
  },
  footnote: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: theme.spacing.md },
});
