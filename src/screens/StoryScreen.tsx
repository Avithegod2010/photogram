import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useVideoPlayer, VideoView } from "expo-video";
import { createAudioPlayer } from "expo-audio";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MediaRow, getMediaByIds } from "../db/queries";
import { useSettingsStore } from "../store/settingsStore";
import { theme } from "../theme";

// v0.48 story background music: a self-generated ambient loop (see
// scripts/gen-story-music.mjs — synthesized here, no third-party samples).
const STORY_MUSIC = require("../../assets/audio/story-ambient.wav");

const SLIDE_MS = 3200;
const TICK_MS = 320;

function isVideoRow(row: MediaRow): boolean {
  return row.mime_type.startsWith("video/");
}

function slideMsFor(row: MediaRow | undefined): number {
  // v0.45 story upgrade: videos hold their slide for the clip length instead
  // of the default 3.2 s (clamped so a stuck duration can't freeze the story).
  if (row && isVideoRow(row) && row.duration_ms && row.duration_ms > 0) {
    return Math.min(Math.max(row.duration_ms + 500, 4000), 30_000);
  }
  return SLIDE_MS;
}

// Instagram-style "on this day" story: auto-advancing, tap right/left to step,
// back to close. Progress bar ticks 10× per slide. v0.45: subtle Ken Burns
// drift on every photo slide and native video playback for video slides.
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
  const slideMsRef = useRef<number>(SLIDE_MS);
  slideMsRef.current = slideMsFor(itemsRef.current[index]);

  useEffect(() => {
    void getMediaByIds(ids).then(setItems);
  }, [ids]);

  useEffect(() => {
    if (items.length === 0) return;
    const ticksForSlide = () => Math.max(1, Math.round(slideMsRef.current / TICK_MS));
    const timer = setInterval(() => {
      setTick((t) => {
        if (t + 1 >= ticksForSlide()) {
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

  // v0.48 background music: the ambient loop plays while the story shows,
  // honest-off whenever the setting is off. createAudioPlayer is native-only —
  // guard everything so the story must never crash on music.
  const storyMusic = useSettingsStore((s) => s.storyMusic);
  useEffect(() => {
    if (items.length === 0 || !storyMusic) return;
    let player: { play(): void; pause(): void; release(): void; loop: boolean; volume: number } | null = null;
    try {
      const p = createAudioPlayer(STORY_MUSIC, {});
      p.loop = true;
      p.volume = 0.55;
      p.play();
      player = p;
    } catch {
      player = null;
    }
    return () => {
      try {
        player?.pause();
        player?.release();
      } catch {}
    };
  }, [items.length, storyMusic]);

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

  // Ken Burns: every slide starts at scale 1 and drifts to 1.08 with a small
  // sideways drift, alternating direction per slide so cuts don't hurt.
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  useEffect(() => {
    if (index >= items.length) return;
    const row = itemsRef.current[index];
    if (row && isVideoRow(row)) return; // videos live, no ken burns
    scale.value = 1;
    tx.value = index % 2 === 0 ? 8 : -8;
    scale.value = withTiming(1.08, { duration: slideMsFor(row), easing: Easing.inOut(Easing.quad) });
    tx.value = withTiming(index % 2 === 0 ? -8 : 8, {
      duration: slideMsFor(row),
      easing: Easing.inOut(Easing.quad),
    });
  }, [index, items.length, scale, tx]);
  const kenStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: tx.value }],
  }));

  const current = items[index];
  const currentIsVideo = current ? isVideoRow(current) : false;

  const onVideoEnded = useCallback(() => {
    goNextNow();
  }, [goNextNow]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {current ? (
        currentIsVideo ? (
          <StoryVideoSlide item={current} onEnded={onVideoEnded} paused={false} />
        ) : (
          <Animated.View style={[StyleSheet.absoluteFill, kenStyle]}>
            <Image
              key={String(current.id)}
              source={{ uri: current.local_uri ?? current.thumb_uri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              transition={180}
              recyclingKey={`story-${current.id}`}
            />
          </Animated.View>
        )
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
                    i < index
                      ? 1
                      : i === index
                        ? Math.min(1, tick * TICK_MS / slideMsFor(itemsRef.current[index]))
                        : 0,
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

function StoryVideoSlide({
  item,
  paused,
  onEnded,
}: {
  item: MediaRow;
  paused: boolean;
  onEnded: () => void;
}) {
  const player = useVideoPlayer(item.local_uri ? { uri: item.local_uri } : null);
  useEffect(() => {
    const sub = player.addListener("playToEnd", onEnded);
    return () => sub.remove();
  }, [player, onEnded]);
  useEffect(() => {
    if (paused) player.pause();
    else void player.play();
  }, [paused, player]);
  return (
    <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
  );
}

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
