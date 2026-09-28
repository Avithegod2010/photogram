import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getMediaByIds, setMediaVisibility, setMediaFavorite, isSharedAlbumMedia, listVersionsFor, MediaRow } from "../db/queries";
import { enqueueForUpload } from "../lib/uploader";
import { saveViewerNote, syncPendingNotes } from "../lib/notes";
import { hasRemoteCopy, restoreMediaToDevice } from "../lib/restorer";
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
  const [savingId, setSavingId] = useState<number | null>(null);
  const listRef = useRef<FlatList<MediaRow> | null>(null);

  useMemo(() => {
    void getMediaByIds(ids).then(setRows);
  }, [ids]);

  const current = rows.find((r) => r.id === currentId);

  const saveCurrent = useCallback(async () => {
    if (!current || savingId !== null) return;
    setSavingId(current.id);
    try {
      const result = await restoreMediaToDevice(current.id);
      if (result.outcome === "restored") {
        const refreshed = await getMediaByIds([current.id]);
        setRows((prev) => prev.map((r) => (r.id === current.id ? refreshed[0] ?? r : r)));
        Alert.alert("Saved", "This item was restored to your device gallery from Telegram.");
      } else {
        Alert.alert("Couldn't save", result.message ?? "Unknown error.");
      }
    } finally {
      setSavingId(null);
    }
  }, [current, savingId]);

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

  const favoriteCurrent = useCallback(async () => {
    if (!current) return;
    const fav = !current.is_favorite;
    await setMediaFavorite(current.id, fav);
    setRows((prev) => prev.map((r) => (r.id === current.id ? { ...r, is_favorite: fav ? 1 : 0 } : r)));
  }, [current]);

  // --- F3 photo journaling: note editor state + save/remove (docs/PLAN-F3-JOURNALING.md) ---
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const noteSyncRanRef = useRef(false);

  // v0.19 versioned archive: edited copies of the current photo (for the info
  // sheet's Versions row).
  const [versions, setVersions] = useState<MediaRow[]>([]);
  useEffect(() => {
    if (!current) {
      setVersions([]);
      return;
    }
    void listVersionsFor(current.edited_from ?? current.id)
      .then((rows) => {
        // Viewing the original → list its edits; viewing an edit → list the
        // root original's edits so the full version set is always shown.
        setVersions(rows.filter((r) => r.id !== current.id));
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

  // Local-first save; the Telegram caption push happens here when the row is
  // already synced, or later via the boot/open triggers (offline-safe).
  const saveNote = useCallback(
    async (text: string | null, force: boolean) => {
      if (!current) return;
      if (await isSharedAlbumMedia(current.id)) {
        Alert.alert("Notes apply to your own backed-up photos", "Family album media is not editable here.");
        setNoteEditorOpen(false);
        return;
      }
      const result = await saveViewerNote(current, text, force);
      if (result.status === "foreign") {
        Alert.alert(
          "Replace the caption?",
          `Telegram currently shows the caption "${result.caption}". Replace it with your note?`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Replace", onPress: () => void saveNote(text, true) },
          ]
        );
        return;
      }
      if (result.status === "failed") {
        Alert.alert(
          "Note saved on this phone",
          `Telegram didn't accept it yet (${result.reason ?? "error"}). It will retry automatically.`
        );
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
        <ActionChip label="Share" icon="share-social-outline" onPress={() => void shareCurrent()} />
        <ActionChip
          label={current?.is_favorite ? "Favorited" : "Favorite"}
          icon={current?.is_favorite ? "heart" : "heart-outline"}
          danger={!!current?.is_favorite}
          disabled={!current}
          onPress={() => void favoriteCurrent()}
        />
        {current && !current.local_uri && hasRemoteCopy(current) ? (
          <ActionChip
            label={savingId === current.id ? "Saving…" : "Save to device"}
            icon="download-outline"
            disabled={savingId !== null}
            onPress={() => void saveCurrent()}
          />
        ) : null}
        <ActionChip
          label="Back up"
          icon="cloud-upload-outline"
          disabled={!current || (current.state !== "local" && current.state !== "failed")}
          onPress={() => {
            if (!current) return;
            void enqueueForUpload(current.id).catch(() => {});
          }}
        />
        <ActionChip label="Note" icon="pencil-outline" disabled={!current} onPress={openNoteEditor} />
        <ActionChip
          label="Edit"
          icon="color-wand-outline"
          disabled={
            !current ||
            !current.mime_type.startsWith("image/") ||
            !current.local_uri ||
            !current.remote_message_id
          }
          onPress={() => current && navigation.navigate("Edit", { mediaId: current.id })}
        />
        <ActionChip
          label="Archive"
          icon="archive-outline"
          disabled={!current}
          onPress={() => {
            if (!current) return;
            void setMediaVisibility(current.id, "archived");
          }}
        />
        <ActionChip
          label="Hide"
          icon="eye-off-outline"
          disabled={!current}
          onPress={() => {
            if (!current) return;
            void setMediaVisibility(current.id, "hidden");
          }}
        />
        <ActionChip
          label="Delete"
          icon="trash-outline"
          danger
          disabled={!current}
          onPress={() => void trashCurrent()}
        />
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
                <Pressable onPress={openNoteEditor}>
                  <MetaRow
                    k="Note"
                    v={
                      current.note_text
                        ? current.note_text +
                          (current.state === "synced" && current.note_synced === 0 ? " · pending" : "")
                        : "None — tap to add"
                    }
                  />
                </Pressable>
                {versions.length > 0 ? (
                  <Pressable
                    onPress={() =>
                      navigation.navigate("Viewer", {
                        ids: [current.id, ...versions.map((v) => v.id)],
                        index: 0,
                      })
                    }
                  >
                    <MetaRow k="Versions" v={`${versions.length + 1} (original + edits) — tap to flip through`} />
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <NoteEditorModal
        visible={noteEditorOpen}
        initialText={current?.note_text ?? ""}
        onClose={() => setNoteEditorOpen(false)}
        onSave={(text) => void saveNote(text, false)}
      />
    </View>
  );
}

function ActionChip({
  label,
  icon,
  onPress,
  danger,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: theme.colors.outlineVariant }}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed, disabled && styles.chipDisabled]}
    >
      <Ionicons name={icon} size={21} style={[styles.chipIcon, danger && styles.chipDanger]} />
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
    flexWrap: "wrap",
    rowGap: 6,
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
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    backgroundColor: "#FFFFFF12",
  },
  chipPressed: { opacity: 0.7 },
  chipDisabled: { opacity: 0.35 },
  chipIcon: { color: theme.colors.primary },
  chipText: { color: theme.colors.onSurfaceVariant, fontSize: 10.5, fontWeight: "600", letterSpacing: 0.3 },
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

// --- F3 photo journaling: note editor (own styles; the block above is shared) ---

function NoteEditorModal({
  visible,
  initialText,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialText: string;
  onSave: (text: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialText);
  useEffect(() => {
    if (visible) setDraft(initialText);
  }, [visible, initialText]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={noteStyles.backdrop} onPress={onClose}>
        <Pressable style={noteStyles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={noteStyles.title}>Photo note</Text>
          <Text style={noteStyles.hint}>Saved as this photo's caption in Telegram.</Text>
          <TextInput
            style={noteStyles.input}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={1000}
            autoFocus
            textAlignVertical="top"
            placeholder="Emma's first steps…"
            placeholderTextColor={theme.colors.onSurfaceVariant + "88"}
          />
          <Text style={noteStyles.counter}>{draft.length}/1000</Text>
          <View style={noteStyles.buttons}>
            {initialText ? (
              <Pressable style={noteStyles.btn} onPress={() => onSave(null)}>
                <Text style={[noteStyles.btnText, { color: theme.colors.error }]}>Remove</Text>
              </Pressable>
            ) : null}
            <Pressable style={noteStyles.btn} onPress={onClose}>
              <Text style={noteStyles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[noteStyles.btn, noteStyles.btnPrimary]}
              onPress={() => {
                const trimmed = draft.trim();
                onSave(trimmed.length > 0 ? trimmed : null);
              }}
            >
              <Text style={[noteStyles.btnText, noteStyles.btnPrimaryText]}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const noteStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000AA", justifyContent: "center", padding: theme.spacing.xl },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.onSurface, fontSize: 18, fontWeight: "700" },
  hint: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  input: {
    marginTop: theme.spacing.md,
    minHeight: 110,
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.lg,
    color: theme.colors.onSurface,
    fontSize: 14,
    padding: theme.spacing.md,
    textAlignVertical: "top",
  },
  counter: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, textAlign: "right", marginTop: 4 },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing.md, marginTop: theme.spacing.sm },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.full },
  btnPrimary: { backgroundColor: theme.colors.primary },
  btnText: { color: theme.colors.onSurface, fontSize: 13.5, fontWeight: "600" },
  btnPrimaryText: { color: theme.colors.onPrimary },
});
