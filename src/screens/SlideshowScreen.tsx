import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getMediaByIds, MediaRow } from "../db/queries";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import { AppText, EmptyState, ErrorState, IconButton, Skeleton } from "../ui";

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(route.params.index);
  const [playing, setPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const rowsRef = useRef<MediaRow[]>([]);
  rowsRef.current = rows;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await getMediaByIds(ids);
      setRows(loaded);
      setIndex((i) => Math.min(Math.max(0, i), Math.max(0, loaded.length - 1)));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loadError) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ErrorState
          title={t("state.error")}
          body={loadError}
          retryLabel={t("common.retry")}
          onRetry={() => void load()}
        />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        {loading ? (
          <View style={styles.centered}>
            <Skeleton
              width="82%"
              height={360}
              radius={theme.radius.control}
              label={t("state.loading")}
            />
          </View>
        ) : (
          <EmptyState
            icon="images-outline"
            title={t("state.empty")}
            body={t("viewer.empty")}
            actionLabel={t("common.back")}
            onAction={() => navigation.goBack()}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={!controlsVisible} />
      {current.mime_type.startsWith("video/") ? (
        <VideoSlide
          key={`v-${current.id}`}
          item={current}
          paused={!playing}
          controlsVisible={controlsVisible}
          onEnded={goNextNow}
        />
      ) : (
        <PhotoSlide key={`p-${current.id}`} item={current} />
      )}

      {/* Tap zones (only while controls are hidden — with controls up, taps
          reach the video's own seek controls and the bottom-bar buttons). */}
      {!controlsVisible ? (
        <View style={styles.tapRow}>
          <Pressable
            style={styles.tapZone}
            onPress={goPrev}
            accessibilityRole="button"
            accessibilityLabel="Previous item"
          />
          <Pressable
            style={styles.tapZone}
            onPress={() => setControlsVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Show controls"
          />
          <Pressable
            style={styles.tapZone}
            onPress={goNextNow}
            accessibilityRole="button"
            accessibilityLabel="Next item"
          />
        </View>
      ) : null}

      {controlsVisible ? (
        <>
          <View style={[styles.topBar, { top: insets.top + theme.spacing.sm }]}>
            <IconButton
              icon="close"
              label={t("common.close")}
              variant="onMedia"
              onPress={() => navigation.goBack()}
            />
            <View style={styles.topCenter}>
              <AppText
                variant="caption"
                weight="semibold"
                color={theme.colors.onViewer}
                numberOfLines={1}
                align="center"
                style={styles.dateShadow}
              >
                {new Date(current.taken_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </AppText>
              <AppText variant="caption2Regular" color={theme.colors.onViewerMuted} tabular>
                {`${index + 1} / ${rows.length}`}
              </AppText>
            </View>
            <View style={styles.topSpacer} />
          </View>
          <View style={[styles.bottomBar, { bottom: insets.bottom + theme.spacing.md }]}>
            <IconButton
              icon="play-back"
              label="Previous item"
              variant="onMedia"
              onPress={goPrev}
            />
            <IconButton
              icon={playing ? "pause" : "play"}
              label={playing ? "Pause" : "Play"}
              variant="onMedia"
              onPress={() => setPlaying((p) => !p)}
            />
            <IconButton
              icon="play-forward"
              label="Next item"
              variant="onMedia"
              onPress={goNextNow}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

function PhotoSlide({ item }: { item: MediaRow }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  useEffect(() => {
    // Slow Ken Burns: gentle zoom + drift across the slide's on-screen time.
    // Reduced motion holds the frame still; the crossfade is dropped too.
    if (reduced) {
      scale.set(1);
      tx.set(0);
      ty.set(0);
      return;
    }
    scale.set(withTiming(1.07, { duration: 7000 }));
    tx.set(withTiming(8, { duration: 7000 }));
    ty.set(withTiming(-6, { duration: 7000 }));
  }, [reduced, scale, tx, ty]);
  const kenBurns = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }, { translateX: tx.get() }, { translateY: ty.get() }],
  }));
  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(theme.motion.duration.slow)}
      style={StyleSheet.absoluteFill}
    >
      <Animated.View style={[StyleSheet.absoluteFill, kenBurns]}>
        <Image
          source={{ uri: item.local_uri ?? item.thumb_uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={reduced ? 0 : 180}
          recyclingKey={`slide-${item.id}`}
          accessible={false}
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
  root: { flex: 1, backgroundColor: theme.colors.viewer },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  tapRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    zIndex: 1,
  },
  tapZone: { flex: 1 },
  topBar: {
    position: "absolute",
    left: theme.spacing.md,
    right: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    zIndex: 2,
  },
  topCenter: { flex: 1, alignItems: "center" },
  topSpacer: { width: theme.layout.touch },
  dateShadow: {
    textShadowColor: theme.colors.black,
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing.lg,
    zIndex: 2,
  },
});
