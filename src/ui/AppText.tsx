import React from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { theme, type TypeVariant } from "../theme";

export type AppTextProps = TextProps & {
  /** One of the eight scale presets. Never pass a raw fontSize in new UI. */
  variant?: TypeVariant;
  color?: string;
  align?: TextStyle["textAlign"];
  weight?: keyof typeof theme.type.weight;
  /** Adds tabular figures for counters and scores. */
  tabular?: boolean;
};

/**
 * All UI text goes through here so hierarchy is decided by the scale, not by
 * one-off font sizes. Font scaling is left ON (the accessibility gate requires
 * 200%); layouts should flex rather than clip.
 */
export const AppText = React.forwardRef<Text, AppTextProps>(function AppText(
  { variant = "body", color, align, weight, tabular, style, ...rest },
  ref
) {
  return (
    <Text
      ref={ref}
      {...rest}
      style={[
        theme.typography[variant],
        color ? { color } : null,
        align ? { textAlign: align } : null,
        weight ? { fontWeight: theme.type.weight[weight] } : null,
        tabular ? { fontVariant: ["tabular-nums"] } : null,
        style,
      ]}
    />
  );
});
