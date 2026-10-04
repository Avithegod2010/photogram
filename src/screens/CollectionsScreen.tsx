import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listSavedSearches, SavedSearchRow } from "../db/queries";
import { theme } from "../theme";

type CollectionsNav = NativeStackNavigationProp<{
  Trash: undefined;
  Map: undefined;
  Albums: undefined;
  Archive: undefined;
  Hidden: undefined;
  SharedAlbums: undefined;
  SafetyCheck: undefined;
  Favorites: undefined;
  Wrapped: undefined;
  Journal: undefined;
  Highlights: undefined;
  Similar: { mode?: "similar" | "groups"; mediaId?: number };
  SavedSearch: { id: number };
  PeopleSetup: undefined;
}>;

const SECTIONS = [
  { key: "albums", label: "Albums", sub: "Camera, Screenshots, WhatsApp, Downloads & more", enabled: true, route: "Albums" },
  { key: "shared", label: "Shared albums", sub: "Family photos from a private Telegram group", enabled: true, route: "SharedAlbums" },
  { key: "favorites", label: "Favorites", sub: "Every photo you marked with a ♥", enabled: true, route: "Favorites" },
  { key: "wrapped", label: "2026 Wrapped", sub: "Your year in photos — totals, top days, favorites", enabled: true, route: "Wrapped" },
  { key: "journal", label: "Journal", sub: "Every note you wrote, as a diary across the years", enabled: true, route: "Journal" },
  { key: "highlights", label: "Highlights", sub: "The sharpest shots of each month, auto-curated", enabled: true, route: "Highlights" },
  { key: "duplicates", label: "Find duplicates", sub: "Near-identical photos — bursts, forwards and re-saves", enabled: true, route: "Similar" },
  { key: "people", label: "People & Pets", sub: "Face grouping — pick a model to start (on-device)", enabled: true, route: "PeopleSetup" },
  { key: "archive", label: "Archive", sub: "Decluttered media — hidden from the main timeline", enabled: true, route: "Archive" },
  { key: "trash", label: "Trash", sub: "Deleted items · 30-day countdown", enabled: true, route: "Trash" },
  { key: "map", label: "Map", sub: "Photos placed on the world by GPS data", enabled: true, route: "Map" },
  { key: "hidden", label: "Hidden", sub: "Locked behind your fingerprint or face", enabled: true, route: "Hidden" },
  { key: "safety", label: "Safety check", sub: "What exists only on this phone?", enabled: true, route: "SafetyCheck" },
] as const;

export function CollectionsScreen({ navigation }: { navigation: CollectionsNav }) {
  const insets = useSafeAreaInsets();
  // v0.27 Smart albums: saved searches refresh on every visit to this tab.
  const [saved, setSaved] = useState<SavedSearchRow[] | null>(null);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      void listSavedSearches()
        .then(setSaved)
        .catch(() => setSaved([]));
    });
    return unsub;
  }, [navigation]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <Text style={styles.title}>Collections</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.card, { marginBottom: theme.spacing.md }]}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Smart albums</Text>
              <Text style={styles.rowSub}>
                Searches you pinned — they update automatically
              </Text>
            </View>
          </View>
          {(saved ?? []).map((s) => (
            <Pressable
              key={s.id}
              style={styles.row}
              android_ripple={{ color: theme.colors.outlineVariant }}
              onPress={() => navigation.navigate("SavedSearch", { id: s.id })}
            >
              <View style={styles.dot} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.rowSub}>Search "{s.query}"</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
          {saved !== null && saved.length === 0 ? (
            <View style={[styles.row, styles.disabled]}>
              <View style={styles.rowText}>
                <Text style={styles.rowSub}>
                  Nothing pinned yet — search in the gallery and tap 🔖 to save it here.
                </Text>
              </View>
            </View>
          ) : null}
        </View>
        <View style={styles.card}>
          {SECTIONS.map((s) => {
            const content = (
              <>
                <View style={[styles.dot, s.key === "hidden" && styles.dotAccent]} />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{s.label}</Text>
                  <Text style={styles.rowSub}>{s.sub}</Text>
                </View>
                {s.enabled ? <Text style={styles.chevron}>›</Text> : null}
              </>
            );
            if (s.enabled) {
              return (
                <Pressable
                  key={s.key}
                  onPress={() => navigation.navigate(s.route as never)}
                  android_ripple={{ color: theme.colors.outlineVariant }}
                  style={styles.row}
                >
                  {content}
                </Pressable>
              );
            }
            return (
              <View key={s.key} style={[styles.row, styles.disabled]}>
                {content}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.md },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  title: { color: theme.colors.onSurface, fontSize: 28, fontWeight: "700", marginBottom: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outlineVariant,
  },
  disabled: { opacity: 0.55 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary },
  dotAccent: { backgroundColor: theme.colors.error },
  rowText: { flex: 1 },
  rowLabel: { color: theme.colors.onSurface, fontSize: 15.5, fontWeight: "600" },
  rowSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  chevron: { color: theme.colors.onSurfaceVariant, fontSize: 22 },
});
