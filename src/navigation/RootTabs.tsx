import React, { useEffect } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GalleryScreen } from "../screens/GalleryScreen";
import { CollectionsScreen } from "../screens/CollectionsScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import { easing } from "../ui/motion";

export type RootTabParamList = {
  Gallery: undefined;
  Collections: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

/**
 * Icon semantics fixed: Gallery is a photo grid, Collections is a library of
 * albums, Settings is settings. Filled = active, outline = inactive.
 */
const TAB_ICONS: Record<
  keyof RootTabParamList,
  { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }
> = {
  Gallery: { on: "images", off: "images-outline" },
  Collections: { on: "albums", off: "albums-outline" },
  Settings: { on: "settings", off: "settings-outline" },
};

const TAB_LABEL: Record<keyof RootTabParamList, string> = {
  Gallery: "tabs.gallery",
  Collections: "tabs.collections",
  Settings: "tabs.settings",
};

/** A 24dp glyph that settles at 1.05 when focused. No spins, no bouncing. */
function TabIcon({
  routeName,
  color,
  focused,
}: {
  routeName: keyof RootTabParamList;
  color: string;
  focused: boolean;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(focused ? 1.05 : 1);

  useEffect(() => {
    scale.set(
      reduced
        ? focused
          ? 1.05
          : 1
        : withTiming(focused ? 1.05 : 1, {
            duration: theme.motion.duration.fast,
            easing: easing.standard,
          })
    );
  }, [focused, reduced, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const icons = TAB_ICONS[routeName];

  return (
    <View style={styles.iconBox}>
      <Animated.View style={style}>
        <Ionicons
          name={focused ? icons.on : icons.off}
          size={theme.layout.icon}
          color={color}
          importantForAccessibility="no"
        />
      </Animated.View>
    </View>
  );
}

export function RootTabs() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // Let the bar grow with the OS font scale instead of clipping 11dp labels.
  const labelGrowth = Math.min(12, Math.round((fontScale - 1) * 12));

  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const name = route.name as keyof RootTabParamList;
        return {
          headerShown: false,
          animation: "none",
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: theme.colors.accent,
          tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
          tabBarAccessibilityLabel: t(TAB_LABEL[name]),
          tabBarLabel: t(TAB_LABEL[name]),
          tabBarStyle: [
            styles.tabBar,
            { height: theme.layout.tabBar + insets.bottom + labelGrowth },
          ],
          tabBarItemStyle: styles.tabItem,
          tabBarLabelStyle: styles.tabLabel,
          tabBarAllowFontScaling: true,
          sceneStyle: styles.scene,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon routeName={name} color={color} focused={focused} />
          ),
          tabBarIconStyle: styles.tabIconSlot,
        };
      }}
    >
      <Tab.Screen name="Gallery" component={GalleryScreen} />
      <Tab.Screen name="Collections" component={CollectionsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: theme.colors.background },
  tabBar: {
    backgroundColor: theme.colors.surface,
    borderTopWidth: 0,
    paddingTop: theme.spacing.xs,
    paddingBottom: 0,
    ...theme.elevation.floating,
  },
  tabItem: { minHeight: theme.layout.touch, justifyContent: "center" },
  tabIconSlot: { height: theme.layout.icon + 8, width: theme.layout.touch },
  tabLabel: {
    fontSize: theme.type.size.caption2,
    lineHeight: theme.type.leading.caption2,
    fontWeight: theme.type.weight.semibold,
    marginTop: 0,
  },
  iconBox: {
    width: theme.layout.touch,
    height: theme.layout.icon + 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
