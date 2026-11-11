import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { PressableScale } from "./motion";

export type IconButtonVariant = "plain" | "tonal" | "accent" | "onMedia" | "danger";

export type IconButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  /** Required: icon-only controls have no visible text. */
  label: string;
  onPress?: () => void;
  variant?: IconButtonVariant;
  /** Visual diameter. 40 adds hitSlop so the touch target is still 48. */
  size?: 40 | 48;
  disabled?: boolean;
  selected?: boolean;
  /** Small accent dot for an unread/attention state (never the only signal). */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const VARIANTS: Record<
  IconButtonVariant,
  { background: string; color: string }
> = {
  plain: { background: "transparent", color: theme.colors.onSurface },
  tonal: { background: theme.colors.surfaceContainer, color: theme.colors.onSurface },
  accent: { background: theme.colors.accentSoft, color: theme.colors.accent },
  onMedia: { background: theme.colors.mediaScrim, color: theme.colors.onViewer },
  danger: { background: theme.colors.errorSoft, color: theme.colors.error },
};

/** A 48dp circular icon control. Visual size may be 40dp; hitSlop restores 48. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = "plain",
  size = 48,
  disabled = false,
  selected,
  dot,
  style,
  testID,
}: IconButtonProps) {
  const v = VARIANTS[variant];
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.92}
      hitSlop={size === 40 ? 4 : 0}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled: disabled || undefined,
        selected,
      }}
      testID={testID}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: theme.radius.pill,
          backgroundColor: v.background,
        },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={size === 40 ? 22 : theme.layout.icon}
        color={v.color}
        importantForAccessibility="no"
      />
      {dot ? <View style={styles.dot} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
  dot: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accent,
  },
});
