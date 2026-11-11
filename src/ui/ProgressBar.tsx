import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "../theme";
import { AppText } from "./AppText";

export type ProgressBarProps = {
  /** 0..1. Clamped. */
  progress: number;
  label: string;
  valueText?: string;
  tone?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Announce updates to TalkBack (use for backup progress, not decoration). */
  live?: boolean;
};

/** A determinate bar with real progress semantics for screen readers. */
export function ProgressBar({
  progress,
  label,
  valueText,
  tone = theme.colors.accent,
  height = 6,
  style,
  live = false,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const percent = Math.round(clamped * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: valueText }}
      accessibilityLiveRegion={live ? "polite" : "none"}
      style={style}
    >
      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        <View
          style={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: height / 2,
            backgroundColor: tone,
          }}
        />
      </View>
      {valueText ? (
        <AppText variant="caption" color={theme.colors.onSurfaceVariant} style={styles.value}>
          {valueText}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: "100%",
    backgroundColor: theme.colors.surfaceHighest,
    overflow: "hidden",
  },
  value: { marginTop: theme.spacing.xs },
});
