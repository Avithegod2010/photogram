import React from "react";
import { StyleSheet, View } from "react-native";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import { AppBar, AppText, Screen, Section } from "../ui";

export function GalleryPlaceholderScreen() {
  return (
    <Screen>
      <AppBar title={t("tabs.gallery")} large />
      <Section style={styles.section}>
        <View style={styles.card}>
          <AppText variant="body" color={theme.colors.onSurfaceVariant}>
            The masonry timeline reads exclusively from your local SQLite cache. It arrives in Step 5
            together with the photo viewer.
          </AppText>
          <AppText variant="caption" color={theme.colors.onSurfaceVariant}>
            Login engine: live · Database schema: ready
          </AppText>
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  card: {
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
});
