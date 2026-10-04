import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listNotedMedia, MediaRow } from "../db/queries";
import { theme } from "../theme";

// v0.32 Journal: every photo note (v0.17) as a diary. "Today across the
// years" on top — notes written on this calendar day in any year — then all
// notes grouped by year, newest first.
export function JournalScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MediaRow[] | null>(null);

  useEffect(() => {
    void listNotedMedia()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

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

  const entry = (row: MediaRow) => (
    <Pressable
      key={String(row.id)}
      style={styles.row}
      onPress={() =>
        navigation.navigate("Viewer", { ids: all.map((r) => r.id), index: all.findIndex((r) => r.id === row.id) })
      }
      android_ripple={{ color: theme.colors.outlineVariant }}
    >
      <Image source={{ uri: row.thumb_uri }} style={styles.thumb} contentFit="cover" recyclingKey={`jr-${row.id}`} />
      <View style={{ flex: 1 }}>
        <Text style={styles.note} numberOfLines={3}>
          {row.note_text}
        </Text>
        <Text style={styles.date}>{new Date(row.taken_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Journal</Text>
          <Text style={styles.sub}>{all.length} note{all.length === 1 ? "" : "s"} written on your photos</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {rows === null ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : all.length === 0 ? (
          <Text style={styles.empty}>
            No notes yet. Open any photo → Note, write something — it shows up here and travels as
            the caption in your Telegram backup.
          </Text>
        ) : (
          <>
            {todayEntries.length > 0 ? (
              <>
                <Text style={styles.yearTitle}>
                  Today across the years · {today.getDate()} {today.toLocaleString(undefined, { month: "long" })}
                </Text>
                {todayEntries.map(entry)}
              </>
            ) : null}
            {years.map((year) => (
              <View key={String(year)}>
                <Text style={styles.yearTitle}>{year}</Text>
                {(byYear.get(year) ?? []).map(entry)}
              </View>
            ))}
          </>
        )}
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
  sub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  content: { paddingBottom: 40, paddingHorizontal: theme.spacing.lg },
  yearTitle: {
    color: theme.colors.onSurface,
    fontSize: 16,
    fontWeight: "700",
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outlineVariant,
  },
  thumb: { width: 56, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceHighest },
  note: { color: theme.colors.onSurface, fontSize: 14, lineHeight: 19 },
  date: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 4 },
  empty: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, marginTop: 40, lineHeight: 20 },
});
