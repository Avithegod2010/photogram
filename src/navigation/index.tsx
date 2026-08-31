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
import { SharedAlbumsScreen } from "../screens/SharedAlbumsScreen";
import { StoryScreen } from "../screens/StoryScreen";
import { SafetyCheckScreen } from "../screens/SafetyCheckScreen";

export type RootStackParamList = {
  Tabs: undefined;
  Viewer: { ids: number[]; index: number };
  Story: { ids: number[]; title: string };
  Trash: undefined;
  Map: undefined;
  Albums: undefined;
  Album: { key: string; label: string; sharedAlbumId?: number };
  Archive: undefined;
  Hidden: undefined;
  SharedAlbums: undefined;
  SafetyCheck: undefined;
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
      <Stack.Screen
        name="Story"
        component={StoryScreen}
        options={{ animation: "fade", presentation: "fullScreenModal", gestureEnabled: true }}
      />
      <Stack.Screen name="Trash" component={TrashScreen} />
      <Stack.Screen name="Map" component={MapScreen} />
      <Stack.Screen name="Albums" component={AlbumsScreen} />
      <Stack.Screen name="Album" component={AlbumScreen} />
      <Stack.Screen name="Archive" component={ArchiveScreen} />
      <Stack.Screen name="Hidden" component={HiddenScreen} />
      <Stack.Screen name="SharedAlbums" component={SharedAlbumsScreen} />
      <Stack.Screen name="SafetyCheck" component={SafetyCheckScreen} />
    </Stack.Navigator>
  );
}
