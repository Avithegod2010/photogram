import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

export type EmptyStateProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** For a section-sized gap rather than a whole screen. */
  compact?: boolean;
};

/** Why this is empty + the one next action. Used by every data screen. */
export function EmptyState({
  icon = "images-outline",
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact = false,
}: EmptyStateProps) {
  return (
    <View style={[styles.root, compact && styles.compact]}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={26} color={theme.colors.accent} importantForAccessibility="no" />
      </View>
      <AppText variant="title2" align="center" accessibilityRole="header">
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" color={theme.colors.onSurfaceVariant} align="center" style={styles.body}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Button label={secondaryLabel} onPress={onSecondary} variant="quiet" style={styles.secondary} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  compact: { paddingVertical: theme.spacing.lg },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.xs,
  },
  body: { maxWidth: 340, marginTop: theme.spacing.xs },
  action: { marginTop: theme.spacing.compact },
  secondary: { marginTop: theme.spacing.xs },
});
