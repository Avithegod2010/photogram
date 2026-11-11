import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listSavedSearches, type SavedSearchRow } from "../db/queries";
import { getDocOverview, type DocOverviewEntry } from "../lib/docAlbums";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  EmptyState,
  IconButton,
  Input,
  ListRow,
  Screen,
  Section,
  Skeleton,
} from "../ui";

type CollectionsNav = NativeStackNavigationProp<{
  Trash: undefined;
  Map: undefined;
  Albums: undefined;
  Archive: undefined;
  Hidden: undefined;
  SharedAlbums: undefined;
  SafetyCheck: undefined;
  Favorites: undefined;
  Wrapped: undefined;
  Journal: undefined;
  Highlights: undefined;
  Similar: { mode?: "similar" | "groups"; mediaId?: number };
  SavedSearch: { id: number };
  Scenes: undefined;
  PeopleSetup: undefined;
  DocAlbum: { key: "receipts" | "documents" };
  AlbumRules: undefined;
}>;

type CollectionRow = {
  key: string;
  label: string;
  sub: string;
  route:
    | "Trash"
    | "Map"
    | "Albums"
    | "Archive"
    | "Hidden"
    | "SharedAlbums"
    | "SafetyCheck"
    | "Favorites"
    | "Wrapped"
    | "Journal"
    | "Highlights"
    | "Similar"
    | "SavedSearch"
    | "Scenes"
    | "PeopleSetup"
    | "DocAlbum"
    | "AlbumRules";
};

/** The 14 destinations, grouped by what the owner is trying to do. */
function buildGroups(): Array<{
  key: string;
  title: string;
  icon: React.ComponentProps<typeof Section>["icon"];
  rows: CollectionRow[];
}> {
  const year = new Date().getFullYear();
  return [
      {
        key: "library",
        title: t("collections.group.library"),
        icon: "albums-outline",
        rows: [
          { key: "albums", label: t("collections.albums"), sub: t("collections.albumsSub"), route: "Albums" },
          { key: "shared", label: t("collections.shared"), sub: t("collections.sharedSub"), route: "SharedAlbums" },
          { key: "favorites", label: t("collections.favorites"), sub: t("collections.favoritesSub"), route: "Favorites" },
          { key: "map", label: t("collections.map"), sub: t("collections.mapSub"), route: "Map" },
        ],
      },
      {
        key: "organize",
        title: t("collections.group.organize"),
        icon: "sparkles-outline",
        rows: [
          { key: "scenes", label: t("collections.scenes"), sub: t("collections.scenesSub"), route: "Scenes" },
          { key: "people", label: t("collections.people"), sub: t("collections.peopleSub"), route: "PeopleSetup" },
          { key: "highlights", label: t("collections.highlights"), sub: t("collections.highlightsSub"), route: "Highlights" },
          { key: "journal", label: t("collections.journal"), sub: t("collections.journalSub"), route: "Journal" },
          {
            key: "wrapped",
            label: tf("collections.wrapped", { year }),
            sub: t("collections.wrappedSub"),
            route: "Wrapped",
          },
          { key: "duplicates", label: t("collections.duplicates"), sub: t("collections.duplicatesSub"), route: "Similar" },
        ],
      },
      {
        key: "privacy",
        title: t("collections.group.privacy"),
        icon: "lock-closed-outline",
        rows: [
          { key: "archive", label: t("collections.archive"), sub: t("collections.archiveSub"), route: "Archive" },
          { key: "hidden", label: t("collections.hidden"), sub: t("collections.hiddenSub"), route: "Hidden" },
          { key: "trash", label: t("collections.trash"), sub: t("collections.trashSub"), route: "Trash" },
        ],
      },
      {
        key: "advanced",
        title: t("collections.group.advanced"),
        icon: "construct-outline",
        rows: [
          { key: "safety", label: t("collections.safety"), sub: t("collections.safetySub"), route: "SafetyCheck" },
        ],
      },
    ];
}

