import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { runRulesSearch, saveSmartRules, type SavedRules } from "../db/queries";
import { theme } from "../theme";

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
  for (const t of rules.tags) parts.push(`"${t}"`);
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
  const insets = useSafeAreaInsets();
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
      Alert.alert("Nothing to save", "Pick at least one filter for this album.");
      return;
    }
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 6);
    const fromMs = fromDay.trim().length > 0 ? parseDay(fromDay) : undefined;
    const toMs = toDay.trim().length > 0 ? parseDay(toDay) : undefined;
    if (fromDay.trim().length > 0 && fromMs === undefined) {
      Alert.alert("Check the dates", '"From" must look like 2024-01-15.');
      return;
    }
    if (toDay.trim().length > 0 && toMs === undefined) {
      Alert.alert("Check the dates", '"To" must look like 2025-06-30.');
      return;
    }
    if (fromMs !== undefined && fromMs !== null && toMs !== undefined && toMs !== null && fromMs >= toMs) {
      Alert.alert("Check the dates", '"From" must be earlier than "To".');
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
        Alert.alert("Could not save", "Writing the album rules failed. Try again.");
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>New smart album</Text>
          <Text style={styles.sub}>Rules stack: every filter must match</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Album name</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Beach favorites"
            placeholderTextColor={theme.colors.outlineVariant}
            maxLength={60}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Favorites only</Text>
            <Text style={styles.fieldSub}>Only photos you marked with a ♥</Text>
          </View>
          <Switch value={favorites} onValueChange={setFavorites} thumbColor={theme.colors.primary} />
        </View>

        <Text style={styles.fieldLabel}>Tags (comma-separated, up to 6)</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={tags}
            onChangeText={setTags}
            placeholder="beach, family"
            placeholderTextColor={theme.colors.outlineVariant}
            autoCapitalize="none"
          />
        </View>
        <Text style={styles.hint}>Matches photo tags, your tags and scene labels.</Text>

        <Text style={styles.fieldLabel}>Photo text (optional)</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="receipt, Goa, mom — searches names, notes, scanned text"
            placeholderTextColor={theme.colors.outlineVariant}
            autoCapitalize="none"
          />
        </View>

        <Text style={styles.fieldLabel}>Date range (optional)</Text>
        <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <TextInput
              style={styles.input}
              value={fromDay}
              onChangeText={setFromDay}
              placeholder="From 2024-01-15"
              placeholderTextColor={theme.colors.outlineVariant}
              autoCapitalize="none"
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <TextInput
              style={styles.input}
              value={toDay}
              onChangeText={setToDay}
              placeholder="To 2025-06-30"
              placeholderTextColor={theme.colors.outlineVariant}
              autoCapitalize="none"
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>Album shows</Text>
          <Text style={styles.previewValue}>{previewLabel({
            text: text.trim() || null,
            favorites,
            tags: tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0),
            fromMs: fromDay.trim() ? parseDay(fromDay) : null,
            toMs: toDay.trim() ? parseDay(toDay) : null,
          })}</Text>
        </View>

        <Pressable style={[styles.saveBtn, !dirty && styles.btnDisabled]} onPress={save} disabled={!dirty || saving}>
          <Text style={styles.saveText}>{saving ? "Saving…" : "Create album"}</Text>
        </Pressable>
      </ScrollView>
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
  title: { color: theme.colors.onSurface, fontSize: 20, fontWeight: "700" },
  sub: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  content: { padding: theme.spacing.lg, paddingBottom: 60, gap: 8 },
  fieldLabel: { color: theme.colors.onSurface, fontSize: 14, fontWeight: "600" },
  fieldSub: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: 2 },
  hint: { color: theme.colors.onSurfaceVariant, fontSize: 11.5 },
  inputWrap: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.outlineVariant,
  },
  input: {
    color: theme.colors.onSurface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    fontSize: 14,
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 8 },
  previewCard: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  previewLabel: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, fontWeight: "700" },
  previewValue: { color: theme.colors.onSurface, fontSize: 13, marginTop: 4, lineHeight: 18 },
  saveBtn: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    alignItems: "center",
    paddingVertical: 13,
  },
  btnDisabled: { opacity: 0.45 },
  saveText: { color: theme.colors.onPrimary, fontWeight: "700", fontSize: 15 },
});
