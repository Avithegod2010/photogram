import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { pageVisibleMedia, MediaRow } from "../db/queries";
import { runSearch } from "../lib/search";
import { scanDeviceLibrary, ScanProgress } from "../lib/scanner";
import { startWorker } from "../lib/uploader";
import { MemoriesCarousel } from "../components/MemoriesCarousel";
import { theme } from "../theme";

type StackNav = NativeStackNavigationProp<{ Viewer: { ids: number[]; index: number } }>;

export type ZoomLevel = "days" | "months" | "years";

const COLUMNS: Record<ZoomLevel, number> = { days: 4, months: 2, years: 1 };

interface GalleryDataItem extends MediaRow {
  __type: "media";
}

interface GalleryYearItem {
  __type: "year";
  year: number;
  count: number;
}

type GalleryItem = GalleryDataItem | GalleryYearItem;

function formatDayBadge(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function groupYears(rows: MediaRow[]): GalleryYearItem[] {
  const counts = new Map<number, number>();
  for (const r of rows) {
    const y = new Date(r.taken_at).getFullYear();
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, count]) => ({ __type: "year" as const, year, count }));
}

export function GalleryScreen() {
  const navigation = useNavigation<StackNav>();
  const insets = useSafeAreaInsets();
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("days");
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaRow[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanCancelRef = useRef({ cancelled: false });
  const cursorRef = useRef<number | null>(null);
  const exhaustedRef = useRef(false);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    try {
      const first = await pageVisibleMedia(null);
      setRows(first);
      cursorRef.current = first.length > 0 ? first[first.length - 1].taken_at : null;
      exhaustedRef.current = first.length < 120;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirstPage().then(() => startWorker());
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (exhaustedRef.current || loading) return;
    if (cursorRef.current === null) return;
    const more = await pageVisibleMedia(cursorRef.current);
    if (more.length === 0) {
      exhaustedRef.current = true;
      return;
    }
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...more.filter((r) => !seen.has(r.id))];
    });
    cursorRef.current = more[more.length - 1].taken_at;
    exhaustedRef.current = more.length < 120;
  }, [loading]);

  const data: GalleryItem[] = useMemo(() => {
    if (zoomLevel === "years") return groupYears(rows);
    const source = results ?? rows;
    return source.map((r) => ({ ...r, __type: "media" as const }));
  }, [rows, zoomLevel, results]);

  useEffect(() => {
    if (!searchOpen) {
      setResults(null);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length === 0) {
      setResults(null);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void runSearch(query.trim())
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, searchOpen]);

  const searching = searchOpen && query.trim().length > 0;

  const beginScan = useCallback(() => {
    scanCancelRef.current.cancelled = false;
    setScan({ scanned: 0, added: 0, duplicates: 0, failed: 0, total: null, done: false });
    void scanDeviceLibrary(setScan, scanCancelRef.current)
      .then(() => loadFirstPage())
      .catch((err) => setScan(null))
      .finally(() => {});
  }, [loadFirstPage]);

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onEnd((e) => {
      if (e.scale > 1.35) {
        setZoomLevel((z) => (z === "days" ? "months" : z === "months" ? "years" : z));
      } else if (e.scale < 0.75) {
        setZoomLevel((z) => (z === "years" ? "months" : z === "months" ? "days" : z));
      }
    });

  const renderItem = useCallback(
    ({ item }: { item: GalleryItem }) => {
      if (item.__type === "year") {
        return (
          <Pressable style={styles.yearCard}>
            <Text style={styles.yearText}>{item.year}</Text>
            <Text style={styles.yearCount}>{item.count} items</Text>
          </Pressable>
        );
      }
      const cols = COLUMNS[zoomLevel];
      const size = item.height && item.width ? item.height / item.width : 1;
      return (
        <Pressable
          onPress={() =>
            navigation.navigate("Viewer", {
              ids: rows.map((r) => r.id),
              index: rows.findIndex((r) => r.id === item.id),
            })
          }
          style={[styles.cell, { aspectRatio: zoomLevel === "months" ? Math.max(0.75, Math.min(1.5, 1 / size / 1.2)) : undefined }]}
        >
          <Image
            source={{ uri: item.thumb_uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`m-${item.id}`}
            transition={120}
          />
          {cols >= 4 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{formatDayBadge(item.taken_at)}</Text>
            </View>
          ) : null}
          {item.state !== "synced" ? <View style={[styles.stateDot, styles[`dot_${item.state}` as const]]} /> : null}
        </Pressable>
      );
    },
    [navigation, rows, zoomLevel]
  );

  const showEmptyState = !loading && data.length === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {searchOpen ? (
          <View style={styles.searchRow}>
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder='Search "screenshot", "June 2026", "last month"…'
              placeholderTextColor={theme.colors.onSurfaceVariant + "88"}
              style={styles.searchInput}
            />
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setQuery("");
              }}
              hitSlop={8}
            >
              <Text style={styles.searchCancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Gallery</Text>
            <View style={styles.headerRight}>
              <Pressable style={styles.searchBtn} onPress={() => setSearchOpen(true)} hitSlop={6}>
                <Text style={styles.searchBtnIcon}>⌕</Text>
              </Pressable>
              <View style={styles.segmented}>
                {(["days", "months", "years"] as ZoomLevel[]).map((z) => (
                  <Pressable
                    key={z}
                    onPress={() => setZoomLevel(z)}
                    style={[styles.segBtn, zoomLevel === z && styles.segActive]}
                  >
                    <Text style={[styles.segText, zoomLevel === z && styles.segTextActive]}>
                      {z[0].toUpperCase() + z.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}
      </View>

      {scan ? (
        <View style={styles.scanBanner}>
          {scan.done ? (
            <>
              <Text style={styles.scanText}>
                Scan complete · {scan.added} added · {scan.duplicates} duplicates skipped
              </Text>
              <Pressable onPress={() => setScan(null)}>
                <Text style={styles.scanDismiss}>Dismiss</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={theme.colors.primary} />
          )}
          {!scan.done && scan.total !== null ? (
            <Text style={styles.scanText}>
              Scanning… {scan.scanned}/{scan.total} · new {scan.added}
            </Text>
          ) : null}
        </View>
      ) : null}

      {showEmptyState ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No photos yet</Text>
          <Text style={styles.emptyBody}>
            Scan your device library to build your local index and start backing up.
          </Text>
          <Pressable style={styles.cta} onPress={beginScan}>
            <Text style={styles.ctaText}>Scan device library</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.loader} size="large" />
      ) : (
        <GestureDetector gesture={pinch}>
          <FlashList
            data={data}
            masonry
            numColumns={COLUMNS[zoomLevel]}
            renderItem={renderItem}
            keyExtractor={(it) => (it.__type === "year" ? `y${it.year}` : `m${it.id}`)}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.4}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            extraData={zoomLevel}
            ListHeaderComponent={
              !searching && zoomLevel === "days" ? (
                <MemoriesCarousel
                  onOpen={(ids) =>
                    navigation.navigate("Viewer", { ids, index: 0 })
                  }
                />
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={theme.colors.primary}
                onRefresh={() => {
                  setRefreshing(true);
                  void loadFirstPage().finally(() => setRefreshing(false));
                }}
              />
            }
          />
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  title: { color: theme.colors.onSurface, fontSize: 26, fontWeight: "700" },
  segmented: { flexDirection: "row", backgroundColor: theme.colors.surfaceContainer, borderRadius: theme.radius.full, padding: 3 },
  segBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: theme.radius.full },
  segActive: { backgroundColor: theme.colors.primaryContainer },
  segText: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, fontWeight: "600" },
  segTextActive: { color: theme.colors.onPrimaryContainer },
  headerRight: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  searchBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBtnIcon: { color: theme.colors.primary, fontSize: 20, fontWeight: "700", marginTop: -2 },
  searchRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  searchInput: {
    flex: 1,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.full,
    color: theme.colors.onSurface,
    fontSize: 14,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 9,
  },
  searchCancel: { color: theme.colors.primary, fontWeight: "600", fontSize: 13.5 },
  listContent: { paddingBottom: 96 },
  cell: {
    flex: 1,
    margin: 1,
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: 6,
    overflow: "hidden",
  },
  badge: {
    position: "absolute",
    left: 4,
    bottom: 4,
    backgroundColor: "#00000099",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  badgeText: { color: "#FFFFFF", fontSize: 9.5, fontWeight: "600" },
  stateDot: { position: "absolute", right: 5, top: 5, width: 8, height: 8, borderRadius: 4 },
  dot_local: { backgroundColor: "#9AA0A6" },
  dot_queued: { backgroundColor: "#FBBC05" },
  dot_uploading: { backgroundColor: "#FBBC05" },
  dot_failed: { backgroundColor: "#EA4335" },
  yearCard: {
    flex: 1,
    marginHorizontal: theme.spacing.md,
    marginVertical: 6,
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    paddingVertical: 26,
    alignItems: "center",
  },
  yearText: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  yearCount: { color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 4 },
  emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center", padding: theme.spacing.xl },
  emptyTitle: { color: theme.colors.onSurface, fontSize: 20, fontWeight: "700" },
  emptyBody: { color: theme.colors.onSurfaceVariant, fontSize: 14, textAlign: "center", lineHeight: 21, marginTop: theme.spacing.sm },
  cta: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingVertical: 12,
    paddingHorizontal: theme.spacing.xl,
  },
  ctaText: { color: theme.colors.onPrimary, fontWeight: "700" },
  loader: { flex: 1 },
  scanBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surfaceContainer,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
  },
  scanText: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, flex: 1 },
  scanDismiss: { color: theme.colors.primary, fontWeight: "600", fontSize: 13 },
});

