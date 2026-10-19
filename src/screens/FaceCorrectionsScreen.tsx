import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listRejectionDetails, unblockRejection, type RejectionDetail } from "../db/queries";
import { theme } from "../theme";

// v0.40 Review corrections — every blocked face pair ("Not this person" /
// split-off memories) with its two photos side by side. Undo deletes the
// canonical pair so the next "Group faces" can reconsider it; the samples
// stay unassigned either way. Nothing here is auto-suggested back at the
// person until the owner re-runs grouping.
export function FaceCorrectionsScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number }; People: undefined }>;
}) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<RejectionDetail[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const details = await listRejectionDetails().catch(() => [] as RejectionDetail[]);
    setRows(details);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const undo = useCallback(
    (r: RejectionDetail) => {
      Alert.alert(
        "Undo correction",
        "This pair stops being blocked — tap \"Group faces\" on the People screen to let the app reconsider it.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Undo",
            style: "destructive",
            onPress: () => {
              setBusy(true);
              void unblockRejection(r.sampleId, r.blockedSampleId)
                .then(reload)
                .finally(() => setBusy(false));
            },
          },
        ]
      );
    },
    [reload]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Review corrections</Text>
          <Text style={styles.sub}>Every "not this person" / split-off face pair you taught the app</Text>
        </View>
      </View>
      <Text style={styles.note}>
        Undo one to let "Group faces" consider the pair again. Corrections keep working even after
        merges, renames or splits — that is by design.
      </Text>
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.sampleId}-${r.blockedSampleId}`}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Pressable
              style={styles.thumbPair}
              onPress={() =>
                navigation.navigate("Viewer", {
                  ids: [item.mediaIdA, item.mediaIdB].filter((id) => id > 0),
                  index: 0,
                })
              }
            >
              <Image source={{ uri: item.thumbA ?? undefined }} style={styles.thumb} contentFit="cover" />
              <Image source={{ uri: item.thumbB ?? undefined }} style={styles.thumb} contentFit="cover" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.personLine}>
                {item.personName ? `"${item.personName}"` : "Unknown person"}
                {item.personStillExists ? "" : " (person deleted)"}
              </Text>
              <Text style={styles.dateLine}>
                Blocked {new Date(item.createdAt).toLocaleDateString()} · tap photos to open
              </Text>
            </View>
            <Pressable style={[styles.undoBtn, busy && styles.btnDisabled]} onPress={() => undo(item)} disabled={busy}>
              <Text style={styles.undoText}>Undo</Text>
            </Pressable>
          </View>
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No corrections yet. Nothing blocked — nothing to review.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 22, fontWeight: "700" },
  sub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  note: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  listContent: { paddingBottom: 40, paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  thumbPair: { flexDirection: "row", gap: 4 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceHighest,
  },
  personLine: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "600" },
  dateLine: { color: theme.colors.onSurfaceVariant, fontSize: 11, marginTop: 3 },
  undoBtn: {
    backgroundColor: theme.colors.secondaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnDisabled: { opacity: 0.5 },
  undoText: { color: theme.colors.onSecondaryContainer, fontWeight: "700", fontSize: 12 },
  empty: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, marginTop: 40, marginHorizontal: theme.spacing.xl, lineHeight: 20 },
});
