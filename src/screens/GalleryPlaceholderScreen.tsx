import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { theme } from "../theme";

export function GalleryPlaceholderScreen() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.title}>Gallery</Text>
      <View style={styles.card}>
        <Text style={styles.body}>
          The masonry timeline reads exclusively from your local SQLite cache.
          It arrives in Step 5 together with the photo viewer.
        </Text>
        <Text style={styles.hint}>Login engine: live · Database schema: ready</Text>
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
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    gap: theme.spacing.sm,
  },
  body: { color: theme.colors.onSurfaceVariant, fontSize: 14, lineHeight: 21 },
  hint: { color: theme.colors.primary, fontSize: 12.5 },
});
