import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getMediaByIds, MediaRow } from "../db/queries";

const SLIDE_MS = 4000;
const CONTROLS_HIDE_MS = 3500;

type SlideshowNav = NativeStackNavigationProp<{
  Slideshow: { ids: number[]; index: number };
}>;

// v0.26 Slideshow ("Play"): full-screen auto-advancing playback of any ids
// list the Viewer was opened with — a day, month, album, favorites… Photos
// get a slow Ken Burns zoom and a crossfade; videos play themselves out and
// advance on playback end. Loops until closed. StoryScreen (Memories) stays
// the lighter "on this day" variant.
export function SlideshowScreen({ navigation, route }: { navigation: SlideshowNav; route: { params: { ids: number[]; index: number } } }) {
  const { ids } = route.params;
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [index, setIndex] = useState(route.params.index);
  const [playing, setPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const rowsRef = useRef<MediaRow[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    void getMediaByIds(ids).then((loaded) => {
      setRows(loaded);
      setIndex((i) => Math.min(Math.max(0, i), Math.max(0, loaded.length - 1)));
    });
  }, [ids]);

  const goNextNow = useCallback(() => {
    setIndex((i) => (rowsRef.current.length > 0 ? (i + 1) % rowsRef.current.length : i));
  }, []);

  const goPrev = useCallback(() => {
    setIndex((i) =>
      rowsRef.current.length > 0 ? (i - 1 + rowsRef.current.length) % rowsRef.current.length : i
    );
  }, []);

  // Photos advance on a timer; real videos advance when playback ends. A
  // video with nothing to play (cloud-only row) would never fire playToEnd,
  // so it stays on the timer instead of stalling the slideshow.
  useEffect(() => {
    if (!playing) return;
    const current = rows[index];
    if (!current) return;
    const playsItself = current.mime_type.startsWith("video/") && !!current.local_uri;
    if (playsItself) return;
    const timer = setTimeout(goNextNow, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [playing, rows, index, goNextNow]);

  // Controls fade out while playing; any tap brings them back.
  useEffect(() => {
    if (!controlsVisible || !playing) return;
    const timer = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(timer);
  }, [controlsVisible, playing, index]);

  const current = rows[index];

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={!controlsVisible} />
      {current ? (
        current.mime_type.startsWith("video/") ? (
          <VideoSlide
            key={`v-${current.id}`}
            item={current}
            paused={!playing}
            controlsVisible={controlsVisible}
            onEnded={goNextNow}
          />
        ) : (
          <PhotoSlide key={`p-${current.id}`} item={current} />
        )
      ) : (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      )}

      {/* Tap zones (only while controls are hidden — with controls up, taps
          reach the video's own seek controls and the bottom-bar buttons). */}
      {!controlsVisible ? (
        <View style={styles.tapRow}>
          <Pressable style={styles.tapZone} onPress={goPrev} />
          <Pressable style={styles.tapZone} onPress={() => setControlsVisible(true)} />
          <Pressable style={styles.tapZone} onPress={goNextNow} />
        </View>
      ) : null}

      {controlsVisible ? (
        <>
          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </Pressable>
            <View style={styles.topCenter}>
              <Text style={styles.date}>
                {current ? new Date(current.taken_at).toLocaleDateString(undefined, { dateStyle: "medium" }) : " "}
              </Text>
              <Text style={styles.counter}>{rows.length > 0 ? `${index + 1} / ${rows.length}` : " "}</Text>
            </View>
            <View style={styles.topSpacer} />
          </View>
          <View style={[styles.bottomBar, { bottom: insets.bottom + 16 }]}>
            <Pressable onPress={goPrev} hitSlop={10}>
              <Ionicons name="play-back" size={28} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => setPlaying((p) => !p)} hitSlop={10}>
              <Ionicons name={playing ? "pause" : "play"} size={30} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={goNextNow} hitSlop={10}>
              <Ionicons name="play-forward" size={28} color="#FFFFFF" />
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function PhotoSlide({ item }: { item: MediaRow }) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  useEffect(() => {
    // Slow Ken Burns: gentle zoom + drift across the slide's on-screen time.
    scale.value = withTiming(1.07, { duration: 7000 });
    tx.value = withTiming(8, { duration: 7000 });
    ty.value = withTiming(-6, { duration: 7000 });
  }, [scale, tx, ty]);
  const kenBurns = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: tx.value }, { translateY: ty.value }],
  }));
  return (
    <Animated.View entering={FadeIn.duration(350)} style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, kenBurns]}>
        <Image
          source={{ uri: item.local_uri ?? item.thumb_uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={180}
          recyclingKey={`slide-${item.id}`}
        />
      </Animated.View>
    </Animated.View>
  );
}

function VideoSlide({
  item,
  paused,
  controlsVisible,
  onEnded,
}: {
  item: MediaRow;
  paused: boolean;
  controlsVisible: boolean;
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
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={controlsVisible}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#FFFFFF88" },
  tapRow: { ...StyleSheet.absoluteFill, flexDirection: "row", zIndex: 1 },
  tapZone: { flex: 1 },
  topBar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    zIndex: 2,
  },
  topCenter: { flex: 1, alignItems: "center" },
  topSpacer: { width: 26 },
  date: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", textShadowColor: "#000000AA", textShadowRadius: 4 },
  counter: { color: "#FFFFFFAA", fontSize: 12, marginTop: 2 },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 44,
    zIndex: 2,
  },
});
