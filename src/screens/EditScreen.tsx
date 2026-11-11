import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  enqueueUploadWithReply,
  getMediaByIds,
  insertMedia,
  MediaRow,
} from "../db/queries";
import { quickFingerprint } from "../lib/dedupe";
import { renderEdit, EditAdjustments } from "../lib/imageEdit";
import { startWorker } from "../lib/uploader";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  alertDialog,
} from "../ui";

type EditNav = NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;

const DISPLAY_MAX = 320; // on-screen preview size the crop rect maps against

// v0.19 Photo editor lite. Geometry (rotate/crop) is chosen against the
// on-screen preview; the color pass renders live on the 320px thumbnail and
// the full ≤2048 px render happens once on Save. Save creates a SECOND media
// row (edited_from → root original) and queues it as a Telegram REPLY to the
// original's message — the original is never modified.
export function EditScreen({
  navigation,
  route,
}: {
  navigation: EditNav;
  route: { params: { mediaId: number } };
}) {
  const insets = useSafeAreaInsets();
  const [original, setOriginal] = useState<MediaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewTick, setPreviewTick] = useState(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await getMediaByIds([route.params.mediaId]);
      setOriginal(rows[0] ?? null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [route.params.mediaId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Crop rect: normalized against the ROTATED image frame. null = no crop.
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const rotatedW = useMemo(() => {
    if (!original?.width || !original.height) return 1;
    return rotation % 180 === 0 ? original.width : original.height;
  }, [original, rotation]);
  const rotatedH = useMemo(() => {
    if (!original?.width || !original.height) return 1;
    return rotation % 180 === 0 ? original.height : original.width;
  }, [original, rotation]);

  const adj: EditAdjustments = useMemo(
    () => ({
      rotation,
      crop: crop ? { x: crop.x, y: crop.y, width: crop.w, height: crop.h } : null,
      brightness,
      contrast,
      saturation,
    }),
    [rotation, crop, brightness, contrast, saturation]
  );

  // Live preview: re-render the small pass whenever adjustments settle.
  useEffect(() => {
    if (!original) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      void renderEdit(
        original.local_uri ?? "",
        original.thumb_uri,
        original.width ?? 1,
        original.height ?? 1,
        adj,
        true
      )
        .then(() => setPreviewTick((t) => t + 1))
        .catch(() => {});
    }, 250);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [original, adj]);

  const rotate = useCallback(() => {
    setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270);
    setCrop(null); // crop rect is relative to the rotated frame — reset on rotate
  }, []);

  // Crop drag: pan moves the rect; long-press-free simple UX with preset chips
  // for aspect and a "Reset" to clear.
  const dragStart = useRef({ x: 0, y: 0 });
  const cropDrag = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => {
      dragStart.current = { x: e.x, y: e.y };
    })
    .onUpdate((e) => {
      setCrop((prev) => {
        const base = prev ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        const dx = (e.x - dragStart.current.x) / DISPLAY_MAX;
        const dy = (e.y - dragStart.current.y) / DISPLAY_MAX;
        dragStart.current = { x: e.x, y: e.y };
        return {
          ...base,
          x: Math.min(Math.max(0, base.x + dx), 1 - base.w),
          y: Math.min(Math.max(0, base.y + dy), 1 - base.h),
        };
      });
    });

  const save = useCallback(async () => {
    if (!original || saving) return;
    setSaving(true);
    try {
      const full = await renderEdit(
        original.local_uri ?? "",
        original.thumb_uri,
        original.width ?? 1,
        original.height ?? 1,
        adj,
        false
      );
      const thumb = await renderEdit(
        original.local_uri ?? "",
        original.thumb_uri,
        original.width ?? 1,
        original.height ?? 1,
        adj,
        true
      );
      const editId = await insertMedia({
        local_uri: full.uri,
        thumb_uri: thumb.uri,
        // Same fileName as the original: the worker's caption matching relies
        // on it, and Saved Messages shows a coherent thread.
        file_name: original.file_name ?? `edit-${Date.now()}.jpg`,
        mime_type: "image/jpeg",
        byte_size: full.byteSize,
        width: full.width,
        height: full.height,
        taken_at: original.taken_at,
        fingerprint: quickFingerprint({
          byteSize: full.byteSize,
          modifiedAtMs: Date.now(),
          fileName: original.file_name ?? "edit",
        }),
        state: "local",
        edited_from: original.edited_from ?? original.id,
      });
      if (editId && original.remote_message_id && original.remote_chat_id) {
        await enqueueUploadWithReply(editId, full.uri, full.byteSize, original.remote_message_id);
        startWorker();
      }
      navigation.navigate("Viewer", { ids: [original.edited_from ?? original.id, editId ?? original.id], index: 0 });
    } catch (err) {
      // Without this the button silently does nothing on any render failure
      // (corrupt source, decode refusal, out-of-range crop).
      void alertDialog({
        title: "Couldn't save the edit",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }, [original, saving, adj, navigation]);

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

  if (!original) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        {loading ? (
          <View style={styles.centered}>
            <Skeleton
              width="70%"
              height={280}
              radius={theme.radius.control}
              label={t("state.loading")}
            />
          </View>
        ) : (
          <EmptyState
            icon="image-outline"
            title={t("viewer.empty")}
            actionLabel={t("common.back")}
            onAction={() => navigation.goBack()}
          />
        )}
      </View>
    );
  }

  const dispW = rotatedW >= rotatedH ? DISPLAY_MAX : Math.round((rotatedW / rotatedH) * DISPLAY_MAX);
  const dispH = rotatedH > rotatedW ? DISPLAY_MAX : Math.round((rotatedH / rotatedW) * DISPLAY_MAX);

  return (
    <View style={[styles.root, { paddingTop: insets.top + theme.spacing.sm }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <IconButton
          icon="close"
          label={t("common.close")}
          onPress={() => navigation.goBack()}
        />
        <AppText
          variant="title3"
          align="center"
          accessibilityRole="header"
          style={styles.headerTitle}
        >
          Edit
        </AppText>
        <Button
          label={saving ? "Saving…" : t("common.save")}
          size="sm"
          loading={saving}
          onPress={() => void save()}
          style={styles.saveButton}
        />
      </View>

      <View style={styles.previewWrap}>
        <GestureDetector gesture={cropDrag}>
          <View
            style={{ width: dispW, height: dispH }}
            accessible
            accessibilityLabel="Crop area"
            accessibilityHint="Drag inside the box to move the crop"
          >
            <Image
              source={{
                uri: `${original.thumb_uri}?tick=${previewTick}&r=${rotation}&b=${brightness}&c=${contrast}&s=${saturation}`,
              }}
              style={{ width: dispW, height: dispH, borderRadius: theme.radius.control }}
              contentFit="cover"
              transition={0}
              accessible={false}
            />
            {crop ? (
              <View
                pointerEvents="none"
                style={[
                  styles.cropBox,
                  {
                    left: crop.x * dispW,
                    top: crop.y * dispH,
                    width: crop.w * dispW,
                    height: crop.h * dispH,
                  },
                ]}
              />
            ) : null}
          </View>
        </GestureDetector>
        <AppText variant="caption2Regular" color={theme.colors.onViewerMuted}>
          Drag inside the box to move the crop
        </AppText>
      </View>

      <View style={styles.controls}>
        <View style={styles.toolRow}>
          <Button
            label={`Rotate ${rotation}°`}
            icon="refresh"
            size="sm"
            variant="secondary"
            onPress={rotate}
          />
          <Button
            label="Crop"
            icon="crop"
            size="sm"
            variant="secondary"
            onPress={() => setCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })}
          />
          <Button
            label="Reset"
            icon="arrow-undo"
            size="sm"
            variant="secondary"
            onPress={() => {
              setCrop(null);
              setBrightness(0);
              setContrast(0);
              setSaturation(0);
            }}
          />
        </View>

        <SliderRow label="Brightness" value={brightness} onChange={setBrightness} />
        <SliderRow label="Contrast" value={contrast} onChange={setContrast} />
        <SliderRow label="Saturation" value={saturation} onChange={setSaturation} />
      </View>
    </View>
  );
}

