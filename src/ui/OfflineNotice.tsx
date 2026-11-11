import React from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNetworkState } from "expo-network";
import { theme } from "../theme";
import { AppText } from "./AppText";
import { t } from "../lib/i18n";

/**
 * A quiet, non-blocking offline line. Local data still works; only backup is
 * paused, so this never takes over the screen. `useNetworkState` subscribes
 * and cleans itself up.
 */
export function OfflineNotice({ detail, inset = true }: { detail?: string; inset?: boolean }) {
  const net = useNetworkState();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  if (!offline) return null;

  return (
    <View
      style={[styles.root, !inset && styles.noInset]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={theme.colors.warning} importantForAccessibility="no" />
      <AppText variant="caption" color={theme.colors.warning} style={styles.text}>
        {detail ?? t("state.offlineBody")}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.warningSoft,
  },
  text: { flex: 1, minWidth: 0 },
  noInset: { marginHorizontal: 0 },
});
