import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listOnThisDay, type MediaRow } from "../db/queries";
import { theme } from "../theme";

// v0.40 Then & now — "on this day" for EVERY past year at once (±3 days so
// real-world dates still line up). Rows group by year, newest first; tapping
// a tile opens the full-screen viewer.
export function ThenNowScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MediaRow[]>([]);

  const reload = useCallback(async () => {
    const found = await listOnThisDay(3, 400).catch(() => [] as MediaRow[]);
    setRows(found);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const years = [...new Set(rows.map((r) => (r.taken_at ? new Date(r.taken_at) : null)?.getFullYear() ?? 0))]
    .filter((y) => y > 0)
    .sort((a, b) => b - a);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Then & now</Text>
          <Text style={styles.sub}>Photos from this day (±3 days), every year you have</Text>
        </View>
      </View>
      <FlatList
        data={years}
        keyExtractor={(y) => String(y)}
        renderItem={({ item: year }) => {
          const yearRows = rows.filter((r) => (r.taken_at ? new Date(r.taken_at).getFullYear() : 0) === year);
          const ago = new Date().getFullYear() - year;
          return (
            <View style={styles.yearBlock}>
              <Text style={styles.yearTitle}>
                {ago === 0 ? "This year" : `${ago} year${ago === 1 ? "" : "s"} ago`} · {year}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {yearRows.map((r, idx) => {
                  const idxInAll = rows.findIndex((x) => x.id === r.id);
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => navigation.navigate("Viewer", { ids: rows.map((x) => x.id), index: Math.max(idxInAll, 0) })}
                    >
                      <Image
                        source={{ uri: r.thumb_uri }}
                        style={styles.thumb}
                        contentFit="cover"
                        transition={120}
                        recyclingKey={`tn-${r.id}-${idx}`}
                      />
                      <Text style={styles.dateLine}>{new Date(r.taken_at!).toLocaleDateString()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          );
        }}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>Nothing from this day yet — come back as your library grows.</Text>}
      />
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
  yearBlock: { marginBottom: theme.spacing.lg },
  yearTitle: {
    color: theme.colors.onSurface,
    fontSize: 15,
    fontWeight: "700",
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  strip: { gap: 8, paddingHorizontal: theme.spacing.lg },
  thumb: { width: 108, height: 108, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceContainer },
  dateLine: { color: theme.colors.onSurfaceVariant, fontSize: 10, marginTop: 3, width: 108 },
  listContent: { paddingBottom: 40 },
  empty: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, marginTop: 40, marginHorizontal: theme.spacing.xl, lineHeight: 20 },
});
