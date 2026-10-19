import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  listFacesForPerson,
  listPeople,
  listPeopleFull,
  listSampleIdsForMediaInPerson,
  renamePerson,
  setPersonSensitivity,
  type MediaRow,
  type PersonFull,
  type PeopleRow,
} from "../db/queries";
import { runClustering, mergePeople, splitOffFaces, dismissFacesFromPerson } from "../lib/people";
import { theme } from "../theme";

const SENS_CHIPS: { label: string; value: number }[] = [
  { label: "Loose 0.5", value: 0.5 },
  { label: "Normal 0.6", value: 0.6 },
  { label: "Strict 0.75", value: 0.75 },
];

interface PersonViewState {
  person: PersonFull;
  photos: MediaRow[];
  selecting: boolean;
  selected: Set<number>;
}

// v0.39 People & Pets v2: list → person's photos. List row long-press starts
// a merge (tap the second person — their faces move INTO the first). Inside a
// person: ✎ rename (+ sensitivity chips), Select → "Split off", long-press a
// photo → "Not this person" (blocked pairs keep the dismissal through future
// re-groupings). "Group faces" runs the v2 engine (affinity attach + blocked
// pairs).
export function PeopleScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<PersonFull[]>([]);
  const [listRows, setListRows] = useState<PeopleRow[]>([]);
  const [view, setView] = useState<PersonViewState | null>(null);
  const [grouping, setGrouping] = useState(false);
  const [groupedNote, setGroupedNote] = useState<string | null>(null);
  const [merging, setMerging] = useState<PersonFull | null>(null);
  const [renaming, setRenaming] = useState<PersonFull | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const reload = useCallback(async () => {
    const full = await listPeopleFull().catch(() => [] as PersonFull[]);
    const rows = await listPeople().catch(() => [] as PeopleRow[]);
    setPeople(full);
    setListRows(rows);
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
        result.peopleCreated > 0 || result.attachedToNamed > 0
          ? `${result.attachedToNamed} face${result.attachedToNamed === 1 ? "" : "s"} attached to named people; ${result.peopleCreated} new group${result.peopleCreated === 1 ? "" : "s"} created.`
          : "No new groups found — new faces will group after their embeddings are computed."
      );
    } catch {
      setGroupedNote("Grouping failed — try again.");
    } finally {
      setGrouping(false);
      void reload();
    }
  }, [grouping, reload]);

  const openTheirs = useCallback(async (person: PersonFull) => {
    const rows = await listFacesForPerson(person.id).catch(() => [] as MediaRow[]);
    setView({ person, photos: rows, selecting: false, selected: new Set() });
  }, []);

  const saveRename = useCallback(async () => {
    if (!renaming) return;
    const name = renameDraft.trim();
    await renamePerson(renaming.id, name.length > 0 ? name : null);
    setRenaming(null);
    void reload();
  }, [renaming, renameDraft, reload]);

  const confirmMerge = useCallback((target: PersonFull, source: PersonFull) => {
    const count = listRows.find((r) => r.id === source.id)?.face_count ?? 0;
    Alert.alert(
      "Merge people",
      `Move all of "${source.name ?? "Unnamed"}" (${count} face${count === 1 ? "" : "s"}) into "${target.name ?? "Unnamed"}"?\n\n"${target.name ?? "Unnamed"}" keeps its name.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Merge",
          style: "destructive",
          onPress: () => {
            void mergePeople(target.id, source.id).then(() => {
              if (view?.person.id === source.id) setView(null);
              void reload();
            });
          },
        },
      ]
    );
  }, [listRows, reload, view]);

  const onPersonRowPress = useCallback(
    (person: PersonFull) => {
      if (merging === null) {
        void openTheirs(person);
        return;
      }
      if (person.id === merging.id) {
        setMerging(null);
        return;
      }
      const target = merging;
      setMerging(null);
      confirmMerge(target, person);
    },
    [merging, openTheirs, confirmMerge]
  );

  const doSplit = useCallback((person: PersonFull, mediaIds: number[]) => {
    Alert.alert(
      "Split off",
      `Move ${mediaIds.length} photo${mediaIds.length === 1 ? "" : "s"} out of "${person.name ?? "Unnamed"}"? They will not re-group with what stays (unless you merge later).`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Split",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const samples: number[] = [];
              for (const mediaId of mediaIds) {
                samples.push(...(await listSampleIdsForMediaInPerson(mediaId, person.id)));
              }
              await splitOffFaces(samples, person.id);
              setView(null);
              void reload();
            })();
          },
        },
      ]
    );
  }, [reload]);

  const doNotThisPerson = useCallback((person: PersonFull, mediaId: number) => {
    Alert.alert(
      "Not this person?",
      `Remove this photo from "${person.name ?? "Unnamed"}" and stop suggesting them together in future groupings?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const samples = await listSampleIdsForMediaInPerson(mediaId, person.id);
              await dismissFacesFromPerson(samples, person.id);
              const rows = await listFacesForPerson(person.id).catch(() => [] as MediaRow[]);
              setView({ person, photos: rows, selecting: false, selected: new Set() });
              void reload();
            })();
          },
        },
      ]
    );
  }, [reload]);

  const setSensitivity = useCallback((person: PersonFull, value: number | null) => {
    void setPersonSensitivity(person.id, value).then(() => reload());
  }, [reload]);

  const isChipOn = (sens: number | null, value: number) => Math.abs((sens ?? 0.6) - value) < 0.01;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (view && view.selecting) setView({ ...view, selecting: false, selected: new Set() });
            else if (view) setView(null);
            else navigation.goBack();
          }}
          hitSlop={12}
        >
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {view ? view.person.name ?? "Unnamed" : merging ? "Tap the target person…" : "People"}
          </Text>
          <Text style={styles.sub}>
            {view
              ? `${view.photos.length} photo${view.photos.length === 1 ? "" : "s"} with this person`
              : merging
              ? "Their faces move into the person you tapped first."
              : "Grouped on this phone — long-press a person to start a merge"}
          </Text>
        </View>
        {view ? (
          <>
            <Pressable style={styles.groupBtn} onPress={() => setRenaming(view.person)}>
              <Text style={styles.groupBtnText}>✎ Name</Text>
            </Pressable>
            <Pressable
              style={[styles.groupBtn, view.selecting && styles.btnDisabled]}
              onPress={() => setView({ ...view, selecting: !view.selecting, selected: new Set() })}
            >
              <Text style={styles.groupBtnText}>{view.selecting ? "Cancel" : "Select"}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={[styles.groupBtn, grouping && styles.btnDisabled]} onPress={() => void groupFaces()}>
            <Text style={styles.groupBtnText}>{grouping ? "Grouping…" : "Group faces"}</Text>
          </Pressable>
        )}
      </View>
      {groupedNote && view === null && merging === null ? <Text style={styles.note}>{groupedNote}</Text> : null}

      {view !== null ? (
        <>
          {view.person.name !== null ? (
            <View style={styles.sensRow}>
              <Text style={styles.sensLabel}>Attach new faces at:</Text>
              {SENS_CHIPS.map((chip) => (
                <Pressable
                  key={chip.label}
                  style={[styles.sensChip, isChipOn(view.person.sensitivity, chip.value) && styles.sensChipOn]}
                  onPress={() => setSensitivity(view.person, chip.value)}
                >
                  <Text style={[styles.sensChipText, isChipOn(view.person.sensitivity, chip.value) && styles.sensChipTextOn]}>
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <FlatList
            data={view.photos}
            numColumns={3}
            keyExtractor={(r) => String(r.id)}
            renderItem={({ item }) => {
              const selected = view.selected.has(item.id);
              return (
                <Pressable
                  style={[styles.cell, selected && styles.cellSelected]}
                  onPress={() => {
                    if (view.selecting) {
                      const next = new Set(view.selected);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      setView({ ...view, selected: next });
                    } else {
                      navigation.navigate("Viewer", {
                        ids: view.photos.map((r) => r.id),
                        index: view.photos.findIndex((r) => r.id === item.id),
                      });
                    }
                  }}
                  onLongPress={() => !view.selecting && doNotThisPerson(view.person, item.id)}
                >
                  <Image
                    source={{ uri: item.thumb_uri }}
                    style={styles.cellImg}
                    contentFit="cover"
                    transition={120}
                    recyclingKey={`pp-${item.id}`}
                  />
                </Pressable>
              );
            }}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.empty}>No photos found for this person.</Text>}
            ListFooterComponent={
              view.selecting ? (
                <View style={styles.selectActions}>
                  <Text style={styles.selectHint}>
                    {view.selected.size} selected — tap photos to pick, then split them out of this
                    person. (Long-press does "Not this person" when not selecting.)
                  </Text>
                  <Pressable
                    style={[styles.groupBtn, view.selected.size === 0 && styles.btnDisabled]}
                    disabled={view.selected.size === 0}
                    onPress={() => doSplit(view.person, [...view.selected])}
                  >
                    <Text style={styles.groupBtnText}>Split off ({view.selected.size})</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.hintLine}>
                  Long-press a photo → "Not this person". Tap Select to split several out.
                </Text>
              )
            }
          />
        </>
      ) : people.length === 0 ? (
        <Text style={styles.empty}>
          No people yet. Enable face detection, download a model, run "Detect & embed" in setup —
          then tap "Group faces".
        </Text>
      ) : (
        <FlatList
          data={listRows}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => {
            const full = people.find((p) => p.id === item.id) ?? null;
            return (
              <Pressable
                style={[styles.personRow, merging?.id === item.id && styles.personRowMerging]}
                onPress={() => full && onPersonRowPress(full)}
                onLongPress={() => full && setMerging(full)}
              >
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
            );
          }}
          contentContainerStyle={styles.listContent}
        />
      )}

      {merging !== null ? (
        <View style={styles.mergeBanner} pointerEvents="none">
          <Text style={styles.mergeBannerText}>
            Merging "{merging.name ?? "Unnamed"}" — now tap the person these faces move INTO.
          </Text>
        </View>
      ) : null}

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
            <View style={styles.sensRow}>
              <Text style={noteStyles.hint}>Attach new faces at:</Text>
              {SENS_CHIPS.map((chip) => (
                <Pressable
                  key={chip.label}
                  style={[styles.sensChip, isChipOn(renaming?.sensitivity ?? null, chip.value) && styles.sensChipOn]}
                  onPress={async () => {
                    if (renaming) {
                      await setPersonSensitivity(renaming.id, chip.value);
                      setRenaming({ ...renaming, sensitivity: chip.value });
                    }
                  }}
                >
                  <Text
                    style={[
                      styles.sensChipText,
                      isChipOn(renaming?.sensitivity ?? null, chip.value) && styles.sensChipTextOn,
                    ]}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>
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
  personRowMerging: { backgroundColor: theme.colors.secondaryContainer },
  personThumb: { width: 56, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceHighest },
  personName: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "600" },
  personSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  chevron: { color: theme.colors.onSurfaceVariant, fontSize: 20 },
  cell: { width: Math.floor(Dimensions.get("window").width / 3) - 2, height: Math.floor(Dimensions.get("window").width / 3) - 2, margin: 1, backgroundColor: theme.colors.surfaceContainer },
  cellImg: { width: "100%", height: "100%" },
  cellSelected: { borderWidth: 3, borderColor: theme.colors.primary },
  sensRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, flexWrap: "wrap" },
  sensLabel: { color: theme.colors.onSurfaceVariant, fontSize: 11.5 },
  sensChip: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  sensChipOn: { backgroundColor: theme.colors.primary },
  sensChipText: { color: theme.colors.onSurfaceVariant, fontSize: 11, fontWeight: "600" },
  sensChipTextOn: { color: theme.colors.onPrimary },
  selectHint: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginBottom: theme.spacing.sm },
  selectActions: { padding: theme.spacing.md, alignItems: "flex-start" },
  hintLine: { color: theme.colors.onSurfaceVariant, fontSize: 11, textAlign: "center", paddingBottom: theme.spacing.md },
  mergeBanner: {
    position: "absolute",
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: theme.colors.secondaryContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  mergeBannerText: { color: theme.colors.onSecondaryContainer, fontSize: 12.5, textAlign: "center" },
});
