import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StyleSheet, Text, View } from "react-native";
import { GalleryScreen } from "../screens/GalleryScreen";
import { CollectionsScreen } from "../screens/CollectionsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { theme } from "../theme";

export type RootTabParamList = {
  Gallery: undefined;
  Collections: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const TAB_ICONS: Record<keyof RootTabParamList, string> = {
  Gallery: "▦",
  Collections: "▤",
  Settings: "≡",
};

export function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarLabel: ({ color }) => (
          <Text style={[styles.tabLabel, { color }]}>{route.name}</Text>
        ),
        tabBarIcon: ({ color, focused }) => (
          <View style={[styles.tabIconWrap, focused && styles.tabIconFocused]}>
            <Text style={[styles.tabIcon, { color }]}>{TAB_ICONS[route.name as keyof RootTabParamList]}</Text>
          </View>
        ),
      })}
    >
      <Tab.Screen name="Gallery" component={GalleryScreen} />
      <Tab.Screen name="Collections" component={CollectionsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: theme.colors.surface,
    borderTopColor: theme.colors.outlineVariant,
    height: 64,
    paddingTop: 6,
  },
  tabLabel: { fontSize: 11.5, fontWeight: "600" },
  tabIconWrap: {
    width: 40,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconFocused: {
    backgroundColor: theme.colors.primaryContainer,
  },
  tabIcon: { fontSize: 16, lineHeight: 20 },
});
