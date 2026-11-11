import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as QuickActions from "expo-quick-actions";
import { createNavigationContainerRef } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { useAuthStore } from "./src/auth/authStore";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RootNavigator } from "./src/navigation";
import { purgeExpiredTrash } from "./src/lib/trash";
import { recoverInterruptedUploads, repairTakenAtUnits } from "./src/db/queries";
import { startAutoBackupLoop } from "./src/lib/autoBackup";
import { getRecentAutoAlbum, albumDef } from "./src/lib/albums";
import { buildShortcutItems, parseShortcutId } from "./src/lib/shortcuts";
import { syncWallpaperConfig } from "./src/lib/wallpaper";
import { consumeSharedInbox } from "./src/lib/sharedInbox";
import { maybeRunDbMaintenance } from "./src/lib/dbMaintenance";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { DialogHost } from "./src/ui";
import { recordStartup } from "./src/lib/startup";
import Constants from "expo-constants";
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
        // v0.55 dynamic shortcuts: the newest auto-album replaces the static
        // fourth slot, so the launcher shows where the last photo landed.
        const recent = await getRecentAutoAlbum().catch(() => null);
        await QuickActions.setItems(buildShortcutItems(recent));
      } catch {}
    })();
    try {
      sub = QuickActions.addListener((action) => {
        const nav = navigationRef.current;
        if (!nav) return;
        const target = parseShortcutId(action?.id);
        if (!target) return;
        if (target.kind === "gallery") nav.navigate("Tabs", { screen: "Gallery" });
        else if (target.kind === "albums") nav.navigate("Albums");
        else if (target.kind === "settings") nav.navigate("Tabs", { screen: "Settings" });
        else if (target.kind === "album") {
          const def = albumDef(target.albumKey);
          if (def) nav.navigate("Album", { key: def.key, label: def.label });
        }
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
    // v0.55 startup budget: one sample per cold start (App.tsx imports the
    // module at the top, so BOOT_AT is the earliest JS timestamp we can trust).
    void recordStartup(Constants.expoConfig?.version ?? "unknown").catch(() => {});
    // Cold-start speed pass: only the core (trash purge + the backup loop)
    // starts immediately; everything else is deferred well past the first
    // frame so the gallery appears fast. App kill before the timeout just
    // means those loops run next launch (they are all idempotent gates).
    void purgeExpiredTrash().catch(() => {});
    void repairTakenAtUnits().catch(() => {});
    // Anything left "active"/"uploading" by a kill goes back in the queue before
    // the worker looks for work (otherwise it is stranded forever).
    void recoverInterruptedUploads().catch(() => {});
    startAutoBackupLoop();
    const t = setTimeout(() => {
      startJunkAutoSweepLoop();
      startScheduledIntegrityLoop();
      startSnapshotLoop();
      startUploadWindowLoop();
      startWidgetStateLoop();
      // v0.55: refresh the native wallpaper list (no-op when the toggle is off).
      void syncWallpaperConfig().catch(() => {});
      // v0.55: move anything another app shared with us into the gallery.
      void consumeSharedInbox().catch(() => {});
      // v0.55: weekly WAL checkpoint / planner stats / occasional VACUUM.
      void maybeRunDbMaintenance().catch(() => {});
      startGroupSync();
      startNotifyLoop();
      void syncPendingNotes().catch(() => {});
    }, 10_000);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {phase === "ready" ? (
          <ErrorBoundary>
            <NavigationContainer ref={navigationRef}>
              <RootNavigator />
            </NavigationContainer>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary>
            <LoginScreen />
          </ErrorBoundary>
        )}
        {/* One imperative dialog host for the whole app (confirmDialog/alertDialog). */}
        <DialogHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});
