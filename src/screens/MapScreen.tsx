import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listGeoTagged, GeoItem } from "../db/queries";
import { theme } from "../theme";

const MAX_MARKERS = 400;

function cluster(items: GeoItem[], cellDeg = 0.02): GeoItem[] {
  const grid = new Map<string, GeoItem>();
  for (const it of items) {
    const key = `${Math.round(it.latitude / cellDeg)}:${Math.round(it.longitude / cellDeg)}`;
    if (!grid.has(key)) grid.set(key, it);
  }
  return [...grid.values()];
}

export function MapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; Tabs: undefined }>>();
  const [items, setItems] = useState<GeoItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void listGeoTagged(MAX_MARKERS * 4).then((rows) => {
      setItems(rows);
      setLoaded(true);
    });
  }, []);

  const apiKey = (Constants.expoConfig?.android?.config as unknown as Record<string, unknown> | undefined)?.apiKey;
  const hasKey = typeof apiKey === "string" && apiKey.length > 10;

  const markers = useMemo(() => cluster(items), [items]);
  const shown = markers.slice(0, MAX_MARKERS);

  const initialRegion = useMemo(() => {
    if (shown.length === 0) {
      return { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 25, longitudeDelta: 25 };
    }
    const lats = shown.map((s) => s.latitude);
    const lngs = shown.map((s) => s.longitude);
    return {
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      latitudeDelta: Math.max(0.05, (Math.max(...lats) - Math.min(...lats)) * 1.6),
      longitudeDelta: Math.max(0.05, (Math.max(...lngs) - Math.min(...lngs)) * 1.6),
    };
  }, [shown]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Map</Text>
        <Text style={styles.count}>{items.length} photos</Text>
      </View>

      {!hasKey ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Google Maps key needed</Text>
          <Text style={styles.noticeBody}>
            Add {"\""}google_maps_api_key{"\""} to tdlib.secrets.json (free at console.cloud.google.com),
            then rebuild the app once.
          </Text>
        </View>
      ) : null}

      {Platform.OS === "android" && !hasKey ? null : (
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          showsUserLocation
          loadingEnabled
        >
          {shown.map((m) => (
            <Marker
              key={`mk-${m.id}`}
              coordinate={{ latitude: m.latitude, longitude: m.longitude }}
              onPress={() =>
                navigation.navigate("Viewer", { ids: items.map((i) => i.id), index: items.findIndex((i) => i.id === m.id) })
              }
              tracksViewChanges={false}
            >
              <View style={styles.pin}>
                <Text style={styles.pinEmoji}>◉</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      )}

      {loaded && !hasKey && Platform.OS === "android" ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Map unavailable without a Maps API key.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  count: { marginLeft: "auto", color: theme.colors.onSurfaceVariant, fontSize: 13 },
  notice: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  noticeTitle: { color: theme.colors.onSurface, fontWeight: "700", fontSize: 14, marginBottom: 4 },
  noticeBody: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, lineHeight: 18 },
  emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: theme.colors.onSurfaceVariant },
  pin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  pinEmoji: { color: theme.colors.onPrimary, fontSize: 12 },
});
