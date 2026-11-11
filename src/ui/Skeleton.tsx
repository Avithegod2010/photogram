import React from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "../theme";

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** Announce once per loading region, not on every block. */
  label?: string;
};

/**
 * A tonal placeholder for a first load. This is deliberately static: the old
 * withRepeat/withTiming pulse crashed the Reanimated UI thread on device
 * ("undefined is not a function" at timing -> repeat -> set) and took the whole
 * process down. A static block still gives the layout before the data, without
 * an infinite loop or a UI-runtime animation.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = theme.radius.thumb,
  style,
  label,
}: SkeletonProps) {
  return (
    <View
      accessible={!!label}
      accessibilityRole={label ? "progressbar" : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? "auto" : "no-hide-descendants"}
      style={[
        styles.block,
        { width, height, borderRadius: radius },
        style,
      ]}
    />
  );
}

/** A 4-column grid of tiles for a first load. */
export function GallerySkeleton({ label = "Loading photos" }: { label?: string }) {
  return (
    <View style={styles.grid} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton
          key={i}
          width="23%"
          height={i % 3 === 0 ? 118 : 92}
          radius={theme.radius.thumb}
          style={styles.cell}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: theme.colors.surfaceHighest,
    opacity: 0.75,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing.xs,
  },
  cell: { margin: 2 },
});
