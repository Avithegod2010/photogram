import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { theme } from "../theme";

const SECTIONS = [
  { label: "Albums", sub: "Your own folders, backed up as Telegram albums" },
  { label: "People & Pets", sub: "Face grouping arrives in Phase 2 (on-device ML)" },
  { label: "Archive", sub: "Decluttered media — hidden from the main timeline" },
  { label: "Trash", sub: "Recently deleted items" },
  { label: "Hidden", sub: "Locked behind your fingerprint or face" },
];

export function CollectionsPlaceholderScreen() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.title}>Collections</Text>
      <View style={styles.card}>
        {SECTIONS.map((s) => (
          <View key={s.label} style={styles.row}>
            <View style={[styles.dot, s.label === "Hidden" && styles.dotAccent]} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{s.label}</Text>
              <Text style={styles.rowSub}>{s.sub}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.md },
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
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary },
  dotAccent: { backgroundColor: theme.colors.error },
  rowText: { flex: 1 },
  rowLabel: { color: theme.colors.onSurface, fontSize: 15.5, fontWeight: "600" },
  rowSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
});
