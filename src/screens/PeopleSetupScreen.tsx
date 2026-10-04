import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSettingsStore } from "../store/settingsStore";
import {
  FACE_MODELS,
  FaceModelDef,
  deleteModel,
  downloadModel,
  isModelDownloaded,
  validateModelUrl,
} from "../lib/faceModels";
import { theme } from "../theme";

// v0.33+ People & Pets step 1: pick and download a face-embedding model
// (nothing is bundled; downloads are https + host-allowlisted), plus the
// detection toggle. Grouping (clustering + naming) is the next batch and
// stays disabled until a model is downloaded.
export function PeopleSetupScreen({ navigation }: { navigation: NativeStackNavigationProp<{ Tabs: undefined }> }) {
  const insets = useSafeAreaInsets();
  const peopleTagsEnabled = useSettingsStore((s) => s.peopleTagsEnabled);
  const setPeopleTagsEnabled = useSettingsStore((s) => s.setPeopleTagsEnabled);
  const faceModelId = useSettingsStore((s) => s.faceModelId);
  const setFaceModelId = useSettingsStore((s) => s.setFaceModelId);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const states: Record<string, boolean> = {};
    for (const model of FACE_MODELS) {
      states[model.id] = await isModelDownloaded(model.id);
    }
    setDownloaded(states);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const choose = useCallback(
    async (model: FaceModelDef) => {
      if (!validateModelUrl(model.url)) {
        Alert.alert("Blocked", "This model URL failed the safety check.");
        return;
      }
      setBusyId(model.id);
      setProgress((p) => ({ ...p, [model.id]: 0 }));
      try {
        await downloadModel(model.id, model.url, (fraction) =>
          setProgress((p) => ({ ...p, [model.id]: fraction }))
        );
        setFaceModelId(model.id);
        await refresh();
      } catch (err) {
        Alert.alert("Download failed", err instanceof Error ? err.message : "Unknown error.");
      } finally {
        setBusyId(null);
      }
    },
    [refresh, setFaceModelId]
  );

  const remove = useCallback(
    async (model: FaceModelDef) => {
      await deleteModel(model.id);
      if (faceModelId === model.id) setFaceModelId(null);
      await refresh();
    },
    [faceModelId, refresh, setFaceModelId]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>People & Pets</Text>
          <Text style={styles.sub}>Face grouping, entirely on this phone</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Step 1 · Detect faces</Text>
          <Pressable
            style={styles.row}
            onPress={() => setPeopleTagsEnabled(!peopleTagsEnabled)}
            android_ripple={{ color: theme.colors.outlineVariant }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Find faces in photos</Text>
              <Text style={styles.rowSub}>
                Runs during scans on the thumbnails, on-device only. Also available in Settings →
                Search.
              </Text>
            </View>
            <Text style={[styles.stateText, peopleTagsEnabled && styles.stateOn]}>
              {peopleTagsEnabled ? "ON" : "OFF"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Step 2 · Choose a face model</Text>
          <Text style={styles.sectionSub}>
            The model groups similar faces together. It is downloaded to this phone and never
            uploaded. Switching models later re-processes the library.
          </Text>
          {FACE_MODELS.map((model) => {
            const isDownloaded = downloaded[model.id] ?? false;
            const fraction = progress[model.id];
            const isSelected = faceModelId === model.id;
            return (
              <View key={model.id} style={[styles.modelCard, isSelected && styles.modelCardSelected]}>
                <Pressable
                  disabled={!isDownloaded || busyId !== null}
                  onPress={() => setFaceModelId(isSelected ? null : model.id)}
                >
                  <View style={styles.modelHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modelName}>
                        {model.name}
                        {model.recommended ? " · recommended" : ""}
                      </Text>
                      <Text style={styles.modelMeta}>
                        {model.sizeLabel} · {model.inputSize}×{model.inputSize} input ·{" "}
                        {model.embeddingDim}-d · {model.license}
                      </Text>
                      <Text style={styles.modelNotes}>{model.notes}</Text>
                    </View>
                    {isSelected ? <Text style={styles.selectedText}>SELECTED</Text> : null}
                  </View>
                  {fraction !== undefined && busyId === model.id ? (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { flex: Math.max(0.02, fraction) }]} />
                    </View>
                  ) : null}
                  <View style={styles.modelActions}>
                    {!isDownloaded ? (
                      <Pressable
                        style={[styles.btn, busyId !== null && styles.btnDisabled]}
                        disabled={busyId !== null}
                        onPress={() => void choose(model)}
                      >
                        <Text style={styles.btnText}>
                          {busyId === model.id ? "Downloading…" : `Download ${model.sizeLabel}`}
                        </Text>
                      </Pressable>
                    ) : null}
                    {isDownloaded ? (
                      <Pressable
                        style={styles.btn}
                        disabled={busyId !== null}
                        onPress={() => void remove(model)}
                      >
                        <Text style={styles.btnText}>Remove</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>
              </View>
            );
          })}
          <Text style={styles.footnote}>
            Face detection works without a model. The model powers the grouping step, which
            arrives in the next update.
          </Text>
        </View>
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
  title: { color: theme.colors.onSurface, fontSize: 22, fontWeight: "700" },
  sub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  content: { paddingBottom: 40, paddingHorizontal: theme.spacing.lg },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "700" },
  sectionSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2, marginBottom: theme.spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 6 },
  rowLabel: { color: theme.colors.onSurface, fontSize: 14.5, fontWeight: "600" },
  rowSub: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  stateText: { color: theme.colors.onSurfaceVariant, fontSize: 13, fontWeight: "700" },
  stateOn: { color: theme.colors.primary },
  modelCard: {
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  modelCardSelected: { borderColor: theme.colors.primary, borderWidth: 2 },
  modelHead: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm },
  modelName: { color: theme.colors.onSurface, fontSize: 14.5, fontWeight: "700" },
  modelMeta: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  modelNotes: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  selectedText: { color: theme.colors.primary, fontSize: 11, fontWeight: "700" },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.surfaceHighest,
    overflow: "hidden",
    flexDirection: "row",
    marginTop: theme.spacing.sm,
  },
  progressFill: { backgroundColor: theme.colors.primary },
  modelActions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  btn: {
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: theme.colors.onPrimaryContainer, fontWeight: "700", fontSize: 12 },
  footnote: { color: theme.colors.onSurfaceVariant, fontSize: 11.5, marginTop: theme.spacing.sm },
});
