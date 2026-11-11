import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useVideoPlayer, VideoView } from "expo-video";
import { createAudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MediaRow, getMediaByIds } from "../db/queries";
import { useSettingsStore } from "../store/settingsStore";
import { theme } from "../theme";
import { t, tf } from "../lib/i18n";
import { AppText, EmptyState, ErrorState, IconButton, Skeleton } from "../ui";

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
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const itemsRef = useRef<MediaRow[]>([]);
  itemsRef.current = items;
  const slideMsRef = useRef<number>(SLIDE_MS);
  slideMsRef.current = slideMsFor(itemsRef.current[index]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setItems(await getMediaByIds(ids));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    void load();
  }, [load]);

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
  // Reduced motion keeps the photo still — the slide timing is unchanged.
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  useEffect(() => {
    if (index >= items.length) return;
    const row = itemsRef.current[index];
    if (reduced || (row && isVideoRow(row))) {
      // videos live, no ken burns; reduced motion keeps the frame static.
      scale.set(1);
      tx.set(0);
      return;
    }
    scale.set(1);
    tx.set(index % 2 === 0 ? 8 : -8);
    scale.set(withTiming(1.08, { duration: slideMsFor(row), easing: Easing.inOut(Easing.quad) }));
    tx.set(
      withTiming(index % 2 === 0 ? -8 : 8, {
        duration: slideMsFor(row),
        easing: Easing.inOut(Easing.quad),
      })
    );
  }, [index, items.length, reduced, scale, tx]);
  const kenStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }, { translateX: tx.get() }],
  }));

  const current = items[index];
  const currentIsVideo = current ? isVideoRow(current) : false;

  const onVideoEnded = useCallback(() => {
    goNextNow();
  }, [goNextNow]);

  const slideProgress = (i: number): number => {
    if (i < index) return 1;
    if (i > index) return 0;
    return Math.min(1, (tick * TICK_MS) / slideMsFor(itemsRef.current[index]));
  };

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
      <StatusBar style="light" />
      {currentIsVideo ? (
        <StoryVideoSlide item={current} onEnded={onVideoEnded} paused={false} />
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, kenStyle]}>
          <Image
            key={String(current.id)}
            source={{ uri: current.local_uri ?? current.thumb_uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={reduced ? 0 : 180}
            recyclingKey={`story-${current.id}`}
            accessible={false}
          />
        </Animated.View>
      )}

      {/* progress bars */}
      <View style={[styles.barsRow, { top: insets.top + theme.spacing.sm }]}>
        {items.map((it, i) => (
          <View key={String(it.id)} style={styles.barTrack} importantForAccessibility="no-hide-descendants">
            <View style={styles.barTint} />
            <View style={[styles.barFill, { width: `${Math.round(slideProgress(i) * 100)}%` }]} />
          </View>
        ))}
      </View>

      <View style={[styles.headerRow, { top: insets.top + theme.spacing.lg }]}>
        <IconButton
          icon="arrow-back"
          label={t("common.back")}
          variant="onMedia"
          onPress={() => navigation.goBack()}
        />
        <AppText
          variant="body"
          weight="semibold"
          color={theme.colors.onViewer}
          numberOfLines={1}
          style={styles.title}
          accessibilityLabel={`${title}, ${tf("viewer.position", { current: index + 1, total: items.length })}`}
          accessibilityLiveRegion="polite"
        >
          {title}
        </AppText>
        <IconButton
          icon="expand-outline"
          label="Open in viewer"
          variant="onMedia"
          onPress={() => navigation.navigate("Viewer", { ids, index })}
        />
      </View>

      {/* tap zones */}
      <View style={styles.tapRow}>
        <Pressable
          style={styles.tapZone}
          onPress={goPrev}
          accessibilityRole="button"
          accessibilityLabel="Previous moment"
        />
        <Pressable
          style={styles.tapZone}
          onPress={goNextNow}
          accessibilityRole="button"
          accessibilityLabel="Next moment"
        />
      </View>
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
  root: { flex: 1, backgroundColor: theme.colors.viewer },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  barsRow: {
    position: "absolute",
    left: theme.spacing.compact,
    right: theme.spacing.compact,
    flexDirection: "row",
    gap: theme.spacing.xs,
    zIndex: 2,
  },
  barTrack: { flex: 1, height: 3, borderRadius: theme.radius.pill, overflow: "hidden" },
  barTint: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.onViewer,
    opacity: 0.28,
  },
  barFill: {
    height: "100%",
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.onViewer,
  },
  headerRow: {
    position: "absolute",
    left: theme.spacing.compact,
    right: theme.spacing.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    zIndex: 2,
  },
  title: {
    flex: 1,
    minWidth: 0,
    textShadowColor: theme.colors.black,
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
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
});
