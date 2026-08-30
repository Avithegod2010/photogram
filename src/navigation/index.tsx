import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { RootTabs } from "./RootTabs";
import { ViewerScreen } from "../screens/ViewerScreen";
import { TrashScreen } from "../screens/TrashScreen";
import { MapScreen } from "../screens/MapScreen";
import { AlbumsScreen } from "../screens/AlbumsScreen";
import { AlbumScreen } from "../screens/AlbumScreen";
import { ArchiveScreen } from "../screens/ArchiveScreen";
import { HiddenScreen } from "../screens/HiddenScreen";

export type RootStackParamList = {
  Tabs: undefined;
  Viewer: { ids: number[]; index: number };
  Trash: undefined;
  Map: undefined;
  Albums: undefined;
  Album: { key: string; label: string };
  Archive: undefined;
  Hidden: undefined;
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
      <Stack.Screen name="Map" component={MapScreen} />
      <Stack.Screen name="Albums" component={AlbumsScreen} />
      <Stack.Screen name="Album" component={AlbumScreen} />
      <Stack.Screen name="Archive" component={ArchiveScreen} />
      <Stack.Screen name="Hidden" component={HiddenScreen} />
    </Stack.Navigator>
  );
}
