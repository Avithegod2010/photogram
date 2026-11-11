import React from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";
import { PressableScale } from "./motion";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: "leading" | "trailing";
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  /** Overrides the visible label for screen readers. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const HEIGHT: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 52 };

const VARIANTS: Record<ButtonVariant, { bg: string; fg: string }> = {
  primary: { bg: theme.colors.accent, fg: theme.colors.onAccent },
  secondary: { bg: theme.colors.surfaceHighest, fg: theme.colors.onSurface },
  ghost: { bg: "transparent", fg: theme.colors.accent },
  danger: { bg: theme.colors.errorSoft, fg: theme.colors.error },
  quiet: { bg: "transparent", fg: theme.colors.onSurfaceVariant },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "leading",
  disabled = false,
  loading = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const v = VARIANTS[variant];
  const height = HEIGHT[size];
  const iconSize = size === "sm" ? 18 : 20;
  const glyph = icon ? (
    <Ionicons name={icon} size={iconSize} color={v.fg} importantForAccessibility="no" />
  ) : null;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || undefined, busy: loading || undefined }}
      hitSlop={size === "sm" ? 4 : 0}
      testID={testID}
      style={[
        styles.base,
        {
          minHeight: height,
          backgroundColor: v.bg,
          borderRadius: theme.radius.pill,
          paddingHorizontal: size === "sm" ? theme.spacing.md : theme.spacing.lg,
          paddingVertical: theme.spacing.xs,
        },
        fullWidth && styles.fullWidth,
        disabled && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        <>
          {iconPosition === "leading" ? glyph : null}
          <AppText
            variant="body"
            weight="semibold"
            color={v.fg}
            numberOfLines={2}
            style={styles.label}
          >
            {label}
          </AppText>
          {iconPosition === "trailing" ? glyph : null}
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    alignSelf: "flex-start",
  },
  fullWidth: { alignSelf: "stretch" },
  label: { flexShrink: 1, textAlign: "center" },
  disabled: { opacity: 0.45 },
});
