import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import TdLib from "react-native-tdlib";
import { deleteMediaRow, listTrashed, MediaRow, setMediaVisibility } from "../db/queries";
import { TRASH_RETENTION_DAYS } from "../lib/trash";
import { theme } from "../theme";

function daysLeft(trashedAt: number | null): number {
  if (!trashedAt) return TRASH_RETENTION_DAYS;
  const elapsedDays = Math.floor((Date.now() - trashedAt) / (24 * 60 * 60 * 1000));
  return Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
}

export function TrashScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Tabs: undefined }>;
}) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    void listTrashed().then(setRows);
  }, []);

  useEffect(() => {
    reload();
  }, [reload, tick]);

  const restore = useCallback(async (row: MediaRow) => {
    await setMediaVisibility(row.id, "visible");
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }, []);

  const deleteForever = useCallback((row: MediaRow) => {
    Alert.alert("Delete forever?", `${row.file_name ?? "This item"} will be removed from Telegram too.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            if (row.remote_chat_id && row.remote_message_id && row.remote_message_id !== "0") {
              try {
                await TdLib.deleteMessages(Number(row.remote_chat_id), [Number(row.remote_message_id)], false);
              } catch {}
            }
            await deleteMediaRow(row.id);
            setRows((prev) => prev.filter((r) => r.id !== row.id));
          })();
        },
      },
    ]);
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Trash</Text>
      </View>
      <Text style={styles.note}>Items are permanently deleted after {TRASH_RETENTION_DAYS} days.</Text>

      <FlashList
        data={rows}
        numColumns={3}
        masonry
        keyExtractor={(r) => String(r.id)}
        extraData={tick}
        renderItem={({ item }) => {
          const left = daysLeft((item as any).trashed_at ?? null);
          return (
            <View style={styles.cell}>
              <Image source={{ uri: item.thumb_uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={`t-${item.id}`} />
              <View style={styles.cellShade} />
              <Text style={styles.days}>{left <= 1 ? "1 day" : `${left} days`}</Text>
              <View style={styles.cellActions}>
                <Pressable style={styles.miniBtn} onPress={() => void restore(item)}>
                  <Text style={styles.miniBtnText}>Restore</Text>
                </Pressable>
                <Pressable style={[styles.miniBtn, styles.dangerBtn]} onPress={() => deleteForever(item)}>
                  <Text style={[styles.miniBtnText, styles.dangerText]}>Delete</Text>
                </Pressable>
              </View>
              {left === 0 ? <View style={styles.expiredFlag} /> : null}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>Trash is empty.</Text>}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.md, paddingBottom: 4 },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  note: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
  listContent: { paddingBottom: 40 },
  cell: {
    flex: 1,
    margin: 1,
    aspectRatio: 0.8,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
    justifyContent: "flex-end",
  },
  cellShade: { ...StyleSheet.absoluteFill, backgroundColor: "#00000055" },
  days: { color: "#FFFFFF", fontSize: 11, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  cellActions: { flexDirection: "row", justifyContent: "center", gap: 4, paddingBottom: 6 },
  miniBtn: { backgroundColor: "#FFFFFF22", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  dangerBtn: { backgroundColor: "#EA433533" },
  miniBtnText: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "600" },
  dangerText: { color: theme.colors.error },
  expiredFlag: { position: "absolute", top: 5, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.error },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 60 },
});
