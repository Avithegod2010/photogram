import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { useAuthStore } from "./src/auth/authStore";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RootNavigator } from "./src/navigation";
import { purgeExpiredTrash } from "./src/lib/trash";
import { repairTakenAtUnits } from "./src/db/queries";
import { startAutoBackupLoop } from "./src/lib/autoBackup";
import { theme } from "./src/theme";

export default function App() {
  const phase = useAuthStore((s) => s.phase);

  useEffect(() => {
    if (phase === "ready") {
      void purgeExpiredTrash().catch(() => {});
      void repairTakenAtUnits().catch(() => {});
      startAutoBackupLoop();
    }
  }, [phase]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar style="light" />
      {phase === "ready" ? (
        <NavigationContainer>
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
