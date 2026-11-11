/**
 * Motion tokens in code. Everything the app animates goes through here so the
 * durations stay in one place and reduced-motion is honoured centrally.
 */
import React, { useCallback } from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { theme } from "../theme";

export const easing = {
  standard: Easing.bezier(0.2, 0, 0, 1),
  enter: Easing.bezier(0.23, 1, 0.32, 1),
  exit: Easing.bezier(0.4, 0, 1, 1),
} as const;

export const duration = theme.motion.duration;

/** True when the OS asks for less movement. Colour/opacity changes stay. */
export function useMotionEnabled(): boolean {
  return !useReducedMotion();
}

/**
 * Pressable with a 0.97 press scale. The hit area never scales, only the
 * contents, so the 48dp target stays exactly where the thumb expects it.
 */
export function PressableScale({
  children,
  style,
  contentStyle,
  scaleTo = 0.97,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  scaleTo?: number;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);

  const handleIn = useCallback<NonNullable<PressableProps["onPressIn"]>>(
    (e) => {
      if (!reduced && !disabled) {
        scale.set(withTiming(scaleTo, { duration: duration.fast, easing: easing.standard }));
      }
      onPressIn?.(e);
    },
    [disabled, onPressIn, reduced, scale, scaleTo]
  );
  const handleOut = useCallback<NonNullable<PressableProps["onPressOut"]>>(
    (e) => {
      scale.set(withTiming(1, { duration: duration.fast, easing: easing.standard }));
      onPressOut?.(e);
    },
    [onPressOut, scale]
  );

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={handleIn}
      onPressOut={handleOut}
      style={style}
    >
      <Animated.View style={[styles.fill, contentStyle, animated]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
