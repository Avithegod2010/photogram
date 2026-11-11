import React from "react";
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";
import { IconButton } from "./IconButton";

export type AppBarProps = {
  title: string;
  subtitle?: string;
  /** Show a back arrow. Route names never change — this only calls goBack. */
  onBack?: () => void;
  backLabel?: string;
  /** 24dp title for stack screens; 24 is also the hero size for tab roots. */
  large?: boolean;
  actions?: React.ReactNode;
  /** A second row under the title, e.g. a search field. */
  bottom?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Floating chrome over media: uses the overlay colour. */
  floating?: boolean;
  titleColor?: string;
  subtitleColor?: string;
};

/**
 * One header for every screen. Left-aligned title (Android-native), a 48dp
 * back target, and an action slot. No bottom border — the type and spacing do
 * the separating.
 */
export function AppBar({
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  large = false,
  actions,
  bottom,
  style,
  floating = false,
  titleColor,
  subtitleColor,
}: AppBarProps) {
  const { fontScale } = useWindowDimensions();
  // At large OS font scales a text action would squeeze the title to an
  // ellipsis. Give the title the full width and move actions to their own row.
  const stackActions = fontScale > 1.4 && !!actions;
  return (
    <View
      style={[
        styles.root,
        floating && styles.floating,
        large ? styles.large : styles.small,
        style,
      ]}
    >
      <View style={styles.row}>
        {onBack ? (
          <IconButton
            icon="arrow-back"
            label={backLabel}
            onPress={onBack}
            variant={floating ? "onMedia" : "plain"}
            style={styles.back}
          />
        ) : null}
        <View style={styles.titles}>
          <AppText
            variant={large ? "title1" : "title2"}
            color={titleColor}
            numberOfLines={large ? 2 : 1}
            accessibilityRole="header"
            style={styles.title}
          >
            {title}
          </AppText>
          {subtitle ? (
            <AppText
              variant="footnote"
              color={subtitleColor ?? theme.colors.onSurfaceVariant}
              numberOfLines={2}
              style={styles.subtitle}
            >
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions && !stackActions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {stackActions ? <View style={styles.stackedActions}>{actions}</View> : null}
      {bottom ? <View style={styles.bottom}>{bottom}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.background,
  },
  floating: { backgroundColor: theme.colors.overlay },
  small: { minHeight: theme.layout.appBar, justifyContent: "center", paddingTop: theme.spacing.xs },
  large: { paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.compact },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  back: { marginLeft: -theme.spacing.sm },
  titles: { flex: 1, minWidth: 0 },
  title: { flexShrink: 1 },
  subtitle: { marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs },
  stackedActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    paddingLeft: theme.layout.touch,
  },
  bottom: { marginTop: theme.spacing.compact },
});
