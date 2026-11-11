import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { saveSmartRules, type SavedRules } from "../db/queries";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  Input,
  Screen,
  Section,
  ToggleRow,
  alertDialog,
} from "../ui";

// v0.41 Smart-album rules v2 — a small builder for combined filters stored as
// JSON (schema v20): text, favorites, manual/app tags, taken_at range. The
// result is a smart album that re-runs the rules on every open, so it keeps
// up with the library exactly like the classic saved searches.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(raw: string): number | null {
  const m = raw.trim().match(DATE_RE);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt.getTime();
}

function previewLabel(rules: SavedRules): string {
  const parts: string[] = [];
  if (rules.favorites) parts.push("favorites");
  for (const tag of rules.tags) parts.push(`"${tag}"`);
  if (rules.fromMs) parts.push(`from ${new Date(rules.fromMs).toLocaleDateString()}`);
  if (rules.toMs) parts.push(`before ${new Date(rules.toMs).toLocaleDateString()}`);
  if (rules.text) parts.push(`text "${rules.text}"`);
  return parts.length > 0 ? parts.join(" + ") : "no filters yet";
}

export function AlbumRulesScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{
    Collections: undefined;
    SavedSearch: { id: number };
  }>;
}) {
  const [name, setName] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [tags, setTags] = useState("");
  const [text, setText] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = favorites || tags.trim() || text.trim() || fromDay.trim() || toDay.trim();

  const save = () => {
    if (!dirty) {
      void alertDialog({
        title: "Nothing to save",
        message: "Pick at least one filter for this album.",
      });
      return;
    }
    const tagList = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 6);
    const fromMs = fromDay.trim().length > 0 ? parseDay(fromDay) : undefined;
    const toMs = toDay.trim().length > 0 ? parseDay(toDay) : undefined;
    if (fromDay.trim().length > 0 && fromMs === undefined) {
      void alertDialog({ title: "Check the dates", message: '"From" must look like 2024-01-15.' });
      return;
    }
    if (toDay.trim().length > 0 && toMs === undefined) {
      void alertDialog({ title: "Check the dates", message: '"To" must look like 2025-06-30.' });
      return;
    }
    if (fromMs !== undefined && fromMs !== null && toMs !== undefined && toMs !== null && fromMs >= toMs) {
      void alertDialog({
        title: "Check the dates",
        message: '"From" must be earlier than "To".',
      });
      return;
    }
    if (saving) return;
    setSaving(true);
    void (async () => {
      const rules: SavedRules = {
        text: text.trim().length > 0 ? text.trim() : null,
        favorites,
        tags: tagList,
        fromMs: fromMs ?? null,
        toMs: toMs ?? null,
      };
      try {
        const id = await saveSmartRules(name, rules);
        navigation.replace("SavedSearch", { id });
      } catch {
        void alertDialog({
          title: "Could not save",
          message: "Writing the album rules failed. Try again.",
        });
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <Screen>
      <AppBar
        title="New smart album"
        subtitle="Rules stack: every filter must match"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Section title="Name" icon="bookmark-outline">
          <View style={styles.field}>
            <Input
              label="Album name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Beach favorites"
              maxLength={60}
              hint="Shown in Collections. Leave empty for “Smart album”."
            />
          </View>
        </Section>

        <Section title="Filters" icon="options-outline">
          <ToggleRow
            title="Favorites only"
            subtitle="Only photos you marked with a ♥"
            value={favorites}
            onValueChange={setFavorites}
          />
          <View style={styles.field}>
            <Input
              label="Tags (comma-separated, up to 6)"
              value={tags}
              onChangeText={setTags}
              placeholder="beach, family"
              autoCapitalize="none"
              hint="Matches photo tags, your tags and scene labels."
            />
          </View>
          <View style={styles.field}>
            <Input
              label="Photo text (optional)"
              value={text}
              onChangeText={setText}
              placeholder="receipt, Goa, mom — searches names, notes, scanned text"
              autoCapitalize="none"
            />
          </View>
          <View style={styles.dateRow}>
            <Input
              label="From"
              value={fromDay}
              onChangeText={setFromDay}
              placeholder="2024-01-15"
              autoCapitalize="none"
              keyboardType="number-pad"
              containerStyle={styles.flex}
            />
            <Input
              label="To"
              value={toDay}
              onChangeText={setToDay}
              placeholder="2025-06-30"
              autoCapitalize="none"
              keyboardType="number-pad"
              containerStyle={styles.flex}
            />
          </View>
        </Section>

        <Section title="Album shows" icon="search-outline">
          <View style={styles.previewWrap}>
            <AppText variant="body" color={theme.colors.onSurface}>
              {previewLabel({
                text: text.trim() || null,
                favorites,
                tags: tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0),
                fromMs: fromDay.trim() ? parseDay(fromDay) : null,
                toMs: toDay.trim() ? parseDay(toDay) : null,
              })}
            </AppText>
            <AppText variant="captionRegular" color={theme.colors.onSurfaceFaint} style={styles.previewHint}>
              Re-checked every time you open the album.
            </AppText>
          </View>
        </Section>

        <Button
          label={saving ? "Saving…" : "Create album"}
          icon="checkmark"
          fullWidth
          loading={saving}
          disabled={!dirty || saving}
          onPress={save}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  flex: { flex: 1, minWidth: 0 },
  field: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  dateRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  previewWrap: { padding: theme.spacing.md, gap: theme.spacing.xs },
  previewHint: { marginTop: 2 },
});
