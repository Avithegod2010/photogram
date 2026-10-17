import React, { useCallback, useEffect, useState } from "react";
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listFacesForPerson, listPeople, renamePerson, MediaRow, PeopleRow } from "../db/queries";
import { runClustering } from "../lib/people";
import { theme } from "../theme";

// v0.35 People & Pets step 2: the grouped people. "Group faces" runs the
// on-device clustering over new embeddings (named people are never
// re-shuffled); tap a person to see their photos, long-press-free rename via
// the ✎ button.
export function PeopleScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<PeopleRow[] | null>(null);
  const [openPerson, setOpenPerson] = useState<PeopleRow | null>(null);
  const [theirPhotos, setTheirPhotos] = useState<MediaRow[]>([]);
  const [grouping, setGrouping] = useState(false);
  const [groupedNote, setGroupedNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<PeopleRow | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const reload = useCallback(() => {
    void listPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const groupFaces = useCallback(async () => {
    if (grouping) return;
    setGrouping(true);
    setGroupedNote(null);
    try {
      const result = await runClustering();
      setGroupedNote(
        result.peopleCreated > 0
          ? `${result.peopleCreated} new person${result.peopleCreated === 1 ? "" : "s"} grouped from ${result.groupedFaces} faces.`
          : "No new groups found — new faces will group after their embeddings are computed."
      );
    } catch {
      setGroupedNote("Grouping failed — try again.");
    } finally {
      setGrouping(false);
      reload();
    }
  }, [grouping, reload]);

  const openTheirs = useCallback(
    async (person: PeopleRow) => {
      setOpenPerson(person);
      const rows = await listFacesForPerson(person.id).catch(() => []);
      setTheirPhotos(rows);
    },
    []
  );

  const saveRename = useCallback(async () => {
    if (!renaming) return;
    const name = renameDraft.trim();
    await renamePerson(renaming.id, name.length > 0 ? name : null);
    setRenaming(null);
    if (openPerson?.id === renaming.id) setOpenPerson({ ...renaming, name: name || null });
    reload();
  }, [renaming, renameDraft, openPerson, reload]);

  const CELL = Math.floor(Dimensions.get("window").width / 3) - 2;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable
          onPress={() => (openPerson ? setOpenPerson(null) : navigation.goBack())}
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{openPerson ? openPerson.name ?? "Unnamed" : "People"}</Text>
          <Text style={styles.sub}>
            {openPerson
              ? `${theirPhotos.length} photo${theirPhotos.length === 1 ? "" : "s"} with this person`
              : "Grouped on this phone — name anyone you recognize"}
          </Text>
        </View>
        {!openPerson ? (
          <Pressable style={[styles.groupBtn, grouping && styles.btnDisabled]} onPress={() => void groupFaces()}>
            <Text style={styles.groupBtnText}>{grouping ? "Grouping…" : "Group faces"}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.groupBtn} onPress={() => setRenaming(openPerson)}>
            <Text style={styles.groupBtnText}>✎ Name</Text>
          </Pressable>
        )}
      </View>
      {groupedNote && !openPerson ? <Text style={styles.note}>{groupedNote}</Text> : null}

      {openPerson ? (
        <FlatList
          data={theirPhotos}
          numColumns={3}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item, index }) => (
            <Pressable
              style={styles.cell}
              onPress={() =>
                navigation.navigate("Viewer", { ids: theirPhotos.map((r) => r.id), index })
              }
            >
              <Image
                source={{ uri: item.thumb_uri }}
                style={styles.cellImg}
                contentFit="cover"
                transition={120}
                recyclingKey={`pp-${item.id}`}
              />
            </Pressable>
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>No photos found for this person.</Text>}
        />
      ) : people === null ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : people.length === 0 ? (
        <Text style={styles.empty}>
          No people yet. Enable face detection, download a model, run "Detect & embed" in setup —
          then tap "Group faces".
        </Text>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => (
            <Pressable style={styles.personRow} onPress={() => void openTheirs(item)}>
              <Image
                source={{ uri: item.cover ?? undefined }}
                style={styles.personThumb}
                contentFit="cover"
                recyclingKey={`ppl-${item.id}`}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.personName}>{item.name ?? "Unnamed"}</Text>
                <Text style={styles.personSub}>
                  {item.face_count} face{item.face_count === 1 ? "" : "s"} · tap to see photos
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={noteStyles.backdrop} onPress={() => setRenaming(null)}>
          <Pressable style={noteStyles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={noteStyles.title}>Name this person</Text>
            <Text style={noteStyles.hint}>Stored on this phone only.</Text>
            <TextInput
              style={noteStyles.input}
              value={renameDraft}
              onChangeText={setRenameDraft}
              maxLength={60}
              autoFocus
              placeholder="Mom, Dad, Emma…"
              placeholderTextColor={theme.colors.onSurfaceVariant + "88"}
            />
            <View style={noteStyles.buttons}>
              <Pressable style={noteStyles.btn} onPress={() => setRenaming(null)}>
                <Text style={noteStyles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[noteStyles.btn, noteStyles.btnPrimary]} onPress={() => void saveRename()}>
                <Text style={[noteStyles.btnText, noteStyles.btnPrimaryText]}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// noteStyles are defined in ViewerScreen; duplicating the few used here keeps
// screens decoupled (same visual language).
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
    minHeight: 48,
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.lg,
    color: theme.colors.onSurface,
    fontSize: 14,
    padding: theme.spacing.md,
  },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing.md, marginTop: theme.spacing.sm },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.full },
  btnPrimary: { backgroundColor: theme.colors.primary },
  btnText: { color: theme.colors.onSurface, fontSize: 13.5, fontWeight: "600" },
  btnPrimaryText: { color: theme.colors.onPrimary },
});

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
  groupBtn: {
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnDisabled: { opacity: 0.5 },
  groupBtnText: { color: theme.colors.onPrimaryContainer, fontWeight: "700", fontSize: 12 },
  note: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xs,
  },
  listContent: { paddingBottom: 32, paddingHorizontal: theme.spacing.lg },
  empty: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, marginTop: 40, marginHorizontal: theme.spacing.xl, lineHeight: 20 },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outlineVariant,
  },
  personThumb: { width: 56, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceHighest },
  personName: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "600" },
  personSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  chevron: { color: theme.colors.onSurfaceVariant, fontSize: 20 },
  cell: { width: Math.floor(Dimensions.get("window").width / 3) - 2, height: Math.floor(Dimensions.get("window").width / 3) - 2, margin: 1, backgroundColor: theme.colors.surfaceContainer },
  cellImg: { width: "100%", height: "100%" },
});
