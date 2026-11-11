import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import { AppBar, ListRow, Screen, Section } from "../ui";

type PlaceholderRow = {
  key: string;
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof ListRow>["icon"];
};

function buildRows(): PlaceholderRow[] {
  return [
    { key: "albums", label: t("collections.albums"), sub: t("collections.albumsSub"), icon: "albums-outline" },
    { key: "people", label: t("collections.people"), sub: t("collections.peopleSub"), icon: "people-outline" },
    { key: "archive", label: t("collections.archive"), sub: t("collections.archiveSub"), icon: "archive-outline" },
    { key: "trash", label: t("collections.trash"), sub: t("collections.trashSub"), icon: "trash-outline" },
    { key: "hidden", label: t("collections.hidden"), sub: t("collections.hiddenSub"), icon: "lock-closed-outline" },
  ];
}

export function CollectionsPlaceholderScreen() {
  return (
    <Screen>
      <AppBar title={t("collections.title")} large />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Section>
          {buildRows().map((s) => (
            <ListRow key={s.key} title={s.label} subtitle={s.sub} icon={s.icon} />
          ))}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
});
