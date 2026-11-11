import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  assignFacesToPerson,
  getMediaByIds,
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
import {
  runClustering,
  mergePeople,
  splitOffFaces,
  dismissFacesFromPerson,
  listPersonCandidates,
  type PersonCandidate,
} from "../lib/people";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ListRow,
  MediaTile,
  Screen,
  Section,
  Sheet,
  Skeleton,
  confirmDialog,
} from "../ui";

const SENS_CHIPS: { label: string; value: number }[] = [
  { label: "Loose 0.5", value: 0.5 },
  { label: "Normal 0.6", value: 0.6 },
  { label: "Strict 0.75", value: 0.75 },
];

interface CandidateRow {
  media: MediaRow;
  sampleId: number;
  score: number;
}

interface PersonViewState {
  person: PersonFull;
  photos: MediaRow[];
  selecting: boolean;
  selected: Set<number>;
  candidates: CandidateRow[];
}

export function PeopleScreen({
  navigation,
  route,
}: {
  navigation: NativeStackNavigationProp<{
    Viewer: { ids: number[]; index: number };
    Corrections: undefined;
    PeopleSetup: undefined;
    Slideshow: { ids: number[]; index: number };
  }>;
  route?: { params?: { openPerson?: number } };
}) {
  const [people, setPeople] = useState<PersonFull[]>([]);
  const [listRows, setListRows] = useState<PeopleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<PersonViewState | null>(null);
  const [grouping, setGrouping] = useState(false);
  const [groupedNote, setGroupedNote] = useState<string | null>(null);
  const [merging, setMerging] = useState<PersonFull | null>(null);
  const [renaming, setRenaming] = useState<PersonFull | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      const full = await listPeopleFull();
      const rows = await listPeople();
      setPeople(full);
      setListRows(rows);
    } catch {
      setPeople([]);
      setListRows([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
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
    const cands = await listPersonCandidates(person.id, person.sensitivity).catch(
      () => [] as PersonCandidate[]
    );
    const candidateRows: CandidateRow[] = [];
    if (cands.length > 0) {
      const mediaRows = await getMediaByIds(cands.map((c) => c.mediaId)).catch(() => [] as MediaRow[]);
      const byId = new Map(mediaRows.map((m) => [m.id, m]));
      const bestPerMedia = new Map<number, PersonCandidate>();
      for (const c of cands) {
        const prev = bestPerMedia.get(c.mediaId);
        if (!prev || prev.score < c.score) bestPerMedia.set(c.mediaId, c);
      }
      for (const c of bestPerMedia.values()) {
        const media = byId.get(c.mediaId);
        if (media) candidateRows.push({ media, sampleId: c.sampleId, score: c.score });
      }
    }
    setView({
      person,
      photos: rows,
      selecting: false,
      selected: new Set(),
      candidates: candidateRows,
    });
  }, []);

  // v0.42: opened directly from a gallery-search person chip — auto-open the
  // matched person's photo view.
  const openPerson = route?.params?.openPerson;
  useEffect(() => {
    if (!openPerson) return;
    void (async () => {
      const full = await listPeopleFull().catch(() => [] as PersonFull[]);
      const match = full.find((p) => p.id === openPerson);
      if (match) await openTheirs(match);
    })();
  }, [openPerson, openTheirs]);

  const saveRename = useCallback(async () => {
    if (!renaming) return;
    const name = renameDraft.trim();
    await renamePerson(renaming.id, name.length > 0 ? name : null);
    setRenaming(null);
    void reload();
  }, [renaming, renameDraft, reload]);

  const confirmMerge = useCallback(
    (target: PersonFull, source: PersonFull) => {
      const count = listRows.find((r) => r.id === source.id)?.face_count ?? 0;
      const targetName = target.name ?? t("people.unnamed");
      const sourceName = source.name ?? t("people.unnamed");
      void confirmDialog({
        title: t("people.mergeTitle"),
        message: `Move all of “${sourceName}” (${count} face${count === 1 ? "" : "s"}) into “${targetName}”?\n\n“${targetName}” keeps its name.`,
        confirmLabel: t("people.mergeTitle"),
        destructive: true,
      }).then((ok) => {
        if (!ok) return;
        void mergePeople(target.id, source.id).then(() => {
          if (view?.person.id === source.id) setView(null);
          void reload();
        });
      });
    },
    [listRows, reload, view]
  );

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

  const doSplit = useCallback(
    (person: PersonFull, mediaIds: number[]) => {
      void confirmDialog({
        title: t("people.splitTitle"),
        message: `Move ${mediaIds.length} photo${mediaIds.length === 1 ? "" : "s"} out of “${person.name ?? t("people.unnamed")}”? They will not re-group with what stays (unless you merge later).`,
        confirmLabel: t("people.split"),
        destructive: true,
      }).then((ok) => {
        if (!ok) return;
        void (async () => {
          const samples: number[] = [];
          for (const mediaId of mediaIds) {
            samples.push(...(await listSampleIdsForMediaInPerson(mediaId, person.id)));
          }
          await splitOffFaces(samples, person.id);
          setView(null);
          void reload();
        })();
      });
    },
    [reload]
  );

  const doNotThisPerson = useCallback(
    (person: PersonFull, mediaId: number) => {
      void confirmDialog({
        title: t("people.notThisTitle"),
        message: `Remove this photo from “${person.name ?? t("people.unnamed")}” and stop suggesting them together?`,
        confirmLabel: "Yes, remove",
        destructive: true,
      }).then((ok) => {
        if (!ok) return;
        void (async () => {
          const samples = await listSampleIdsForMediaInPerson(mediaId, person.id);
          await dismissFacesFromPerson(samples, person.id);
          await openTheirs(person);
          void reload();
        })();
      });
    },
    [reload, openTheirs]
  );

  const setSensitivity = useCallback(
    (person: PersonFull, value: number | null) => {
      void setPersonSensitivity(person.id, value).then(() => reload());
    },
    [reload]
  );

  const attachCandidate = useCallback(
    (row: CandidateRow) => {
      const person = view?.person;
      if (!person) return;
      void (async () => {
        await assignFacesToPerson([row.sampleId], person.id);
        await openTheirs(person);
        void reload();
      })();
    },
    [view, reload, openTheirs]
  );

  const isChipOn = (sens: number | null, value: number) => Math.abs((sens ?? 0.6) - value) < 0.01;

  const goBack = useCallback(() => {
    if (view && view.selecting) setView({ ...view, selecting: false, selected: new Set() });
    else if (view) setView(null);
    else navigation.goBack();
  }, [view, navigation]);

  const title = view
    ? view.person.name ?? t("people.unnamed")
    : merging
      ? t("people.merging")
      : t("people.title");
  const subtitle = view
    ? tCount("people.photosWith", view.photos.length)
    : merging
      ? t("people.mergingHint")
      : t("people.subtitle");

  const navActions = useMemo(() => {
    if (view) {
      return (
        <>
          <IconButton
            icon="play"
            label={t("people.play")}
            disabled={view.photos.length < 2}
            onPress={() =>
              navigation.navigate("Slideshow", { ids: view.photos.map((r) => r.id), index: 0 })
            }
          />
          <IconButton
            icon="pencil-outline"
            label={t("people.rename")}
            onPress={() => {
              setRenameDraft(view.person.name ?? "");
              setRenaming(view.person);
            }}
          />
          <IconButton
            icon={view.selecting ? "close" : "checkmark-circle-outline"}
            label={view.selecting ? t("people.cancel") : t("people.select")}
            variant={view.selecting ? "tonal" : "plain"}
            onPress={() => setView({ ...view, selecting: !view.selecting, selected: new Set() })}
          />
        </>
      );
    }
    return (
      <>
        <IconButton
          icon="shield-checkmark-outline"
          label={t("people.review")}
          onPress={() => navigation.navigate("Corrections")}
        />
        <IconButton
          icon="sparkles-outline"
          label={grouping ? t("people.grouping") : t("people.group")}
          disabled={grouping}
          onPress={() => void groupFaces()}
        />
      </>
    );
  }, [view, grouping, navigation, groupFaces]);

  return (
    <Screen>
      <AppBar
        title={title}
        subtitle={subtitle}
        large
        onBack={goBack}
        backLabel={t("common.back")}
        actions={navActions}
      />

      {merging ? (
        <View style={styles.mergeBanner}>
          <Ionicons name="git-merge-outline" size={20} color={theme.colors.onAccentSoft} importantForAccessibility="no" />
          <AppText variant="callout" color={theme.colors.onAccentSoft} style={styles.flex}>
            {`Merging “${merging.name ?? t("people.unnamed")}” — tap the person these faces move into.`}
          </AppText>
          <Button label={t("common.cancel")} variant="quiet" size="sm" onPress={() => setMerging(null)} />
        </View>
      ) : null}

      {groupedNote && view === null && merging === null ? (
        <View style={styles.noteBanner}>
          <AppText variant="footnote" color={theme.colors.onSurfaceVariant} style={styles.flex}>
            {groupedNote}
          </AppText>
          <AppText
            variant="caption"
            color={theme.colors.accent}
            onPress={() => setGroupedNote(null)}
            accessibilityRole="button"
            accessibilityLabel={t("common.dismiss")}
            suppressHighlighting
          >
            {t("common.dismiss")}
          </AppText>
        </View>
      ) : null}

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the people index on this phone."
          retryLabel={t("common.retry")}
          onRetry={() => void reload()}
        />
      ) : loading ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton width={52} height={52} radius={theme.radius.control} />
              <View style={styles.flex}>
                <Skeleton width="45%" height={16} />
                <Skeleton width="30%" height={12} style={styles.skeletonGap} />
              </View>
            </View>
          ))}
          <AppText variant="captionRegular" color={theme.colors.onSurfaceVariant}>
            {t("people.loading")}
          </AppText>
        </View>
      ) : view !== null ? (
        <>
          {view.person.name !== null ? (
            <View style={styles.sensRow}>
              <AppText variant="caption" color={theme.colors.onSurfaceVariant}>
                {t("people.sensitivity")}
              </AppText>
              {SENS_CHIPS.map((chip) => (
                <Chip
                  key={chip.label}
                  label={chip.label}
                  selected={isChipOn(view.person.sensitivity, chip.value)}
                  onPress={() => setSensitivity(view.person, chip.value)}
                />
              ))}
            </View>
          ) : null}
          <FlashList
            data={view.photos}
            numColumns={3}
            keyExtractor={(r) => String(r.id)}
            extraData={view.selected}
            contentContainerStyle={{
              paddingBottom: view.selecting ? 96 : theme.spacing.xl,
            }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              view.candidates.length > 0 && !view.selecting ? (
                <View style={styles.candBlock}>
                  <AppText variant="caption" color={theme.colors.onSurfaceVariant}>
                    {tf("people.candidates", { name: view.person.name ?? t("people.unnamed") })}
                  </AppText>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.candStrip}
                  >
                    {view.candidates.map((c) => (
                      <Pressable
                        key={c.sampleId}
                        style={styles.candTile}
                        onPress={() => attachCandidate(c)}
                        accessibilityRole="button"
                        accessibilityLabel={`${tf("people.candidates", {
                          name: view.person.name ?? t("people.unnamed"),
                        })}, ${Math.round(c.score * 100)}% match`}
                      >
                        <Image
                          source={{ uri: c.media.thumb_uri }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          recyclingKey={`cand-${c.media.id}`}
                          transition={120}
                          accessible={false}
                        />
                        <View style={styles.candScore}>
                          <AppText variant="caption2" weight="semibold" color={theme.colors.onViewer}>
                            {Math.round(c.score * 100)}%
                          </AppText>
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              const selected = view.selected.has(item.id);
              return (
                <View style={styles.cell}>
                  <MediaTile
                    uri={item.thumb_uri}
                    aspectRatio={1}
                    selected={selected}
                    selectionMode={view.selecting}
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
                    accessibilityLabel={tf("gallery.tileLabel", {
                      date: new Date(item.taken_at).toLocaleDateString(),
                    })}
                    accessibilityHint={t("people.hint")}
                  />
                </View>
              );
            }}
            ListEmptyComponent={
              <EmptyState icon="person-outline" title={t("people.noPhotos")} compact />
            }
            ListFooterComponent={
              !view.selecting ? (
                <AppText
                  variant="caption"
                  color={theme.colors.onSurfaceFaint}
                  align="center"
                  style={styles.hintLine}
                >
                  {t("people.hint")}
                </AppText>
              ) : null
            }
          />
          {view.selecting ? (
            <View style={styles.selectBar}>
              <View style={styles.flex}>
                <AppText variant="caption" color={theme.colors.onSurfaceVariant} numberOfLines={2}>
                  {tf("people.selectHint", { count: view.selected.size })}
                </AppText>
              </View>
              <Button
                label={tf("people.splitCount", { count: view.selected.size })}
                variant="danger"
                size="sm"
                disabled={view.selected.size === 0}
                onPress={() => doSplit(view.person, [...view.selected])}
              />
            </View>
          ) : null}
        </>
      ) : listRows.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={t("people.empty.title")}
          body={t("people.empty.body")}
          actionLabel={t("people.empty.action")}
          onAction={() => navigation.navigate("PeopleSetup")}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <Section
            title={t("people.title")}
            icon="people-outline"
            footer={t("people.subtitle")}
          >
            {listRows.map((item) => {
              const full = people.find((p) => p.id === item.id) ?? null;
              return (
                <ListRow
                  key={item.id}
                  title={item.name ?? t("people.unnamed")}
                  subtitle={`${tCount("people.faces", item.face_count)} · ${t("people.tapToSee")}`}
                  leading={
                    item.cover ? (
                      <Image
                        source={{ uri: item.cover }}
                        style={styles.personThumb}
                        contentFit="cover"
                        recyclingKey={`ppl-${item.id}`}
                        accessible={false}
                      />
                    ) : (
                      <View style={[styles.personThumb, styles.personThumbEmpty]} />
                    )
                  }
                  accessory="chevron"
                  selected={merging?.id === item.id}
                  accessibilityHint={t("people.subtitle")}
                  onPress={() => full && onPersonRowPress(full)}
                  onLongPress={() => full && setMerging(full)}
                />
              );
            })}
          </Section>
        </ScrollView>
      )}

      <Sheet
        visible={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t("people.renameTitle")}
        subtitle={t("people.renameHint")}
        scroll
        footer={
          <>
            <Button label={t("common.cancel")} variant="quiet" onPress={() => setRenaming(null)} />
            <Button label={t("common.save")} onPress={() => void saveRename()} />
          </>
        }
      >
        <Input
          value={renameDraft}
          onChangeText={setRenameDraft}
          maxLength={60}
          autoFocus
          placeholder={t("people.renamePlaceholder")}
          accessibilityLabel={t("people.renameTitle")}
        />
        {renaming ? (
          <View style={styles.sensWrap}>
            <AppText variant="caption" color={theme.colors.onSurfaceVariant}>
              {t("people.sensitivity")}
            </AppText>
            <View style={styles.sensChips}>
              {SENS_CHIPS.map((chip) => (
                <Chip
                  key={chip.label}
                  label={chip.label}
                  selected={isChipOn(renaming.sensitivity, chip.value)}
                  onPress={() => {
                    void setPersonSensitivity(renaming.id, chip.value).then(() => {
                      setRenaming({ ...renaming, sensitivity: chip.value });
                    });
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  mergeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.compact,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.accentSoft,
  },
  noteBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.compact,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surfaceContainer,
  },
  sensRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    flexWrap: "wrap",
  },
  cell: { flex: 1, margin: 1 },
  candBlock: { gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  candStrip: { gap: theme.spacing.sm },
  candTile: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.control,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  candScore: {
    position: "absolute",
    bottom: theme.spacing.xs,
    right: theme.spacing.xs,
    backgroundColor: theme.colors.mediaScrimStrong,
    borderRadius: theme.radius.thumb,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 1,
  },
  hintLine: { paddingVertical: theme.spacing.lg },
  selectBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
    ...theme.elevation.floating,
  },
  listContent: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xl },
  personThumb: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surfaceHighest,
  },
  personThumbEmpty: { backgroundColor: theme.colors.surfaceHighest },
  skeletonList: { padding: theme.spacing.md, gap: theme.spacing.md },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.compact },
  skeletonGap: { marginTop: theme.spacing.xs },
  sensWrap: { gap: theme.spacing.xs, marginTop: theme.spacing.sm },
  sensChips: { flexDirection: "row", gap: theme.spacing.sm, flexWrap: "wrap" },
});
