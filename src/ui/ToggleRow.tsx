import React from "react";
import { Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "../theme";
import { AppText } from "./AppText";

export type ToggleRowProps = {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * A whole-row switch. The row is the accessible switch (role + checked state);
 * the visual Switch is decoration so TalkBack never announces two controls.
 */
export function ToggleRow({ title, subtitle, value, onValueChange, disabled, style }: ToggleRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityState={{ checked: value, disabled: disabled || undefined }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      android_ripple={{ color: theme.colors.surfaceHover }}
      style={({ pressed }) => [
        styles.row,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View style={styles.text}>
        <AppText variant="body" weight="medium" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText
            variant="footnote"
            color={theme.colors.onSurfaceVariant}
            numberOfLines={5}
            style={styles.subtitle}
          >
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none">
        <Switch
          value={value}
          disabled={disabled}
          trackColor={{ false: theme.colors.surfaceHighest, true: theme.colors.accent }}
          thumbColor={value ? theme.colors.onAccent : theme.colors.onSurfaceVariant}
          ios_backgroundColor={theme.colors.surfaceHighest}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.compact,
    minHeight: theme.layout.row,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.compact,
  },
  text: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: 2 },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: theme.colors.surfaceHover },
});
