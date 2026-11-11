import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { AppText } from "./AppText";

export type SectionProps = {
  /** 13/600 muted label. Never uppercase, never accent. */
  title?: string;
  subtitle?: string;
  /** One leading glyph for the whole group — not one per row. */
  icon?: keyof typeof Ionicons.glyphMap;
  action?: React.ReactNode;
  footer?: string;
  children: React.ReactNode;
  /** Cards are tonal surfaces, not bordered boxes. */
  card?: boolean;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * A group of rows with one heading. Space separates groups; the card is a
 * tonal step, not a border. Rows inside carry their own 60dp rhythm.
 */
export function Section({
  title,
  subtitle,
  icon,
  action,
  footer,
  children,
  card = true,
  danger = false,
  style,
  contentStyle,
}: SectionProps) {
  return (
    <View style={[styles.root, style]}>
      {title || action ? (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title ? (
              <View style={styles.titleRow}>
                {icon ? (
                  <Ionicons
                    name={icon}
                    size={16}
                    color={danger ? theme.colors.error : theme.colors.onSurfaceFaint}
                    importantForAccessibility="no"
                  />
                ) : null}
                <AppText
                  variant="callout"
                  color={danger ? theme.colors.error : theme.colors.onSurfaceVariant}
                  accessibilityRole="header"
                >
                  {title}
                </AppText>
              </View>
            ) : null}
            {subtitle ? (
              <AppText variant="captionRegular" color={theme.colors.onSurfaceFaint} style={styles.subtitle}>
                {subtitle}
              </AppText>
            ) : null}
          </View>
          {action ? <View style={styles.action}>{action}</View> : null}
        </View>
      ) : null}
      <View
        style={[
          card && styles.card,
          danger && card && styles.cardDanger,
          card ? null : styles.bare,
          contentStyle,
        ]}
      >
        {children}
      </View>
      {footer ? (
        <AppText variant="captionRegular" color={theme.colors.onSurfaceFaint} style={styles.footer}>
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: theme.spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs },
  subtitle: { marginTop: 2 },
  action: { flexShrink: 0 },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.card,
    overflow: "hidden",
  },
  cardDanger: { backgroundColor: theme.colors.surfaceContainer },
  bare: { backgroundColor: "transparent" },
  footer: { marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.xs },
});
