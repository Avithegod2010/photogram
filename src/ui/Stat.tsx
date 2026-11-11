import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";

export type StatProps = {
  value: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: string;
  style?: StyleProp<ViewStyle>;
};

/** A number with a name. Tabular figures so counters do not jitter. */
export function Stat({ value, label, icon, tone, style }: StatProps) {
  return (
    <View style={[styles.root, style]} accessible accessibilityLabel={`${label}: ${value}`}>
      {icon ? (
        <Ionicons
          name={icon}
          size={16}
          color={tone ?? theme.colors.onSurfaceFaint}
          importantForAccessibility="no"
        />
      ) : null}
      <AppText variant="title2" weight="semibold" color={tone} tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </AppText>
      <AppText variant="captionRegular" color={theme.colors.onSurfaceVariant} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: theme.spacing.xs,
  },
});
