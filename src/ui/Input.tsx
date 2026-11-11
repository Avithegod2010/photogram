import React, { useState } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";

export type InputProps = Omit<TextInputProps, "style"> & {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: keyof typeof Ionicons.glyphMap;
  trailing?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  multiline?: boolean;
  /** Minimum height for multiline editors. */
  minHeight?: number;
};

/**
 * Filled text field: tonal background, 12dp radius, accent boundary only while
 * focused. Label + hint are real text, so the control never relies on a border
 * alone to be identified.
 */
export const Input = React.forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    hint,
    error,
    icon,
    trailing,
    containerStyle,
    multiline,
    minHeight,
    onFocus,
    onBlur,
    accessibilityLabel,
    ...rest
  },
  ref
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText variant="caption" color={theme.colors.onSurfaceVariant} style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.field,
          multiline && { minHeight: minHeight ?? 110, alignItems: "flex-start" },
          focused && styles.fieldFocused,
          !!error && styles.fieldError,
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={20}
            color={theme.colors.onSurfaceFaint}
            importantForAccessibility="no"
            style={styles.icon}
          />
        ) : null}
        <TextInput
          ref={ref}
          {...rest}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          placeholderTextColor={theme.colors.onSurfaceFaint}
          accessibilityLabel={accessibilityLabel ?? label ?? rest.placeholder}
          accessibilityHint={hint}
          style={[styles.input, multiline && styles.multiline]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {error ? (
        <AppText
          variant="captionRegular"
          color={theme.colors.error}
          style={styles.helper}
          accessibilityLiveRegion="polite"
        >
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="captionRegular" color={theme.colors.onSurfaceFaint} style={styles.helper}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: { marginBottom: theme.spacing.xs, marginLeft: theme.spacing.xs },
  field: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: theme.layout.touch,
    paddingHorizontal: theme.spacing.compact,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surfaceHighest,
    borderWidth: 1,
    borderColor: "transparent",
  },
  fieldFocused: { borderColor: theme.colors.accent },
  fieldError: { borderColor: theme.colors.error },
  icon: { marginRight: theme.spacing.sm },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.onSurface,
    ...theme.typography.body,
    padding: 0,
  },
  multiline: {
    textAlignVertical: "top",
    paddingTop: theme.spacing.compact,
    paddingBottom: theme.spacing.compact,
  },
  trailing: { marginLeft: theme.spacing.sm },
  helper: { marginTop: theme.spacing.xs, marginLeft: theme.spacing.xs },
});
