import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MediaRow } from "../db/queries";
import { theme } from "../theme";

const SLIDE_MS = 3200;
const TICK_MS = 320;
const TICKS_PER_SLIDE = SLIDE_MS / TICK_MS;

// Instagram-style "on this day" story: auto-advancing, tap right/left to step,
// back to close. Progress bar ticks 10× per slide.
export function StoryScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
  route: { params: { ids: number[]; title: string } };
}) {
  const { ids, title } = route.params;
  const [items, setItems] = useState<MediaRow[]>([]);
  const [index, setIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const itemsRef = useRef<MediaRow[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    void getMediaByIds(ids).then(setItems);
  }, [ids]);

  useEffect(() => {
    if (items.length === 0) return;
    setTick(0);
    const timer = setInterval(() => {
      setTick((t) => {
        if (t + 1 >= TICKS_PER_SLIDE) {
          setIndex((i) => {
            if (i + 1 >= itemsRef.current.length) {
              navigation.goBack();
              return i;
            }
            return i + 1;
          });
          return 0;
        }
        return t + 1;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [items.length, index, navigation]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNextNow = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= itemsRef.current.length) {
        navigation.goBack();
        return i;
      }
      return i + 1;
    });
  }, [navigation]);

  const current = items[index];

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {current ? (
        <Image
          key={String(current.id)}
          source={{ uri: current.local_uri ?? current.thumb_uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={180}
          recyclingKey={`story-${current.id}`}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.loading]}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      )}

      {/* progress bars */}
      <View style={styles.barsRow}>
        {items.map((it, i) => (
          <View key={String(it.id)} style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  flex:
                    i < index ? 1 : i === index ? Math.min(1, tick / TICKS_PER_SLIDE) : 0,
                },
              ]}
            />
          </View>
        ))}
      </View>

      <View style={styles.headerRow}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={() => navigation.navigate("Viewer", { ids, index })} hitSlop={8}>
          <Text style={styles.openViewer}>⤢</Text>
        </Pressable>
      </View>

      {/* tap zones */}
      {items.length > 0 ? (
        <View style={styles.tapRow}>
          <Pressable style={styles.tapZone} onPress={goPrev} />
          <Pressable style={styles.tapZone} onPress={goNextNow} />
        </View>
      ) : null}
    </View>
  );
}

import { getMediaByIds } from "../db/queries";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  loading: { alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#FFFFFF88" },
  barsRow: {
    position: "absolute",
    top: 44,
    left: 12,
    right: 12,
    flexDirection: "row",
    gap: 4,
    zIndex: 2,
  },
  barTrack: { flex: 1, height: 2.5, backgroundColor: "#FFFFFF33", borderRadius: 2, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: "#FFFFFFCC" },
  headerRow: {
    position: "absolute",
    top: 52,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    zIndex: 2,
  },
  back: { color: "#FFFFFF", fontSize: 24 },
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "700", flex: 1, textShadowColor: "#000000AA", textShadowRadius: 4 },
  openViewer: { color: "#FFFFFF", fontSize: 20 },
  tapRow: { ...StyleSheet.absoluteFill, flexDirection: "row", zIndex: 1 },
  tapZone: { flex: 1 },
});
