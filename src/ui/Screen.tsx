import React from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { theme } from "../theme";

export type ScreenProps = {
  children: React.ReactNode;
  /** Wrap content in a ScrollView (most utility screens). */
  scroll?: boolean;
  /** Horizontal gutter of 16dp on the content. Tab screens usually want it. */
  padded?: boolean;
  /** Which safe-area edges to respect. Default top only (tab bar owns bottom). */
  edges?: Array<"top" | "bottom">;
  background?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: ScrollViewProps["refreshControl"];
  scrollProps?: Omit<
    ScrollViewProps,
    "contentContainerStyle" | "refreshControl" | "style" | "children"
  >;
  testID?: string;
  /** Light status-bar icons (default) or dark (only for a white surface). */
  statusBarStyle?: "light" | "dark";
};

/**
 * The one screen container. Handles the status bar, safe-area top, a single
 * background colour and — when scrolling — a bottom gutter that clears the
 * tab bar. Edge-to-edge screens (Gallery, Viewer) pass padded={false}.
 */
export function Screen({
  children,
  scroll = false,
  padded = false,
  edges = ["top"],
  background = theme.colors.background,
  style,
  contentContainerStyle,
  refreshControl,
  scrollProps,
  testID,
  statusBarStyle = "light",
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const top = edges.includes("top") ? insets.top : 0;
  const bottom = edges.includes("bottom") ? insets.bottom : 0;

  const paddedStyle = padded ? styles.padded : null;

  if (!scroll) {
    return (
      <View
        testID={testID}
        style={[styles.root, { backgroundColor: background, paddingTop: top }, style]}
      >
        <StatusBar style={statusBarStyle} />
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: background }, style]} testID={testID}>
      <StatusBar style={statusBarStyle} />
      <ScrollView
        {...scrollProps}
        style={styles.flex}
        contentContainerStyle={[
          { paddingTop: top + theme.spacing.md, paddingBottom: bottom + theme.spacing.xl },
          paddedStyle,
          contentContainerStyle,
        ]}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  padded: { paddingHorizontal: theme.spacing.md },
});
