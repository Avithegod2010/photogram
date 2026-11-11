import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";
import { t } from "../lib/i18n";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "error" | "info";

const TONES: Record<BadgeTone, { fg: string; bg: string }> = {
  neutral: { fg: theme.colors.onSurfaceVariant, bg: theme.colors.surfaceHighest },
  accent: { fg: theme.colors.onAccentSoft, bg: theme.colors.accentSoft },
  success: { fg: theme.colors.success, bg: theme.colors.successSoft },
  warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
  error: { fg: theme.colors.error, bg: theme.colors.errorSoft },
  info: { fg: theme.colors.onSurfaceVariant, bg: theme.colors.infoSoft },
};

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
};

/** Small state label. Always text + colour; the icon is an extra cue. */
export function Badge({ label, tone = "neutral", icon, style }: BadgeProps) {
  const c = TONES[tone];
  return (
    <View
      style={[styles.badge, { backgroundColor: c.bg }, style]}
      accessible
      accessibilityLabel={label}
    >
      {icon ? (
        <Ionicons name={icon} size={13} color={c.fg} importantForAccessibility="no" />
      ) : null}
      <AppText variant="caption" weight="semibold" color={c.fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

export type MediaStatus = "local" | "queued" | "uploading" | "synced" | "failed";

const STATUS_ICON: Record<MediaStatus, keyof typeof Ionicons.glyphMap> = {
  local: "phone-portrait-outline",
  queued: "time-outline",
  uploading: "cloud-upload-outline",
  synced: "cloud-done-outline",
  failed: "alert-circle-outline",
};

/**
 * The backup vocabulary: one icon + one label + one colour per state, used on
 * the gallery, the viewer, storage and the heartbeat line. Never colour alone.
 */
export function StatusBadge({ status, style }: { status: MediaStatus; style?: StyleProp<ViewStyle> }) {
  const c = theme.status[status];
  const label = t(`status.${status}`);
  return (
    <View
      style={[styles.badge, { backgroundColor: c.soft }, style]}
      accessible
      accessibilityLabel={label}
    >
      <Ionicons name={STATUS_ICON[status]} size={13} color={c.color} importantForAccessibility="no" />
      <AppText variant="caption" weight="semibold" color={c.color} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing.xs,
    minHeight: 24,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
});