export function CollectionsScreen({ navigation }: { navigation: CollectionsNav }) {
  // v0.27 Smart albums: saved searches refresh on every visit to this tab.
  const [saved, setSaved] = useState<SavedSearchRow[] | null>(null);
  const [savedError, setSavedError] = useState(false);
  // v0.39 Doc albums: receipt/document auto-groups found by scanning OCR text
  // captured in v0.23–v0.28 (receipts, certificates, ids).
  const [docs, setDocs] = useState<DocOverviewEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setSavedError(false);
    await Promise.all([
      listSavedSearches()
        .then(setSaved)
        .catch(() => {
          setSaved([]);
          setSavedError(true);
        }),
      getDocOverview()
        .then(setDocs)
        .catch(() => setDocs([])),
    ]);
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      void load();
    });
    return unsub;
  }, [navigation, load]);

  const groups = buildGroups();
  const q = search.trim().toLocaleLowerCase();

  const filteredGroups = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, rows: g.rows.filter((r) => !q || `${r.label} ${r.sub}`.toLocaleLowerCase().includes(q)) }))
        .filter((g) => g.rows.length > 0),
    [groups, q]
  );

  const filteredSaved = useMemo(
    () =>
      (saved ?? []).filter(
        (s) => !q || `${s.name} ${s.query ?? ""}`.toLocaleLowerCase().includes(q)
      ),
    [saved, q]
  );

  const filteredDocs = useMemo(
    () => (docs ?? []).filter((d) => d.count > 0 && (!q || d.def.label.toLocaleLowerCase().includes(q))),
    [docs, q]
  );

  const showSmartSection = !q || filteredSaved.length > 0 || t("collections.smartAlbums").toLocaleLowerCase().includes(q);
  const showDocsSection = filteredDocs.length > 0;
  const nothingMatches =
    q.length > 0 &&
    filteredGroups.length === 0 &&
    filteredSaved.length === 0 &&
    !showDocsSection &&
    !showSmartSection;

  return (
    <Screen>
      <AppBar
        title={t("collections.title")}
        large
        bottom={
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder={t("collections.searchPlaceholder")}
            icon="search"
            returnKeyType="search"
            accessibilityLabel={t("collections.searchPlaceholder")}
            trailing={
              search.length > 0 ? (
                <IconButton
                  icon="close-circle"
                  label={t("common.clear")}
                  size={40}
                  variant="plain"
                  onPress={() => setSearch("")}
                />
              ) : undefined
            }
          />
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
            progressBackgroundColor={theme.colors.surfaceContainer}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        {nothingMatches ? (
          <EmptyState
            compact
            icon="search-outline"
            title={tf("collections.noResults", { query: search.trim().slice(0, 40) + (search.trim().length > 40 ? "…" : "") })}
            actionLabel={t("common.clear")}
            onAction={() => setSearch("")}
          />
        ) : null}

        {filteredGroups
          .filter((g) => g.key === "library")
          .map((g) => (
            <Section key={g.key} title={g.title} icon={g.icon}>
              {g.rows.map((r) => (
                <ListRow
                  key={r.key}
                  title={r.label}
                  subtitle={r.sub}
                  accessory="chevron"
                  onPress={() => navigation.navigate(r.route as never)}
                />
              ))}
            </Section>
          ))}

        {showSmartSection ? (
          <Section
            title={t("collections.smartAlbums")}
            subtitle={t("collections.smartAlbumsSub")}
            icon="bookmark-outline"
            footer={
              saved !== null && filteredSaved.length === 0 && !q
                ? t("collections.smartAlbumsEmpty")
                : savedError
                  ? t("state.partial")
                  : undefined
            }
          >
            {saved === null ? (
              <View style={styles.skeletonRows}>
                <Skeleton height={16} width="55%" />
                <Skeleton height={12} width="80%" />
                <Skeleton height={16} width="45%" style={styles.skeletonGap} />
                <Skeleton height={12} width="70%" />
              </View>
            ) : (
              filteredSaved.map((s) => (
                <ListRow
                  key={s.id}
                  title={s.name}
                  subtitle={s.rules ? t("collections.smartAlbumsSub") : `“${s.query}”`}
                  accessory="chevron"
                  onPress={() => navigation.navigate("SavedSearch", { id: s.id })}
                />
              ))
            )}
            <ListRow
              title={t("collections.buildSmartAlbum")}
              subtitle={t("collections.buildSmartAlbumSub")}
              accessory="chevron"
              leading={
                <View style={styles.plusBox}>
                  <AppText variant="title3" color={theme.colors.accent}>
                    +
                  </AppText>
                </View>
              }
              onPress={() => navigation.navigate("AlbumRules")}
            />
          </Section>
        ) : null}

        {showDocsSection ? (
          <Section title={t("collections.documents")} subtitle={t("collections.documentsSub")} icon="document-text-outline">
            {filteredDocs.map((d) => (
              <ListRow
                key={d.def.key}
                title={d.def.label}
                subtitle={tCount("gallery.itemsCount", d.count)}
                accessory="chevron"
                onPress={() => navigation.navigate("DocAlbum", { key: d.def.key as "receipts" | "documents" })}
              />
            ))}
          </Section>
        ) : null}

        {filteredGroups
          .filter((g) => g.key !== "library")
          .map((g) => (
            <Section key={g.key} title={g.title} icon={g.icon}>
              {g.rows.map((r) => (
                <ListRow
                  key={r.key}
                  title={r.label}
                  subtitle={r.sub}
                  accessory="chevron"
                  onPress={() => navigation.navigate(r.route as never)}
                />
              ))}
            </Section>
          ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  skeletonRows: { padding: theme.spacing.md, gap: theme.spacing.sm },
  skeletonGap: { marginTop: theme.spacing.sm },
  plusBox: {
    width: theme.layout.icon,
    height: theme.layout.icon,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
