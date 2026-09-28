import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { enqueueUploadWithReply, getMediaByIds, MediaRow } from "../db/queries";
import { quickFingerprint } from "../lib/dedupe";
import { insertMedia } from "../db/queries";
import { renderEdit, EditAdjustments } from "../lib/imageEdit";
import { startWorker } from "../lib/uploader";
import { theme } from "../theme";

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
  const [original, setOriginal] = useState<MediaRow | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewTick, setPreviewTick] = useState(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void getMediaByIds([route.params.mediaId]).then((rows) => setOriginal(rows[0] ?? null));
  }, [route.params.mediaId]);

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
    } finally {
      setSaving(false);
    }
  }, [original, saving, adj, navigation]);

  if (!original) {
    return (
      <View style={styles.root}>
        <Text style={styles.centerText}>Loading…</Text>
      </View>
    );
  }

  const dispW = rotatedW >= rotatedH ? DISPLAY_MAX : Math.round((rotatedW / rotatedH) * DISPLAY_MAX);
  const dispH = rotatedH > rotatedW ? DISPLAY_MAX : Math.round((rotatedH / rotatedW) * DISPLAY_MAX);

  return (
    <View style={[styles.root, { paddingTop: 12 }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="close" size={26} color={theme.colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Edit</Text>
        <Pressable onPress={() => void save()} disabled={saving} hitSlop={8}>
          <Text style={[styles.save, saving && { opacity: 0.5 }]}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <View style={styles.previewWrap}>
        <GestureDetector gesture={cropDrag}>
          <View style={{ width: dispW, height: dispH }}>
            <Image
              source={{
                uri: `${original.thumb_uri}?tick=${previewTick}&r=${rotation}&b=${brightness}&c=${contrast}&s=${saturation}`,
              }}
              style={{ width: dispW, height: dispH, borderRadius: 8 }}
              contentFit="cover"
              transition={0}
            />
            {crop ? (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: crop.x * dispW,
                  top: crop.y * dispH,
                  width: crop.w * dispW,
                  height: crop.h * dispH,
                  borderWidth: 2,
                  borderColor: theme.colors.primary,
                  borderRadius: 6,
                  backgroundColor: "#00000055",
                }}
              />
            ) : null}
          </View>
        </GestureDetector>
        <Text style={styles.hint}>Drag inside the box to move the crop</Text>
      </View>

      <View style={styles.controls}>
        <View style={styles.toolRow}>
          <Pressable style={styles.tool} onPress={rotate}>
            <Ionicons name="refresh" size={18} color={theme.colors.onSurface} />
            <Text style={styles.toolLabel}>Rotate {rotation}°</Text>
          </Pressable>
          <Pressable style={styles.tool} onPress={() => setCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })}>
            <Ionicons name="crop" size={18} color={theme.colors.onSurface} />
            <Text style={styles.toolLabel}>Crop</Text>
          </Pressable>
          <Pressable
            style={styles.tool}
            onPress={() => {
              setCrop(null);
              setBrightness(0);
              setContrast(0);
              setSaturation(0);
            }}
          >
            <Ionicons name="arrow-undo" size={18} color={theme.colors.onSurface} />
            <Text style={styles.toolLabel}>Reset</Text>
          </Pressable>
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
  value,
  onChange,
}: {
  label?: string;
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
  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.track}
        onLayout={(e) => {
          trackW.current = e.nativeEvent.layout.width;
        }}
      >
        <View style={styles.trackFill} />
        <View style={[styles.knob, { left: `${frac * 100}%` }]} />
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
      <Text style={styles.sliderLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        <SliderInput value={value} onChange={onChange} />
      </View>
      <Text style={styles.sliderValue}>{value > 0 ? `+${value}` : value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  centerText: { color: "#FFFFFF99", textAlign: "center", marginTop: 80 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 8,
  },
  title: { color: theme.colors.onSurface, fontSize: 17, fontWeight: "700" },
  save: { color: theme.colors.primary, fontSize: 15, fontWeight: "700" },
  previewWrap: { alignItems: "center", paddingVertical: 10 },
  hint: { color: "#FFFFFF66", fontSize: 11, marginTop: 6 },
  controls: { paddingHorizontal: theme.spacing.lg, gap: 10 },
  toolRow: { flexDirection: "row", gap: theme.spacing.md, marginBottom: 4 },
  tool: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toolLabel: { color: theme.colors.onSurface, fontSize: 12, fontWeight: "600" },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  sliderLabel: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, width: 84 },
  sliderValue: { color: theme.colors.onSurface, fontSize: 12, width: 34, textAlign: "right" },
  track: {
    height: 28,
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.full,
  },
  trackFill: {
    position: "absolute",
    left: "50%",
    right: 0,
    height: 4,
    backgroundColor: theme.colors.surfaceHighest,
  },
  knob: {
    position: "absolute",
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
  },
});
