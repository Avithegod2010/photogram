import React, { useEffect } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
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
 * A tonal placeholder that pulses. No spinner-on-blank: the layout is visible
 * before the data is. Reduced motion gets a static tone.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = theme.radius.thumb,
  style,
  label,
}: SkeletonProps) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    if (reduced) {
      pulse.set(0.7);
      return;
    }
    pulse.set(withRepeat(withTiming(1, { duration: 900, easing: undefined }), -1, true));
  }, [pulse, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <Animated.View
      accessible={!!label}
      accessibilityRole={label ? "progressbar" : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? "auto" : "no-hide-descendants"}
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.colors.surfaceHighest },
        style,
        animated,
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing.xs,
  },
  cell: { margin: 2 },
});
