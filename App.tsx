import React from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { useAuthStore } from "./src/auth/authStore";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RootTabs } from "./src/navigation/RootTabs";
import { theme } from "./src/theme";

export default function App() {
  const phase = useAuthStore((s) => s.phase);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {phase === "ready" ? (
        <NavigationContainer>
          <RootTabs />
        </NavigationContainer>
      ) : (
        <LoginScreen />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});
