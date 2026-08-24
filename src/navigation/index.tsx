import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { RootTabs } from "./RootTabs";
import { ViewerScreen } from "../screens/ViewerScreen";
import { TrashScreen } from "../screens/TrashScreen";

export type RootStackParamList = {
  Tabs: undefined;
  Viewer: { ids: number[]; index: number };
  Trash: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={RootTabs} />
      <Stack.Screen
        name="Viewer"
        component={ViewerScreen}
        options={{ animation: "fade", presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="Trash" component={TrashScreen} />
    </Stack.Navigator>
  );
}
