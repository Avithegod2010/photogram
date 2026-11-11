import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";

export type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Leading glyph, 24dp, muted. Use one per group, not per row, where possible. */
  icon?: keyof typeof Ionicons.glyphMap;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  accessory?: "chevron" | "check" | "none";
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
  selected?: boolean;
  /** Text for TalkBack when title+subtitle is not enough. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  minHeight?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The one row. 60dp tall by default (grows with 2-line subtitles and large font
 * scales), 16dp gutters, no divider — grouping comes from the Section card.
 */
export function ListRow({
  title,
  subtitle,
  icon,
  leading,
  trailing,
  accessory = "none",
  onPress,
  onLongPress,
  disabled = false,
  danger = false,
  selected = false,
  accessibilityLabel,
  accessibilityHint,
  minHeight = theme.layout.row,
  style,
  testID,
}: ListRowProps) {
  const content = (
    <>
      {leading ??
        (icon ? (
          <Ionicons
            name={icon}
            size={theme.layout.icon}
            color={danger ? theme.colors.error : theme.colors.onSurfaceVariant}
            importantForAccessibility="no"
          />
        ) : null)}
      <View style={styles.text}>
        <AppText
          variant="body"
          weight="medium"
          color={danger ? theme.colors.error : theme.colors.onSurface}
          numberOfLines={2}
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText
            variant="footnote"
            color={theme.colors.onSurfaceVariant}
            numberOfLines={4}
            style={styles.subtitle}
          >
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ??
        (accessory === "chevron" ? (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={theme.colors.onSurfaceFaint}
            importantForAccessibility="no"
          />
        ) : accessory === "check" && selected ? (
          <Ionicons name="checkmark" size={22} color={theme.colors.accent} importantForAccessibility="no" />
        ) : null)}
    </>
  );

  if (!onPress && !onLongPress) {
    return (
      <View style={[styles.row, { minHeight }, style]} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || undefined, selected }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: theme.colors.surfaceHover }}
      style={({ pressed }) => [
        styles.row,
        { minHeight },
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.compact,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.compact,
  },
  text: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: 2 },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: theme.colors.surfaceHover },
});
