import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Sharing from "expo-sharing";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getMediaByIds, setMediaVisibility, MediaRow } from "../db/queries";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";

type ViewerParams = { ids: number[]; index: number };

function ZoomableMedia({ item }: { item: MediaRow }) {
  const isVideo = item.mime_type.startsWith("video/");
  const player = useVideoPlayer(item.local_uri ? { uri: item.local_uri } : null);

  if (isVideo) {
    return (
      <View style={styles.videoWrap}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls
          allowsPictureInPicture
        />
      </View>
    );
  }
  return (
    <ScrollView
      style={styles.zoomScroll}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      <Image
        source={{ uri: item.local_uri ?? item.thumb_uri }}
        style={[styles.fullImage, { width: Dimensions.get("window").width, height: Dimensions.get("window").height * 0.72 }]}
        contentFit="contain"
        transition={140}
      />
    </ScrollView>
  );
}

export function ViewerScreen({ route, navigation }: any) {
  const { ids, index } = route.params as ViewerParams;
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [currentId, setCurrentId] = useState<number>(ids[index] ?? 0);
  const [infoOpen, setInfoOpen] = useState(false);
  const listRef = useRef<FlatList<MediaRow> | null>(null);

  useMemo(() => {
    void getMediaByIds(ids).then(setRows);
  }, [ids]);

  const current = rows.find((r) => r.id === currentId);

  const trashCurrent = useCallback(async () => {
    if (!current) return;
    await setMediaVisibility(current.id, "trashed");
    setRows((prev) => prev.filter((r) => r.id !== current.id));
    if (rows.length <= 1) navigation.goBack();
  }, [current, rows.length, navigation]);

  const shareCurrent = useCallback(async () => {
    if (!current?.local_uri) return;
    try {
      await Sharing.shareAsync(current.local_uri, { mimeType: current.mime_type });
    } catch {}
  }, [current]);

  return (
    <View style={styles.root}>
      <View style={[styles.headerBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.headerBtn}>←</Text>
        </Pressable>
        <Text style={styles.headerDate} numberOfLines={1}>
          {current ? new Date(current.taken_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : " "}
        </Text>
        <Pressable hitSlop={10} onPress={() => setInfoOpen(true)}>
          <Text style={styles.headerBtn}>ⓘ</Text>
        </Pressable>
      </View>

      <FlatList
        ref={(r) => {
          listRef.current = r;
        }}
        data={rows}
        horizontal
        pagingEnabled
        keyExtractor={(r) => String(r.id)}
        getItemLayout={(_, i) => ({ length: Dimensions.get("window").width, offset: Dimensions.get("window").width * i, index: i })}
        initialNumToRender={Math.min(index + 2, Math.max(3, ids.length))}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / Dimensions.get("window").width);
          setCurrentId(rows[i]?.id ?? currentId);
        }}
        renderItem={({ item }) => <ZoomableMedia item={item} />}
        ListEmptyComponent={
          <Text style={styles.empty}>This item is no longer available.</Text>
        }
      />

      <View style={[styles.actionsBar, { paddingBottom: insets.bottom + 12 }]}>
        <ActionChip label="Share" onPress={() => void shareCurrent()} />
        <ActionChip
          label="Archive"
          disabled={!current}
          onPress={() => {
            if (!current) return;
            void setMediaVisibility(current.id, "archived");
          }}
        />
        <ActionChip
          label="Hide"
          disabled={!current}
          onPress={() => {
            if (!current) return;
            void setMediaVisibility(current.id, "hidden");
          }}
        />
        <ActionChip label="Delete" danger disabled={!current} onPress={() => void trashCurrent()} />
      </View>

      <Modal visible={infoOpen} transparent animationType="slide" onRequestClose={() => setInfoOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setInfoOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetGrabber} />
            <Text style={styles.sheetTitle}>{current?.file_name ?? "Details"}</Text>
            {current ? (
              <>
                <MetaRow k="Captured" v={new Date(current.taken_at).toLocaleString()} />
                <MetaRow k="Size" v={formatBytes(current.byte_size)} />
                {current.width && current.height ? (
                  <MetaRow k="Resolution" v={`${current.width} × ${current.height}`} />
                ) : null}
                {current.duration_ms ? (
                  <MetaRow k="Duration" v={`${(current.duration_ms / 1000).toFixed(1)}s`} />
                ) : null}
                <MetaRow k="Backup" v={current.state === "synced" ? `Synced to Telegram${current.uploaded_at ? " · " + new Date(current.uploaded_at).toLocaleDateString() : ""}` : `Local only (${current.state})`} />
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ActionChip({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: theme.colors.outlineVariant }}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed, disabled && styles.chipDisabled]}
    >
      <Text style={[styles.chipText, danger && styles.chipDanger]}>{label}</Text>
    </Pressable>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaKey}>{k}</Text>
      <Text style={styles.metaValue}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  headerBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 8,
  },
  headerBtn: { color: "#FFFFFF", fontSize: 22 },
  headerDate: { flex: 1, color: "#FFFFFFCC", fontSize: 13, textAlign: "center" },
  zoomScroll: { flex: 1 },
  fullImage: { alignSelf: "center" },
  videoWrap: { flex: 1, justifyContent: "center", backgroundColor: "#000000" },
  empty: { color: "#FFFFFF99", textAlign: "center", marginTop: 80 },
  actionsBar: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: "#0E0E11EE",
    borderTopWidth: 1,
    borderTopColor: "#FFFFFF14",
    paddingTop: 10,
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: theme.radius.full,
    backgroundColor: "#FFFFFF12",
  },
  chipPressed: { opacity: 0.7 },
  chipDisabled: { opacity: 0.35 },
  chipText: { color: "#FFFFFFE6", fontSize: 13, fontWeight: "600" },
  chipDanger: { color: theme.colors.error },
  sheetBackdrop: { flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.surfaceContainer,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: 10,
  },
  sheetGrabber: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.outline,
    marginBottom: 14,
  },
  sheetTitle: { color: theme.colors.onSurface, fontSize: 17, fontWeight: "700", marginBottom: theme.spacing.md },
  metaRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant },
  metaKey: { color: theme.colors.onSurfaceVariant, fontSize: 13.5 },
  metaValue: { color: theme.colors.onSurface, fontSize: 13.5, fontWeight: "500", maxWidth: "60%", textAlign: "right" },
});
