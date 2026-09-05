import React, { useEffect, useLayoutEffect } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useIsFocused } from "@react-navigation/native";
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

const TAB_ICONS: Record<
  keyof RootTabParamList,
  { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }
> = {
  Gallery: { on: "cloud", off: "cloud-outline" },
  Collections: { on: "search", off: "search-outline" },
  Settings: { on: "settings", off: "settings-outline" },
};

/**
 * Fades + slides the incoming tab screen in on every focus. Tab screens stay
 * mounted, so this is driven by the navigation focus state, not mounting.
 */
function useTabEntrance() {
  const isFocused = useIsFocused();
  const progress = useSharedValue(0);

  // useLayoutEffect so the hidden start state is applied before the first
  // painted frame after a focus switch (also correct after screen freezes).
  useLayoutEffect(() => {
    if (!isFocused) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [isFocused, progress]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));
}

/** Root wrapper for every tab screen — keeps screen internals untouched. */
function TabScreenShell({ children }: { children: React.ReactNode }) {
  const entranceStyle = useTabEntrance();
  return <Animated.View style={[styles.shell, entranceStyle]}>{children}</Animated.View>;
}

function GalleryTabScreen() {
  return (
    <TabScreenShell>
      <GalleryScreen />
    </TabScreenShell>
  );
}

function CollectionsTabScreen(props: React.ComponentProps<typeof CollectionsScreen>) {
  return (
    <TabScreenShell>
      <CollectionsScreen {...props} />
    </TabScreenShell>
  );
}

function SettingsTabScreen() {
  return (
    <TabScreenShell>
      <SettingsScreen />
    </TabScreenShell>
  );
}

/**
 * Tab bar glyph with a spring-based focus animation, one per tab personality:
 * cloud pops, search wiggles, gear does a full spin. Runs every time the tab
 * gains focus (the tab bar is always mounted, unlike the screens).
 */
function TabIcon({
  routeName,
  color,
  focused,
}: {
  routeName: keyof RootTabParamList;
  color: string;
  focused: boolean;
}) {
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (!focused) {
      // Ease back to identity while hidden so the next focus replays cleanly.
      scale.value = withTiming(1, { duration: 120 });
      rotate.value = withTiming(0, { duration: 120 });
      return;
    }
    if (routeName === "Settings") {
      // Gear: one smooth 360° spin.
      rotate.value = withTiming(360, { duration: 400, easing: Easing.inOut(Easing.cubic) }, (finished) => {
        if (finished) rotate.value = 0;
      });
    } else if (routeName === "Gallery") {
      // Cloud: little bounce/scale pop (1 → 1.18 → 1).
      scale.value = withSequence(
        withSpring(1.18, { stiffness: 320, damping: 13 }),
        withSpring(1, { stiffness: 280, damping: 14 })
      );
      rotate.value = withTiming(0, { duration: 100 });
    } else {
      // Search: quick pulse + rotation wiggle (-12° → 12° → 0).
      scale.value = withSequence(
        withSpring(1.12, { stiffness: 320, damping: 13 }),
        withSpring(1, { stiffness: 280, damping: 14 })
      );
      rotate.value = withSequence(
        withTiming(-12, { duration: 100, easing: Easing.out(Easing.quad) }),
        withTiming(12, { duration: 150, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 120, easing: Easing.in(Easing.quad) })
      );
    }
  }, [focused, routeName, scale, rotate]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: rotate.value + "deg" }],
  }));

  const icons = TAB_ICONS[routeName];
  return (
    <View style={[styles.tabIconWrap, focused && styles.tabIconFocused]}>
      <Animated.View style={iconStyle}>
        <Ionicons name={focused ? icons.on : icons.off} size={18} color={color} />
      </Animated.View>
    </View>
  );
}

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
          <TabIcon routeName={route.name as keyof RootTabParamList} color={color} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name="Gallery" component={GalleryTabScreen} />
      <Tab.Screen name="Collections" component={CollectionsTabScreen} />
      <Tab.Screen name="Settings" component={SettingsTabScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
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
});
