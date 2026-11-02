import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as QuickActions from "expo-quick-actions";
import { createNavigationContainerRef } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { useAuthStore } from "./src/auth/authStore";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RootNavigator } from "./src/navigation";
import { purgeExpiredTrash } from "./src/lib/trash";
import { repairTakenAtUnits } from "./src/db/queries";
import { startAutoBackupLoop } from "./src/lib/autoBackup";
import { startJunkAutoSweepLoop } from "./src/lib/junkAutoSweep";
import { startScheduledIntegrityLoop } from "./src/lib/integritySchedule";
import { startSnapshotLoop } from "./src/lib/snapshotExport";
import { startUploadWindowLoop } from "./src/lib/uploadWindow";
import { startWidgetStateLoop } from "./src/lib/widgetState";
import { startGroupSync } from "./src/lib/groupSync";
import { startNotifyLoop } from "./src/lib/notify";
import { syncPendingNotes } from "./src/lib/notes";
import { theme } from "./src/theme";

const navigationRef = createNavigationContainerRef<any>();

export default function App() {
  const phase = useAuthStore((s) => s.phase);

  // v0.53 app shortcuts: set up the launcher shortcuts once and route them.
  useEffect(() => {
    if (phase !== "ready") return;
    let sub: { remove: () => void } | null = null;
    void (async () => {
      try {
        const supported = await QuickActions.isSupported();
        if (!supported) return;
        await QuickActions.setItems([
          { id: "gallery", title: "Open gallery", icon: "search" },
          { id: "albums", title: "Albums", icon: "photo" },
          { id: "settings", title: "Settings", icon: "settings" },
        ]);
      } catch {}
    })();
    try {
      sub = QuickActions.addListener((action) => {
        const nav = navigationRef.current;
        if (!nav) return;
        const id = action?.id;
        if (id === "gallery") nav.navigate("Tabs", { screen: "Gallery" });
        else if (id === "albums") nav.navigate("Albums");
        else if (id === "settings") nav.navigate("Tabs", { screen: "Settings" });
      });
    } catch {}
    return () => {
      try {
        sub?.remove();
      } catch {}
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "ready") return;
    // Cold-start speed pass: only the core (trash purge + the backup loop)
    // starts immediately; everything else is deferred well past the first
    // frame so the gallery appears fast. App kill before the timeout just
    // means those loops run next launch (they are all idempotent gates).
    void purgeExpiredTrash().catch(() => {});
    void repairTakenAtUnits().catch(() => {});
    startAutoBackupLoop();
    const t = setTimeout(() => {
      startJunkAutoSweepLoop();
      startScheduledIntegrityLoop();
      startSnapshotLoop();
      startUploadWindowLoop();
      startWidgetStateLoop();
      startGroupSync();
      startNotifyLoop();
      void syncPendingNotes().catch(() => {});
    }, 10_000);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar style="light" />
      {phase === "ready" ? (
        <NavigationContainer ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
      ) : (
        <LoginScreen />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});
