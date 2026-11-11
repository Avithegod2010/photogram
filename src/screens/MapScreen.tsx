import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import Constants from "expo-constants";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listGeoTagged, GeoItem } from "../db/queries";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import { AppBar, AppText, EmptyState, ErrorState, Screen, Skeleton } from "../ui";

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
  const navigation = useNavigation<NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; Tabs: undefined }>>();
  const [items, setItems] = useState<GeoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    setLoaded(false);
    void listGeoTagged(MAX_MARKERS * 4)
      .then((rows) => setItems(rows))
      .catch(() => {
        setItems([]);
        setLoadError(true);
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const apiKey = (Constants.expoConfig?.android?.config as unknown as Record<string, unknown> | undefined)?.apiKey;
  const hasKey = typeof apiKey === "string" && apiKey.length > 10;
  const mapUnavailable = Platform.OS === "android" && !hasKey;

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
    <Screen>
      <AppBar
        title={t("collections.map")}
        subtitle={loaded ? (items.length === 1 ? "1 photo" : `${items.length.toLocaleString()} photos`) : t("state.loading")}
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the GPS-tagged photos on this phone."
          retryLabel={t("common.retry")}
          onRetry={load}
        />
      ) : !loaded ? (
        <View style={styles.loadingWrap}>
          <Skeleton
            width="100%"
            height={260}
            radius={theme.radius.card}
            label={t("common.loading")}
          />
        </View>
      ) : mapUnavailable ? (
        <EmptyState
          icon="map-outline"
          title="Google Maps key needed"
          body={`Map unavailable without a Maps API key. Add "google_maps_api_key" to tdlib.secrets.json (free at console.cloud.google.com), then rebuild the app once.`}
        />
      ) : (
        <View style={styles.mapWrap}>
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
                  navigation.navigate("Viewer", {
                    ids: items.map((i) => i.id),
                    index: items.findIndex((i) => i.id === m.id),
                  })
                }
                tracksViewChanges={false}
              >
                <View style={styles.pin}>
                  <AppText variant="caption2" weight="semibold" color={theme.colors.onAccent}>
                    ◉
                  </AppText>
                </View>
              </Marker>
            ))}
          </MapView>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapWrap: { flex: 1, overflow: "hidden" },
  loadingWrap: { padding: theme.spacing.md },
  pin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: theme.colors.white,
  },
});
