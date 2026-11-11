import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSettingsStore } from "../store/settingsStore";
import {
  FACE_MODELS,
  type FaceModelDef,
  deleteModel,
  downloadModel,
  isModelDownloaded,
  validateModelUrl,
} from "../lib/faceModels";
import { backfillFaces } from "../lib/people";
import { countMediaMissingFaces, countFacesNeedingEmbedding, countPeople } from "../db/queries";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Badge,
  Button,
  PressableScale,
  ProgressBar,
  Screen,
  Section,
  Stat,
  ToggleRow,
  alertDialog,
} from "../ui";

// v0.33+ People & Pets setup: pick + download a face model, toggle detection,
// process the EXISTING library (detect + embed), and open the grouped People
// screen. All model work stays on this phone.
export function PeopleSetupScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Tabs: undefined; People: undefined }>;
}) {
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
        void alertDialog({ title: "Blocked", message: "This model URL failed the safety check." });
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
        void alertDialog({
          title: "Download failed",
          message: err instanceof Error ? err.message : "Unknown error.",
        });
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
    <Screen>
      <AppBar
        title="People & Pets"
        subtitle="Face grouping, entirely on this phone"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Section title="Step 1 · Detect faces" icon="scan-outline">
          <ToggleRow
            title="Find faces in photos"
            subtitle="Runs during scans on the thumbnails, on-device only. Also available in Settings → Search."
            value={peopleTagsEnabled}
            onValueChange={setPeopleTagsEnabled}
          />
        </Section>

        <Section
          title="Step 2 · Choose a face model"
          icon="cube-outline"
          subtitle="The model groups similar faces together. It is downloaded to this phone and never uploaded. Switching models later re-processes the library."
          footer="Face detection works without a model. With a model selected, Photogram also groups similar faces into people — all on this phone."
        >
          {FACE_MODELS.map((model) => {
            const isDownloaded = downloaded[model.id] ?? false;
            const fraction = progress[model.id];
            const isSelected = faceModelId === model.id;
            const busy = busyId === model.id;
            return (
              <View key={model.id} style={[styles.modelCard, isSelected && styles.modelCardSelected]}>
                <PressableScale
                  disabled={!isDownloaded || busyId !== null}
                  onPress={() => setFaceModelId(isSelected ? null : model.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${model.name}${model.recommended ? ", recommended" : ""}${
                    isSelected ? ", selected" : isDownloaded ? "" : ", not downloaded"
                  }`}
                  accessibilityState={{ selected: isSelected, disabled: !isDownloaded || busyId !== null }}
                  style={styles.modelHead}
                  contentStyle={styles.modelHeadContent}
                >
                  <View style={styles.flex}>
                    <View style={styles.modelTitleRow}>
                      <AppText variant="body" weight="semibold" style={styles.flex} numberOfLines={2}>
                        {model.name}
                      </AppText>
                      {model.recommended ? <Badge label="Recommended" tone="accent" /> : null}
                      {isSelected ? <Badge label="Selected" tone="success" icon="checkmark" /> : null}
                    </View>
                    <AppText variant="caption" color={theme.colors.onSurfaceVariant} style={styles.modelMeta}>
                      {model.sizeLabel} · {model.inputSize}×{model.inputSize} input · {model.embeddingDim}-d ·{" "}
                      {model.license}
                    </AppText>
                    <AppText variant="captionRegular" color={theme.colors.onSurfaceFaint} style={styles.modelNotes}>
                      {model.notes}
                    </AppText>
                  </View>
                </PressableScale>
                {fraction !== undefined && busy ? (
                  <ProgressBar
                    progress={fraction}
                    label={`Downloading ${model.name}`}
                    valueText={`${Math.round(fraction * 100)}%`}
                    live
                  />
                ) : null}
                <View style={styles.modelActions}>
                  {!isDownloaded ? (
                    <Button
                      label={busy ? "Downloading…" : `Download ${model.sizeLabel}`}
                      size="sm"
                      loading={busy}
                      disabled={busyId !== null}
                      onPress={() => void choose(model)}
                    />
                  ) : (
                    <Button
                      label="Remove model"
                      size="sm"
                      variant="secondary"
                      disabled={busyId !== null}
                      onPress={() => void remove(model)}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </Section>

        <Section title="Step 3 · Process your library" icon="layers-outline">
          <View style={styles.statRow}>
            <Stat value={(counts.missingFaces).toLocaleString()} label="left to detect" />
            <Stat
              value={faceModelId ? String(counts.missingEmbeddings) : "—"}
              label={faceModelId ? "faces to embed" : "no model chosen"}
            />
            <Stat value={(counts.people).toLocaleString()} label="people grouped" />
          </View>
          <AppText variant="footnote" color={theme.colors.onSurfaceVariant} style={styles.stepCopy}>
            Detects faces and computes embeddings for photos already in your library — including
            everything uploaded before today. Resumable; safe to stop and re-run.
          </AppText>
          <View style={styles.modelActions}>
            <Button
              label={processing ? "Processing…" : "Detect & embed"}
              icon="sparkles-outline"
              loading={processing}
              disabled={processing}
              onPress={() => void processLibrary()}
            />
            {processing ? (
              <Button
                label="Stop"
                variant="danger"
                onPress={() => {
                  cancelRef.current.cancelled = true;
                }}
              />
            ) : null}
            <Button
              label={`View people (${counts.people})`}
              variant="secondary"
              disabled={counts.people === 0}
              onPress={() => navigation.navigate("People")}
            />
          </View>
          {status ? (
            <AppText variant="caption" color={theme.colors.onSurfaceVariant} style={styles.statusLine}>
              {status}
            </AppText>
          ) : null}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xl },
  flex: { flex: 1, minWidth: 0 },
  modelCard: {
    margin: theme.spacing.compact,
    padding: theme.spacing.compact,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surfaceHighest,
    gap: theme.spacing.sm,
  },
  modelCardSelected: { backgroundColor: theme.colors.accentSoft },
  modelHead: { width: "100%" },
  modelHeadContent: { alignItems: "flex-start" },
  modelTitleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs, flexWrap: "wrap" },
  modelMeta: { marginTop: 2 },
  modelNotes: { marginTop: 2 },
  modelActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  statRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  stepCopy: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs },
  statusLine: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md },
});
