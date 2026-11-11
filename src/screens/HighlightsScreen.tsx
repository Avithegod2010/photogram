import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { countMissingAnalysis } from "../db/queries";
import { HighlightMonth, getHighlights } from "../lib/highlights";
import { backfillAnalysis } from "../lib/similar";
import { theme } from "../theme";
import { t, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  EmptyState,
  ErrorState,
  MediaTile,
  Screen,
  Section,
  Skeleton,
} from "../ui";

// v0.33 "Highlights": the sharpest, non-soft shots of each month as
// auto-curated month cards. The analyzer is the Junk Sweeper's sharpness
// metric; the per-photo numbers are computed by the scanner and the one-time
// backfill (shared with "Find duplicates" — same pass, same progress).
export function HighlightsScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;
}) {
  const cancelRef = useRef({ cancelled: false });
  const [indexing, setIndexing] = useState<number | null>(null);
  const [months, setMonths] = useState<HighlightMonth[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    cancelRef.current = { cancelled: false };
    setMonths(null);
    setLoadError(false);
    void (async () => {
      try {
        if ((await countMissingAnalysis()) > 0) {
          setIndexing(0);
          await backfillAnalysis((done) => setIndexing(done), cancelRef.current);
        }
      } catch {}
      setIndexing(null);
      if (cancelRef.current.cancelled) return;
      try {
        setMonths(await getHighlights());
      } catch {
        setMonths([]);
        setLoadError(true);
      }
    })();
    return () => {
      cancelRef.current.cancelled = true;
    };
  }, [attempt]);

  const sub =
    indexing !== null
      ? `Indexing your photos… ${indexing} done so far`
      : months !== null
      ? `${months.length} month${months.length === 1 ? "" : "s"} with highlights`
      : "Finding your best shots…";

  return (
    <Screen>
      <AppBar
        title={t("collections.highlights")}
        subtitle={sub}
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      {loadError ? (
        <ErrorState
          title={t("state.error")}
          body="Photogram couldn't read the highlights on this phone."
          retryLabel={t("common.retry")}
          onRetry={() => setAttempt((a) => a + 1)}
        />
      ) : indexing !== null ? (
        <View style={styles.loadingWrap}>
          <AppText variant="body" color={theme.colors.onSurfaceVariant} align="center">
            Scoring your photos — this runs only once.
          </AppText>
          <Skeleton width="100%" height={96} radius={theme.radius.card} label={t("common.loading")} />
          <Skeleton width="100%" height={96} radius={theme.radius.card} />
          <Skeleton width="100%" height={96} radius={theme.radius.card} />
        </View>
      ) : months === null ? (
        <View style={styles.loadingWrap}>
          <AppText variant="body" color={theme.colors.onSurfaceVariant} align="center">
            Finding your best shots…
          </AppText>
          <Skeleton width="100%" height={96} radius={theme.radius.card} label={t("common.loading")} />
          <Skeleton width="100%" height={96} radius={theme.radius.card} />
        </View>
      ) : months.length === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title="No highlights yet"
          body="Keep taking photos — the sharpest shot of each month shows up here."
          actionLabel={t("common.back")}
          onAction={() => navigation.goBack()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {months.map((month) => (
            <Section key={month.ym} title={month.label} card={false} style={styles.month}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.row}
              >
                {month.items.map((r, i) => (
                  <View key={String(r.id)} style={styles.thumbWrap}>
                    <MediaTile
                      uri={r.thumb_uri}
                      aspectRatio={1}
                      onPress={() =>
                        navigation.navigate("Viewer", {
                          ids: month.items.map((x) => x.id),
                          index: i,
                        })
                      }
                      accessibilityLabel={tf("gallery.tileLabel", {
                        date: new Date(r.taken_at).toLocaleDateString(),
                      })}
                      accessibilityHint={t("viewer.tileHint")}
                    />
                  </View>
                ))}
              </ScrollView>
            </Section>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  month: { marginBottom: theme.spacing.md },
  row: { gap: theme.spacing.sm },
  thumbWrap: { width: 96 },
  loadingWrap: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
});
