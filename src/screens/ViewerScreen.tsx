import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  getMediaByIds,
  setMediaVisibility,
  setMediaFavorite,
  isSharedAlbumMedia,
  listVersionsFor,
  listSharedAlbums,
  updateMediaUserTags,
  type SharedAlbumRow,
  type MediaRow,
} from "../db/queries";
import { enqueueForUpload } from "../lib/uploader";
import { saveViewerNote, syncPendingNotes } from "../lib/notes";
import { sendToAlbum } from "../lib/sendToAlbum";
import { normalizeUserTags } from "../lib/tags";
import { hasRemoteCopy, restoreMediaToDevice } from "../lib/restorer";
import { formatBytes } from "../lib/stats";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppText,
  Button,
  EmptyState,
  IconButton,
  Input,
  ListRow,
  PressableScale,
  Sheet,
  Skeleton,
  StatusBadge,
  alertDialog,
  confirmDialog,
} from "../ui";
import { easing } from "../ui/motion";

type ViewerParams = { ids: number[]; index: number };

function ZoomableMedia({
  item,
  width,
  height,
}: {
  item: MediaRow;
  width: number;
  height: number;
}) {
  const isVideo = item.mime_type.startsWith("video/");
  if (isVideo && !item.local_uri) {
    return (
      <View style={[styles.videoWrap, { width, height }]}>
        <Image
          source={{ uri: item.thumb_uri }}
          style={{ width, height: height * 0.78 }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={120}
          accessible={false}
        />
        <View style={styles.cloudNote}>
          <Ionicons name="cloud-outline" size={18} color={theme.colors.onViewer} importantForAccessibility="no" />
          <AppText variant="caption" color={theme.colors.onViewer} align="center">
            The original video is in Telegram only. Use Save to device to bring it back.
          </AppText>
        </View>
      </View>
    );
  }
  return isVideo ? (
    <VideoMedia item={item} width={width} height={height} />
  ) : (
    <ScrollView
      style={[styles.zoomScroll, { width, height }]}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      <Image
        source={{ uri: item.local_uri ?? item.thumb_uri }}
        style={{ width, height: height * 0.78 }}
        contentFit="contain"
        cachePolicy="memory-disk"
        recyclingKey={`viewer-${item.id}`}
        transition={140}
        accessibilityLabel={item.file_name ?? "Photo"}
      />
    </ScrollView>
  );
}

function VideoMedia({ item, width, height }: { item: MediaRow; width: number; height: number }) {
  const player = useVideoPlayer({ uri: item.local_uri as string });
  return (
    <View style={[styles.videoWrap, { width, height }]}>
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

export function ViewerScreen({ route, navigation }: any) {
  const { ids, index } = route.params as ViewerParams;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<number>(ids[index] ?? 0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const listRef = useRef<FlatList<MediaRow> | null>(null);
  const tapRef = useRef({ x: 0, y: 0, at: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getMediaByIds(ids);
      setRows(data);
      if (!data.some((r) => r.id === currentId)) {
        setCurrentId(data[0]?.id ?? 0);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ids, currentId]);

  useEffect(() => {
    void load();
    // intentionally reload only when the requested id set changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const current = rows.find((r) => r.id === currentId);

  // Chrome auto-hides after a few seconds; any tap or sheet keeps it awake.
  const anySheetOpen = infoOpen || moreOpen;
  const chrome = useSharedValue(1);
  useEffect(() => {
    chrome.set(
      withTiming(chromeVisible ? 1 : 0, {
        duration: reduced ? 0 : theme.motion.duration.base,
        easing: easing.standard,
      })
    );
  }, [chrome, chromeVisible, reduced]);

  useEffect(() => {
    if (!chromeVisible || anySheetOpen) return;
    const timer = setTimeout(() => setChromeVisible(false), 3400);
    return () => clearTimeout(timer);
  }, [chromeVisible, anySheetOpen, currentId]);

  const topStyle = useAnimatedStyle(() => ({
    opacity: chrome.get(),
    transform: [{ translateY: -(1 - chrome.get()) * 16 }],
  }));
  const bottomStyle = useAnimatedStyle(() => ({
    opacity: chrome.get(),
    transform: [{ translateY: (1 - chrome.get()) * 16 }],
  }));

  const saveCurrent = useCallback(async () => {
    if (!current || savingId !== null) return;
    setSavingId(current.id);
    try {
      const result = await restoreMediaToDevice(current.id);
      if (result.outcome === "restored") {
        const refreshed = await getMediaByIds([current.id]);
        setRows((prev) => prev.map((r) => (r.id === current.id ? refreshed[0] ?? r : r)));
        void alertDialog({
          title: "Saved",
          message: "This item was restored to your device gallery from Telegram.",
        });
      } else {
        void alertDialog({ title: "Couldn't save", message: result.message ?? "Unknown error." });
      }
    } finally {
      setSavingId(null);
    }
  }, [current, savingId]);

  const trashCurrent = useCallback(() => {
    if (!current) return;
    void confirmDialog({
      title: t("viewer.delete"),
      message: "Move this item to Trash? It is deleted forever after 30 days.",
      confirmLabel: t("common.delete"),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      void (async () => {
        await setMediaVisibility(current.id, "trashed");
        setRows((prev) => prev.filter((r) => r.id !== current.id));
        if (rows.length <= 1) navigation.goBack();
      })();
    });
  }, [current, rows.length, navigation]);

  const shareCurrent = useCallback(async () => {
    if (!current?.local_uri) return;
    try {
      await Sharing.shareAsync(current.local_uri, { mimeType: current.mime_type });
    } catch {}
  }, [current]);

  const favoriteCurrent = useCallback(async () => {
    if (!current) return;
    const fav = !current.is_favorite;
    await setMediaFavorite(current.id, fav);
    setRows((prev) => prev.map((r) => (r.id === current.id ? { ...r, is_favorite: fav ? 1 : 0 } : r)));
  }, [current]);

  // --- F3 photo journaling: note editor state + save/remove ---
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const noteSyncRanRef = useRef(false);

  // v0.19 versioned archive: edited copies of the current photo.
  const [versions, setVersions] = useState<MediaRow[]>([]);
  useEffect(() => {
    if (!current) {
      setVersions([]);
      return;
    }
    void listVersionsFor(current.edited_from ?? current.id)
      .then((list) => {
        setVersions(list.filter((r) => r.id !== current.id));
      })
      .catch(() => setVersions([]));
  }, [current?.id, current?.edited_from]);

  const openNoteEditor = useCallback(() => {
    if (!current) return;
    setNoteDraft(current.note_text ?? "");
    setNoteEditorOpen(true);
  }, [current]);

  const refreshRow = useCallback(async (id: number) => {
    const refreshed = await getMediaByIds([id]);
    if (refreshed[0]) {
      setRows((prev) => prev.map((r) => (r.id === id ? refreshed[0] : r)));
    }
  }, []);

  // v0.25 manual tags: the owner's own words on any photo (local-only).
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const openTagEditor = useCallback(() => {
    if (!current) return;
    setTagDraft(current.user_tags ?? "");
    setTagEditorOpen(true);
  }, [current]);
  const saveTags = useCallback(
    async (raw: string | null) => {
      if (!current) return;
      setTagEditorOpen(false);
      await updateMediaUserTags(current.id, raw === null ? null : normalizeUserTags(raw));
      await refreshRow(current.id);
    },
    [current, refreshRow]
  );

  // Local-first save; the Telegram caption push happens when the row is synced.
  const saveNote = useCallback(
    async (text: string | null, force: boolean) => {
      if (!current) return;
      if (await isSharedAlbumMedia(current.id)) {
        void alertDialog({
          title: "Notes apply to your own backed-up photos",
          message: "Family album media is not editable here.",
        });
        setNoteEditorOpen(false);
        return;
      }
      const result = await saveViewerNote(current, text, force);
      if (result.status === "foreign") {
        setNoteEditorOpen(false);
        void confirmDialog({
          title: "Replace the caption?",
          message: `Telegram currently shows the caption “${result.caption}”. Replace it with your note?`,
          confirmLabel: "Replace",
        }).then((ok) => {
          if (ok) void saveNote(text, true);
        });
        return;
      }
      if (result.status === "failed") {
        void alertDialog({
          title: "Note saved on this phone",
          message: `Telegram didn't accept it yet (${result.reason ?? "error"}). It will retry automatically.`,
        });
      }
      setNoteEditorOpen(false);
      await refreshRow(current.id);
    },
    [current, refreshRow]
  );

  // D5.3: opening the Viewer retries pending caption syncs once, then refreshes.
  useEffect(() => {
    if (noteSyncRanRef.current || rows.length === 0) return;
    if (!rows.some((r) => r.state === "synced" && r.note_synced === 0)) return;
    noteSyncRanRef.current = true;
    void (async () => {
      await syncPendingNotes().catch(() => undefined);
      const refreshed = await getMediaByIds(rows.map((r) => r.id));
      if (refreshed.length > 0) setRows(refreshed);
    })();
  }, [rows]);

  // v0.20 send-to-album: picker state + album list (loaded when opened).
  const [sendPickerOpen, setSendPickerOpen] = useState(false);
  const [albums, setAlbums] = useState<SharedAlbumRow[]>([]);

  const openSendPicker = useCallback(() => {
    setMoreOpen(false);
    void listSharedAlbums()
      .then(setAlbums)
      .catch(() => setAlbums([]));
    setSendPickerOpen(true);
  }, []);

  const doSend = useCallback(
    (albumId: number) => {
      if (!current) return;
      setSendPickerOpen(false);
      void (async () => {
        const result = await sendToAlbum(current.id, albumId);
        void alertDialog({ title: result.ok ? "Sent" : "Couldn't send", message: result.message });
      })();
    },
    [current]
  );

  const openSlideshow = useCallback(() => {
    if (!current) return;
    const i = rows.findIndex((r) => r.id === current.id);
    navigation.navigate("Slideshow", { ids: rows.map((r) => r.id), index: Math.max(0, i) });
  }, [current, rows, navigation]);

  const currentIndex = Math.max(0, rows.findIndex((r) => r.id === currentId));

  if (loadError) {
    return (
      <View style={styles.root}>
        <EmptyState
          icon="alert-circle-outline"
          title={t("state.error")}
          body={loadError}
          actionLabel={t("common.retry")}
          onAction={() => void load()}
          secondaryLabel={t("common.back")}
          onSecondary={() => navigation.goBack()}
        />
      </View>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <View style={[styles.root, styles.loadingWrap]}>
        <Skeleton width="86%" height={320} radius={theme.radius.control} label={t("state.loading")} />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.root}>
        <EmptyState
          icon="image-outline"
          title={t("viewer.empty")}
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        ref={(r) => {
          listRef.current = r;
        }}
        data={rows}
        horizontal
        pagingEnabled
        keyExtractor={(r) => String(r.id)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialScrollIndex={Math.min(index, Math.max(0, rows.length - 1))}
        initialNumToRender={Math.min(index + 2, Math.max(3, rows.length))}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentId(rows[i]?.id ?? currentId);
        }}
        onScrollBeginDrag={() => setChromeVisible(false)}
        onTouchStart={(e) => {
          tapRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, at: Date.now() };
        }}
        onTouchEnd={(e) => {
          const dx = Math.abs(e.nativeEvent.pageX - tapRef.current.x);
          const dy = Math.abs(e.nativeEvent.pageY - tapRef.current.y);
          if (Date.now() - tapRef.current.at < 320 && dx < 12 && dy < 12) {
            setChromeVisible((v) => !v);
          }
        }}
        renderItem={({ item }) => <ZoomableMedia item={item} width={width} height={height} />}
      />

      <Animated.View
        style={[styles.topBar, { paddingTop: insets.top + theme.spacing.xs }, topStyle]}
        pointerEvents={chromeVisible ? "auto" : "none"}
      >
        <IconButton icon="arrow-back" label={t("common.back")} variant="onMedia" onPress={() => navigation.goBack()} />
        <Pressable
          style={styles.dateWrap}
          onPress={() => current && setInfoOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={current ? new Date(current.taken_at).toLocaleString() : ""}
          accessibilityHint={t("viewer.detailsHint")}
        >
          <AppText variant="caption" color={theme.colors.onViewer} align="center" numberOfLines={1}>
            {current
              ? new Date(current.taken_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
              : " "}
          </AppText>
          {current ? <StatusBadge status={current.state} style={styles.statusBadge} /> : null}
          <AppText variant="caption2Regular" color={theme.colors.onViewerMuted} tabular>
            {currentIndex + 1} / {rows.length}
          </AppText>
        </Pressable>
        <IconButton
          icon="information-circle-outline"
          label={t("viewer.details")}
          variant="onMedia"
          onPress={() => setInfoOpen(true)}
        />
      </Animated.View>

      <Animated.View
        style={[styles.actionsBar, { paddingBottom: insets.bottom + theme.spacing.sm }, bottomStyle]}
        pointerEvents={chromeVisible ? "auto" : "none"}
      >
        <ViewerAction
          icon="share-social-outline"
          label={t("viewer.share")}
          onPress={() => void shareCurrent()}
          disabled={!current?.local_uri}
        />
        <ViewerAction
          icon={current?.is_favorite ? "heart" : "heart-outline"}
          label={current?.is_favorite ? t("viewer.favorited") : t("viewer.favorite")}
          onPress={() => void favoriteCurrent()}
          accent={!!current?.is_favorite}
          disabled={!current}
        />
        <ViewerAction icon="pencil-outline" label={t("viewer.note")} onPress={openNoteEditor} disabled={!current} />
        <ViewerAction
          icon="ellipsis-horizontal"
          label={t("common.more")}
          onPress={() => setMoreOpen(true)}
          disabled={!current}
        />
      </Animated.View>

      <Sheet visible={infoOpen} onClose={() => setInfoOpen(false)} title={current?.file_name ?? t("viewer.details")} scroll>
        {current ? (
          <>
            <InfoRow k="Captured" v={new Date(current.taken_at).toLocaleString()} />
            <InfoRow k="Size" v={formatBytes(current.byte_size)} />
            {current.width && current.height ? <InfoRow k="Resolution" v={`${current.width} × ${current.height}`} /> : null}
            {current.duration_ms ? <InfoRow k="Duration" v={`${(current.duration_ms / 1000).toFixed(1)}s`} /> : null}
            <InfoRow k="Backup" v={current.state === "synced" ? "Saved in Telegram" : t(`status.${current.state}`)} />
            <InfoRow
              k="Note"
              v={
                current.note_text
                  ? current.note_text + (current.state === "synced" && current.note_synced === 0 ? " · pending" : "")
                  : "None — tap to add"
              }
              onPress={() => {
                setInfoOpen(false);
                setTimeout(openNoteEditor, 220);
              }}
            />
            <InfoRow
              k="My tags"
              v={current.user_tags || "None — tap to add"}
              onPress={() => {
                setInfoOpen(false);
                setTimeout(openTagEditor, 220);
              }}
            />
            {versions.length > 0 ? (
              <InfoRow
                k="Versions"
                v={`${versions.length + 1} (original + edits) — tap to flip through`}
                onPress={() => {
                  setInfoOpen(false);
                  navigation.navigate("Viewer", { ids: [current.id, ...versions.map((v) => v.id)], index: 0 });
                }}
              />
            ) : null}
            {current.place_name ? <InfoRow k="Place" v={current.place_name} /> : null}
            {current.ml_labels ? <InfoRow k="AI tags" v={current.ml_labels} /> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={t("common.more")}
        scroll
      >
        <ListRow title={t("viewer.play")} icon="play-outline" onPress={() => { setMoreOpen(false); openSlideshow(); }} />
        {current?.mime_type.startsWith("image/") ? (
          <ListRow
            title={t("viewer.similar")}
            icon="copy-outline"
            onPress={() => {
              setMoreOpen(false);
              navigation.navigate("Similar", { mode: "similar", mediaId: current.id });
            }}
          />
        ) : null}
        {current && !current.local_uri && hasRemoteCopy(current) ? (
          <ListRow
            title={savingId === current.id ? "Saving…" : t("viewer.save")}
            icon="download-outline"
            disabled={savingId !== null}
            onPress={() => {
              setMoreOpen(false);
              void saveCurrent();
            }}
          />
        ) : null}
        <ListRow
          title={t("viewer.backup")}
          icon="cloud-upload-outline"
          disabled={!current || (current.state !== "local" && current.state !== "failed")}
          onPress={() => {
            setMoreOpen(false);
            if (current) void enqueueForUpload(current.id).catch(() => {});
          }}
        />
        {current?.local_uri ? (
          <ListRow title={t("viewer.send")} icon="paper-plane-outline" onPress={openSendPicker} />
        ) : null}
        <ListRow
          title={t("viewer.edit")}
          icon="color-wand-outline"
          disabled={
            !current ||
            !current.mime_type.startsWith("image/") ||
            !current.local_uri ||
            !current.remote_message_id
          }
          onPress={() => {
            setMoreOpen(false);
            if (current) navigation.navigate("Edit", { mediaId: current.id });
          }}
        />
        <ListRow
          title={t("viewer.archive")}
          icon="archive-outline"
          disabled={!current}
          onPress={() => {
            setMoreOpen(false);
            if (current) void setMediaVisibility(current.id, "archived");
          }}
        />
        <ListRow
          title={t("viewer.hide")}
          icon="eye-off-outline"
          disabled={!current}
          onPress={() => {
            setMoreOpen(false);
            if (current) void setMediaVisibility(current.id, "hidden");
          }}
        />
        <ListRow
          title={t("viewer.delete")}
          icon="trash-outline"
          danger
          disabled={!current}
          onPress={() => {
            setMoreOpen(false);
            trashCurrent();
          }}
        />
      </Sheet>

      <Sheet
        visible={sendPickerOpen}
        onClose={() => setSendPickerOpen(false)}
        title={t("viewer.send")}
        scroll
      >
        {albums.length === 0 ? (
          <AppText variant="body" color={theme.colors.onSurfaceVariant} style={styles.albumEmpty}>
            No shared albums linked yet — set one up in Collections → Shared albums.
          </AppText>
        ) : (
          albums.map((a) => (
            <ListRow
              key={a.id}
              title={a.title}
              subtitle={a.count === 1 ? "1 item" : `${a.count.toLocaleString()} items`}
              onPress={() => doSend(a.id)}
            />
          ))
        )}
      </Sheet>

      <Sheet
        visible={noteEditorOpen}
        onClose={() => setNoteEditorOpen(false)}
        title="Photo note"
        subtitle="Saved as this photo's caption in Telegram."
        scroll
        footer={
          <>
            {current?.note_text ? (
              <Button label="Remove" variant="danger" onPress={() => void saveNote(null, false)} />
            ) : null}
            <Button label={t("common.cancel")} variant="quiet" onPress={() => setNoteEditorOpen(false)} />
            <Button
              label={t("common.save")}
              onPress={() => {
                const trimmed = noteDraft.trim();
                void saveNote(trimmed.length > 0 ? trimmed : null, false);
              }}
            />
          </>
        }
      >
        <Input
          value={noteDraft}
          onChangeText={setNoteDraft}
          multiline
          minHeight={120}
          maxLength={1000}
          autoFocus
          placeholder="Emma's first steps…"
          hint={`${noteDraft.length}/1000`}
          accessibilityLabel="Photo note"
        />
      </Sheet>

      <Sheet
        visible={tagEditorOpen}
        onClose={() => setTagEditorOpen(false)}
        title="My tags"
        subtitle="Your own words, comma-separated — searchable like everything else. Stays on this phone."
        scroll
        footer={
          <>
            {current?.user_tags ? (
              <Button label="Remove" variant="danger" onPress={() => void saveTags(null)} />
            ) : null}
            <Button label={t("common.cancel")} variant="quiet" onPress={() => setTagEditorOpen(false)} />
            <Button
              label={t("common.save")}
              onPress={() => {
                const trimmed = tagDraft.trim();
                void saveTags(trimmed.length > 0 ? trimmed : null);
              }}
            />
          </>
        }
      >
        <Input
          value={tagDraft}
          onChangeText={setTagDraft}
          multiline
          minHeight={96}
          maxLength={400}
          autoFocus
          placeholder="mom, Kashmir trip 2024, best food"
          hint={`${tagDraft.length}/400`}
          accessibilityLabel="My tags"
        />
      </Sheet>

      <View style={styles.a11yHint} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </View>
  );
}

function ViewerAction({
  icon,
  label,
  onPress,
  disabled,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  const color = disabled
    ? theme.colors.onViewerMuted
    : accent
      ? theme.colors.accent
      : theme.colors.onViewer;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.action, disabled && styles.actionDisabled]}
    >
      <Ionicons name={icon} size={theme.layout.icon} color={color} importantForAccessibility="no" />
      <AppText variant="caption2" weight="medium" color={color} numberOfLines={1}>
        {label}
      </AppText>
    </PressableScale>
  );
}

function InfoRow({ k, v, onPress }: { k: string; v: string; onPress?: () => void }) {
  const content = (
    <>
      <AppText variant="caption" color={theme.colors.onSurfaceVariant}>
        {k}
      </AppText>
      <AppText variant="body" align="right" numberOfLines={4} style={styles.infoValue}>
        {v}
      </AppText>
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.infoRow} accessible accessibilityLabel={`${k}: ${v}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${k}: ${v}`}
      android_ripple={{ color: theme.colors.surfaceHover, borderless: false }}
      style={({ pressed }) => [styles.infoRow, pressed && { backgroundColor: theme.colors.surfaceHover }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.viewer },
  loadingWrap: { alignItems: "center", justifyContent: "center" },
  zoomScroll: { flex: 1 },
  videoWrap: { justifyContent: "center", backgroundColor: theme.colors.viewer },
  cloudNote: {
    position: "absolute",
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.compact,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.mediaScrimStrong,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.compact,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.mediaScrim,
  },
  dateWrap: { flex: 1, alignItems: "center", gap: theme.spacing.xs, minHeight: theme.layout.touch, justifyContent: "center" },
  statusBadge: { alignSelf: "center" },
  actionsBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: theme.spacing.sm,
    justifyContent: "space-around",
    paddingTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: theme.colors.mediaScrim,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.xs,
    minWidth: 72,
    minHeight: theme.layout.touch,
    paddingHorizontal: theme.spacing.xs,
  },
  actionDisabled: { opacity: 0.4 },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    minHeight: theme.layout.touch,
    paddingVertical: theme.spacing.compact,
    borderRadius: theme.radius.control,
    paddingHorizontal: theme.spacing.xs,
  },
  infoValue: { flex: 1, maxWidth: "65%" },
  albumEmpty: { paddingVertical: theme.spacing.md },
  a11yHint: { height: 0 },
});
