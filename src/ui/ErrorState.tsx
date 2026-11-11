import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

export type ErrorStateProps = {
  title: string;
  body?: string;
  retryLabel?: string;
  onRetry?: () => void;
  /** Show a compact inline error (inside a card) instead of a full screen. */
  compact?: boolean;
};

/** What happened + retry. Never a blank screen, never a raw exception. */
export function ErrorState({
  title,
  body,
  retryLabel = "Try again",
  onRetry,
  compact = false,
}: ErrorStateProps) {
  return (
    <View style={[styles.root, compact && styles.compact]} accessibilityRole="alert">
      <View style={styles.iconCircle}>
        <Ionicons name="alert-circle-outline" size={26} color={theme.colors.error} importantForAccessibility="no" />
      </View>
      <AppText variant="title3" align="center" accessibilityRole="header">
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" color={theme.colors.onSurfaceVariant} align="center" style={styles.body}>
          {body}
        </AppText>
      ) : null}
      {onRetry ? (
        <Button label={retryLabel} onPress={onRetry} variant="secondary" icon="refresh" style={styles.action} />
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
    backgroundColor: theme.colors.errorSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.xs,
  },
  body: { maxWidth: 340, marginTop: theme.spacing.xs },
  action: { marginTop: theme.spacing.compact },
});
