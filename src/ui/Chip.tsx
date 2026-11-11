import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";

export type ChipProps = {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  /** Overrides the visible label for TalkBack. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** A 40dp filter chip with a 48dp touch area. Selected = accent tint + label. */
export function Chip({
  label,
  onPress,
  selected = false,
  icon,
  disabled = false,
  accessibilityLabel,
  style,
}: ChipProps) {
  const fg = selected ? theme.colors.onAccentSoft : theme.colors.onSurfaceVariant;
  const content = (
    <>
      {icon ? (
        <Ionicons name={icon} size={16} color={fg} importantForAccessibility="no" />
      ) : null}
      <AppText variant="callout" color={fg} numberOfLines={2}>
        {label}
      </AppText>
    </>
  );

  const base = [
    styles.chip,
    selected ? styles.selected : styles.unselected,
    disabled && styles.disabled,
    style,
  ];

  if (!onPress) {
    return (
      <View style={base} accessible accessibilityLabel={accessibilityLabel ?? label}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 4, bottom: 4 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled: disabled || undefined }}
      android_ripple={{ color: theme.colors.surfaceHover, borderless: true }}
      style={base}
    >
      {content}
    </Pressable>
  );
}

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  accessibilityLabel?: string;
};

/** Compact mutually-exclusive control (timeline zoom, upload quality). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
  accessibilityLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <View style={[styles.segmented, style]} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            hitSlop={{ top: 4, bottom: 4 }}
            accessibilityRole="tab"
            accessibilityLabel={o.accessibilityLabel ?? o.label}
            accessibilityState={{ selected }}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <AppText
              variant="caption"
              weight="semibold"
              color={selected ? theme.colors.onAccentSoft : theme.colors.onSurfaceVariant}
              numberOfLines={1}
            >
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.xs,
    minHeight: 40,
    paddingHorizontal: theme.spacing.compact,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  selected: { backgroundColor: theme.colors.accentSoft },
  unselected: { backgroundColor: theme.colors.surfaceContainer },
  disabled: { opacity: 0.4 },
  segmented: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    padding: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceContainer,
  },
  segment: {
    minHeight: 40,
    minWidth: 48,
    paddingHorizontal: theme.spacing.compact,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: { backgroundColor: theme.colors.accentSoft },
});
