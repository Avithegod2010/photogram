import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { backfillFaces } from "../lib/people";
import { countMediaMissingFaces, countFacesNeedingEmbedding, countPeople } from "../db/queries";
import { theme } from "../theme";

// v0.33+ People & Pets setup: pick + download a face model, toggle detection,
// process the EXISTING library (detect + embed — the scanner only covers rows
// it encounters), and open the grouped People screen.
export function PeopleSetupScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Tabs: undefined; People: undefined }>;
}) {
  const insets = useSafeAreaInsets();
  const peopleTagsEnabled = useSettingsStore((s) => s.peopleTagsEnabled);
  const setPeopleTagsEnabled = useSettingsStore((s) => s.setPeopleTagsEnabled);
  const faceModelId = useSettingsStore((s) => s.faceModelId);
  const setFaceModelId = useSettingsStore((s) => s.setFaceModelId);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [counts, setCounts] = useState({ missingFaces: 0, missingEmbeddings: 0, people: 0 });
  const cancelRef = useRef({ cancelled: false });

  const refresh = useCallback(async () => {
    const states: Record<string, boolean> = {};
    for (const model of FACE_MODELS) {
      states[model.id] = await isModelDownloaded(model.id);
    }
    setDownloaded(states);
    setCounts({
      missingFaces: await countMediaMissingFaces().catch(() => 0),
      missingEmbeddings: faceModelId
        ? await countFacesNeedingEmbedding(faceModelId).catch(() => 0)
        : 0,
      people: await countPeople().catch(() => 0),
    });
  }, [faceModelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const processLibrary = useCallback(async () => {
    if (processing) return;
    setProcessing(true);
    cancelRef.current = { cancelled: false };
    try {
      // backfillFaces caps each call; keep starting passes until both phases
      // report done (or the owner stops it) — the integrity-run pattern.
      for (;;) {
        const result = await backfillFaces((p) => setStatus(`Processed ${p.processed}…`), cancelRef.current);
        setStatus(
          result.detectDone && result.embedDone
            ? null
            : result.detectionReady
            ? `Part done (${result.processed} this run) — run again to continue.`
            : "Face detection needs the app rebuild — run again after updating."
        );
        if (result.detectDone && result.embedDone) break;
        if (cancelRef.current.cancelled) break;
        if (!result.detectionReady) break;
      }
    } finally {
      setProcessing(false);
      void refresh();
    }
  }, [processing, refresh]);

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

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Step 3 · Process your library</Text>
          <Text style={styles.sectionSub}>
            Detects faces and computes embeddings for photos already in your library — including
            everything uploaded before today. Resumable; safe to stop and re-run.
          </Text>
          <Text style={styles.statusLine}>
            {counts.missingFaces} photo{counts.missingFaces === 1 ? "" : "s"} left to detect ·{" "}
            {faceModelId ? `${counts.missingEmbeddings} faces to embed` : "no model chosen yet"} ·{" "}
            {counts.people} people grouped
          </Text>
          <View style={styles.modelActions}>
            <Pressable
              style={[styles.btn, processing && styles.btnDisabled]}
              disabled={processing}
              onPress={() => void processLibrary()}
            >
              <Text style={styles.btnText}>{processing ? "Processing…" : "Detect & embed"}</Text>
            </Pressable>
            {processing ? (
              <Pressable
                style={styles.btn}
                onPress={() => {
                  cancelRef.current.cancelled = true;
                }}
              >
                <Text style={styles.btnText}>Stop</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.btn, counts.people === 0 && styles.btnDisabled]}
              disabled={counts.people === 0}
              onPress={() => navigation.navigate("People")}
            >
              <Text style={styles.btnText}>View people ({counts.people})</Text>
            </Pressable>
          </View>
          {status ? <Text style={styles.footnote}>{status}</Text> : null}
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
  statusLine: {
    color: theme.colors.onSurface,
    fontSize: 12.5,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
});
