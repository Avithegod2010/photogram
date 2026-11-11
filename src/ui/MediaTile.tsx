import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";
import type { MediaStatus } from "./Badge";
import { t } from "../lib/i18n";

export type MediaTileProps = {
  uri?: string | null;
  aspectRatio?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Read by TalkBack: describe the photo, not just "image". */
  accessibilityLabel: string;
  accessibilityHint?: string;
  selected?: boolean;
  selectionMode?: boolean;
  favorite?: boolean;
  /** Shows a small play glyph for videos. */
  video?: boolean;
  /** Small date chip in the corner. */
  dateBadge?: string | null;
  /** Icon+colour status cue; the label is spoken through accessibilityLabel. */
  status?: MediaStatus | null;
  /** Tapping the heart on an already-favorited tile removes it. */
  onFavoritePress?: () => void;
  favoriteLabel?: string;
  dimmed?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const STATUS_ICON: Record<MediaStatus, keyof typeof Ionicons.glyphMap> = {
  local: "phone-portrait",
  queued: "time",
  uploading: "cloud-upload",
  synced: "cloud-done",
  failed: "alert-circle",
};

/**
 * One photo tile for every grid in the app. Edge-to-edge friendly: no card, a
 * 4dp radius, and only the metadata that matters (favorite, date, backup state).
 */
export function MediaTile({
  uri,
  aspectRatio,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  selected = false,
  selectionMode = false,
  favorite = false,
  video = false,
  onFavoritePress,
  favoriteLabel,
  dateBadge,
  status,
  dimmed = false,
  radius = theme.radius.thumb,
  style,
  testID,
}: MediaTileProps) {
  const statusMeta = status ? theme.status[status] : undefined;
  const label = `${accessibilityLabel}${statusMeta ? `, ${t(`status.${status}`)}` : ""}${
    selectionMode ? `. ${selected ? t("common.selected") : t("common.notSelected")}` : ""
  }`;

  const inner = (
    <>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={uri}
          cachePolicy="memory-disk"
          transition={120}
          accessible={false}
        />
      ) : (
        <View style={StyleSheet.absoluteFill} />
      )}
      {dimmed ? <View style={styles.dim} /> : null}

      {selectionMode ? (
        <View style={styles.tick}>
          <Ionicons
            name={selected ? "checkmark-circle" : "ellipse-outline"}
            size={20}
            color={selected ? theme.colors.accent : theme.colors.onViewer}
            style={styles.iconShadow}
          />
        </View>
      ) : favorite && onFavoritePress ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onFavoritePress();
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={favoriteLabel ?? t("gallery.removeFavorite")}
          style={styles.favorite}
        >
          <Ionicons name="heart" size={14} color={theme.colors.accent} style={styles.iconShadow} />
        </Pressable>
      ) : favorite ? (
        <View style={styles.favorite}>
          <Ionicons name="heart" size={14} color={theme.colors.accent} style={styles.iconShadow} />
        </View>
      ) : null}

      {status && status !== "synced" && statusMeta ? (
        <View style={[styles.status, { backgroundColor: statusMeta.soft }]}>
          <Ionicons name={STATUS_ICON[status]} size={12} color={statusMeta.color} />
        </View>
      ) : null}

      {video ? (
        <View style={styles.videoFlag}>
          <Ionicons name="play" size={10} color={theme.colors.onViewer} />
        </View>
      ) : null}

      {dateBadge ? (
        <View style={[styles.dateBadge, video && styles.dateBadgeAfterVideo]}>
          <AppText variant="caption2" weight="semibold" color={theme.colors.onViewer} numberOfLines={1}>
            {dateBadge}
          </AppText>
        </View>
      ) : null}
    </>
  );

  const baseStyle = [
    styles.tile,
    { aspectRatio, borderRadius: radius },
    selected && styles.selected,
    style,
  ];

  if (!onPress && !onLongPress) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        style={baseStyle}
        testID={testID}
      >
        {inner}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: selectionMode ? selected : undefined }}
      style={({ pressed }) => [...baseStyle, pressed && styles.pressed]}
      testID={testID}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  selected: { borderWidth: 2, borderColor: theme.colors.accent },
  pressed: { opacity: 0.85 },
  dim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.mediaScrim,
  },
  tick: { position: "absolute", left: theme.spacing.xs, top: theme.spacing.xs },
  favorite: { position: "absolute", left: theme.spacing.xs, top: theme.spacing.xs },
  status: {
    position: "absolute",
    right: theme.spacing.xs,
    top: theme.spacing.xs,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dateBadge: {
    position: "absolute",
    left: theme.spacing.xs,
    bottom: theme.spacing.xs,
    backgroundColor: theme.colors.mediaScrim,
    borderRadius: theme.radius.thumb,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  dateBadgeAfterVideo: { left: theme.spacing.xl - theme.spacing.xs },
  videoFlag: {
    position: "absolute",
    left: theme.spacing.xs,
    bottom: theme.spacing.xs,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.mediaScrimStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  iconShadow: {
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