// Minimal pure-JS slider (a new native slider package would force a rebuild).
function SliderInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const trackW = useRef(0);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => {
      onChange(Math.round(Math.max(-100, Math.min(100, (e.x / Math.max(1, trackW.current)) * 200 - 100))));
    })
    .onUpdate((e) => {
      onChange(Math.round(Math.max(-100, Math.min(100, (e.x / Math.max(1, trackW.current)) * 200 - 100))));
    });
  const frac = (value + 100) / 200;
  const fillLeft = Math.min(50, frac * 100);
  const fillWidth = Math.abs(frac - 0.5) * 100;
  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.trackTouch}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: -100, max: 100, now: value }}
        accessibilityActions={[
          { name: "increment", label: "Increase" },
          { name: "decrement", label: "Decrease" },
        ]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === "increment" ? 10 : -10;
          onChange(Math.round(Math.max(-100, Math.min(100, value + step))));
        }}
        onLayout={(e) => {
          trackW.current = e.nativeEvent.layout.width;
        }}
      >
        <View style={styles.trackBar}>
          <View style={[styles.trackFill, { left: `${fillLeft}%`, width: `${fillWidth}%` }]} />
          <View style={[styles.knob, { left: `${frac * 100}%` }]} />
        </View>
      </View>
    </GestureDetector>
  );
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.sliderRow}>
      <AppText variant="caption" color={theme.colors.onSurfaceVariant} style={styles.sliderLabel}>
        {label}
      </AppText>
      <View style={styles.sliderTrackWrap}>
        <SliderInput label={label} value={value} onChange={onChange} />
      </View>
      <AppText variant="caption" tabular style={styles.sliderValue}>
        {value > 0 ? `+${value}` : value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.viewer },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  headerTitle: { flex: 1, marginHorizontal: theme.spacing.sm },
  saveButton: { alignSelf: "center" },
  previewWrap: { alignItems: "center", paddingVertical: theme.spacing.compact, gap: theme.spacing.sm },
  cropBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.thumb,
    backgroundColor: theme.colors.mediaScrim,
  },
  controls: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.compact },
  toolRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    flexWrap: "wrap",
    marginBottom: theme.spacing.xs,
  },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  sliderLabel: { width: 84 },
  sliderTrackWrap: { flex: 1 },
  sliderValue: { width: 40, textAlign: "right" },
  trackTouch: { minHeight: theme.layout.touch, justifyContent: "center" },
  trackBar: {
    height: 28,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceContainer,
    justifyContent: "center",
  },
  trackFill: {
    position: "absolute",
    top: 12,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
  },
  knob: {
    position: "absolute",
    top: 4,
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent,
  },
});
