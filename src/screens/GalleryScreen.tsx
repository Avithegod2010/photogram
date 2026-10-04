import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { pageVisibleMedia, getRandomMedia, setMediaFavorite, setMediaVisibility, getTimelineRange, saveSearch, MediaRow } from "../db/queries";
import { getBackupHeartbeat, BackupHeartbeat } from "../lib/stats";
import { formatBytes } from "../lib/stats";
import { runSearch } from "../lib/search";
import { scanDeviceLibrary, ScanProgress } from "../lib/scanner";
import { enqueueForUpload, startWorker } from "../lib/uploader";
import { hasSavedMessagesMedia } from "../lib/rehydrate";
import { MemoriesCarousel } from "../components/MemoriesCarousel";
import { useSettingsStore } from "../store/settingsStore";
import { theme } from "../theme";

type StackNav = NativeStackNavigationProp<{
  Viewer: { ids: number[]; index: number };
  Story: { ids: number[]; title: string };
  Migrate: undefined;
}>;

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

interface GalleryDayHeaderItem {
  __type: "dayHeader";
  ts: number;
  label: string;
}

type GalleryItem = GalleryDataItem | GalleryYearItem | GalleryDayHeaderItem;

function formatDayBadge(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function daySectionLabel(ts: number): string {
  const d = new Date(ts);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (d >= startOfToday) return "Today";
  if (d >= startOfYesterday) return "Yesterday";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

function dayKeyOf(ts: number): number {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
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
  // F1: one-time "Restore your backup" banner on a fresh install — shown only
  // when the library is empty AND Saved Messages actually holds Photogram
  // uploads, then never again (MMKV-persisted flag).
  const [migrationBanner, setMigrationBanner] = useState(false);
  const migrationBannerShown = useSettingsStore((s) => s.migrationBannerShown);
  const setMigrationBannerShown = useSettingsStore((s) => s.setMigrationBannerShown);
  // Batch 3: the per-tile date badge only shows when this setting is on.
  const showDateOnPhotos = useSettingsStore((s) => s.showDateOnPhotos);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanCancelRef = useRef({ cancelled: false });
  const cursorRef = useRef<number | null>(null);
  const exhaustedRef = useRef(false);

  // v0.15 Timeline scrubber: true right after a jump so a "Top" chip can offer
  // the way back to now; any fresh loadFirstPage clears it.
  const [jumped, setJumped] = useState(false);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    try {
      // Master switch on → albums that opted into the timeline appear too.
      const master = useSettingsStore.getState().sharedTimelineMaster;
      const first = await pageVisibleMedia(null, 120, master);
      setRows(first);
      cursorRef.current = first.length > 0 ? first[first.length - 1].taken_at : null;
      exhaustedRef.current = first.length < 120;
      setJumped(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Scrubber jump: start the timeline AT a chosen month (same keyset paging,
  // seeded with the first ms of the month AFTER the target).
  const loadPageAt = useCallback(async (beforeTakenAt: number) => {
    setLoading(true);
    try {
      const master = useSettingsStore.getState().sharedTimelineMaster;
      const first = await pageVisibleMedia(beforeTakenAt, 120, master);
      setRows(first);
      cursorRef.current = first.length > 0 ? first[first.length - 1].taken_at : null;
      exhaustedRef.current = first.length < 120;
      setJumped(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirstPage().then(() => startWorker());
  }, [loadFirstPage]);

  // Probe the backup once per mount, only while the library is still empty.
  useEffect(() => {
    if (loading || rows.length > 0 || migrationBannerShown) return;
    let alive = true;
    void hasSavedMessagesMedia().then((hasBackup) => {
      if (alive && hasBackup) setMigrationBanner(true);
    });
    return () => {
      alive = false;
    };
  }, [loading, rows.length, migrationBannerShown]);

  const loadMore = useCallback(async () => {
    if (exhaustedRef.current || loading) return;
    if (cursorRef.current === null) return;
    const master = useSettingsStore.getState().sharedTimelineMaster;
    const more = await pageVisibleMedia(cursorRef.current, 120, master);
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

  const localOnlyCount = useMemo(
    () => rows.filter((r) => r.state === "local" || r.state === "failed").length,
    [rows]
  );

  // 🎲 Rediscover: jump straight into a random photo, full-screen.
  const rediscover = useCallback(async () => {
    const random = await getRandomMedia();
    if (!random) return;
    navigation.navigate("Viewer", { ids: [random.id], index: 0 });
  }, [navigation]);

  // v0.13 Favorites: per-tile heart (Days mode). Row data is the source of
  // truth so tiles survive scroll recycling; favTick bumps extraData so
  // FlashList re-renders the toggled tile.
  const [favTick, setFavTick] = useState(0);
  const toggleFavorite = useCallback(async (item: MediaRow) => {
    const fav = !item.is_favorite;
    try {
      await setMediaFavorite(item.id, fav);
    } catch {
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === item.id ? { ...r, is_favorite: fav ? 1 : 0 } : r)));
    setFavTick((t) => t + 1);
  }, []);

  // v0.14 Multi-select: long-press a tile to enter selection mode; taps toggle
  // ticks; the bottom bar bulk-applies Back up / Archive / Hide / Delete.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selTick, setSelTick] = useState(0);

  const enterSelection = useCallback((id: number) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
    setSelTick((t) => t + 1);
  }, []);

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelTick((t) => t + 1);
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setSelTick((t) => t + 1);
  }, []);

  // Hardware back leaves selection mode instead of leaving the gallery.
  useEffect(() => {
    if (!selectionMode) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      exitSelection();
      return true;
    });
    return () => sub.remove();
  }, [selectionMode, exitSelection]);

  const selectAllLoaded = useCallback(() => {
    setSelectedIds(new Set((results ?? rows).map((r) => r.id)));
    setSelTick((t) => t + 1);
  }, [rows, results]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds]
  );
  const backUpableCount = useMemo(
    () => selectedRows.filter((r) => r.state === "local" || r.state === "failed").length,
    [selectedRows]
  );

  const bulkBackUp = useCallback(() => {
    if (backUpableCount === 0) return;
    Alert.alert(
      "Back up to Telegram",
      `Queue ${backUpableCount} item${backUpableCount === 1 ? "" : "s"} for upload to Saved Messages?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Back up",
          onPress: () => {
            for (const r of selectedRows) {
              if (r.state === "local" || r.state === "failed") {
                void enqueueForUpload(r.id).catch(() => {});
              }
            }
            exitSelection();
          },
        },
      ]
    );
  }, [backUpableCount, selectedRows, exitSelection]);

  const bulkVisibility = useCallback(
    (vis: "archived" | "hidden") => {
      if (selectedRows.length === 0) return;
      const where = vis === "archived" ? "Collections → Archive" : "Collections → Hidden";
      Alert.alert(
        vis === "archived" ? "Archive items" : "Hide items",
        `Move ${selectedRows.length} item${selectedRows.length === 1 ? "" : "s"} out of the main timeline? Find them later in ${where}.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: vis === "archived" ? "Archive" : "Hide",
            onPress: () => {
              void (async () => {
                for (const r of selectedRows) {
                  try {
                    await setMediaVisibility(r.id, vis);
                  } catch {}
                }
                const gone = new Set(selectedRows.map((r) => r.id));
                setRows((prev) => prev.filter((r) => !gone.has(r.id)));
                exitSelection();
              })();
            },
          },
        ]
      );
    },
    [selectedRows, exitSelection]
  );

  const bulkDelete = useCallback(() => {
    if (selectedRows.length === 0) return;
    Alert.alert(
      "Move to Trash",
      `Move ${selectedRows.length} item${selectedRows.length === 1 ? "" : "s"} to Trash? They are deleted forever after 30 days.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to Trash",
          style: "destructive",
          onPress: () => {
            void (async () => {
              for (const r of selectedRows) {
                try {
                  await setMediaVisibility(r.id, "trashed");
                } catch {}
              }
              const gone = new Set(selectedRows.map((r) => r.id));
              setRows((prev) => prev.filter((r) => !gone.has(r.id)));
              exitSelection();
            })();
          },
        },
      ]
    );
  }, [selectedRows, exitSelection]);

  // v0.15 Timeline scrubber (Days mode): drag the right-edge rail, the bubble
  // shows the month under the finger, release jumps the grid there.
  const [timelineRange, setTimelineRange] = useState<{ min: number; max: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubY, setScrubY] = useState(0); // px within the rail
  const [railBox, setRailBox] = useState({ wrapH: 0, railH: 0 });
  const railYRef = useRef(0);

  useEffect(() => {
    void getTimelineRange().then(setTimelineRange).catch(() => setTimelineRange(null));
  }, [rows.length]);

  const fracOf = useCallback(
    (ts: number) => {
      if (!timelineRange) return 0;
      const f = (timelineRange.max - ts) / (timelineRange.max - timelineRange.min);
      return Math.max(0, Math.min(1, f));
    },
    [timelineRange]
  );

  const scrubMonthTs = useCallback(
    (y: number) => {
      if (!timelineRange || railBox.railH === 0) return null;
      const frac = Math.max(0, Math.min(1, y / railBox.railH));
      return timelineRange.max - frac * (timelineRange.max - timelineRange.min);
    },
    [timelineRange, railBox.railH]
  );

  const commitScrub = useCallback(() => {
    const ts = scrubMonthTs(railYRef.current);
    if (ts === null) return;
    // First ms of the month AFTER the target month = keyset bound that includes
    // the whole target month. A target in the newest month is just "top".
    const d = new Date(ts);
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    if (!timelineRange || nextMonth > timelineRange.max) {
      void loadFirstPage();
    } else {
      void loadPageAt(nextMonth);
    }
  }, [scrubMonthTs, timelineRange, loadFirstPage, loadPageAt]);

  const railGesture = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => {
      railYRef.current = e.y;
      setScrubY(e.y);
      setScrubbing(true);
    })
    .onUpdate((e) => {
      railYRef.current = e.y;
      setScrubY(e.y);
    })
    .onEnd(() => {
      setScrubbing(false);
      commitScrub();
    })
    .onFinalize(() => setScrubbing(false));

  // Backup heartbeat: refresh alongside the grid data.
  const [heartbeat, setHeartbeat] = useState<BackupHeartbeat | null>(null);
  useEffect(() => {
    void getBackupHeartbeat().then(setHeartbeat);
  }, [rows.length]);

  const backUpAll = useCallback(() => {
    const pending = rows.filter((r) => r.state === "local" || r.state === "failed");
    if (pending.length === 0) return;
    Alert.alert(
      "Back up to Telegram",
      `Queue ${pending.length} item${pending.length === 1 ? "" : "s"} for upload to Saved Messages?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Back up",
          onPress: () => {
            for (const item of pending) {
              void enqueueForUpload(item.id).catch(() => {});
            }
          },
        },
      ]
    );
  }, [rows]);

  const data: GalleryItem[] = useMemo(() => {
    if (zoomLevel === "years") return groupYears(rows);
    const source = results ?? rows;
    const items = source.map((r) => ({ ...r, __type: "media" as const }));
    // Days mode gets full-width date section headers (Today / Yesterday / date)
    // between day groups — skipped while searching so results stay dense.
    if (zoomLevel !== "days" || results) return items;
    const withHeaders: GalleryItem[] = [];
    let lastDay = -1;
    for (const item of items) {
      const key = dayKeyOf(item.taken_at);
      if (key !== lastDay) {
        withHeaders.push({ __type: "dayHeader", ts: item.taken_at, label: daySectionLabel(item.taken_at) });
        lastDay = key;
      }
      withHeaders.push(item);
    }
    return withHeaders;
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
    setScan({ scanned: 0, added: 0, duplicates: 0, failed: 0, failedNames: [], addedMediaIds: [], total: null, done: false });
    let warnedPartial = false;
    void scanDeviceLibrary((p) => {
      setScan(p);
      if (p.partialAccess && !warnedPartial) {
        warnedPartial = true;
        Alert.alert(
          "Partial photo access",
          "Android is only showing Photogram the items you picked manually, so some photos may be missing.\n\nTo allow everything: long-press the Photogram app icon → App info → Permissions → Photos and videos → Allow all."
        );
      }
    }, scanCancelRef.current)
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
      if (item.__type === "dayHeader") {
        return (
          <View style={styles.dayHeaderWrap}>
            <Text style={styles.dayHeaderText}>{item.label}</Text>
          </View>
        );
      }
      const cols = COLUMNS[zoomLevel];
      const size = item.height && item.width ? item.height / item.width : 1;
      // Days mode previously passed aspectRatio: undefined — with an absoluteFill
      // image every tile collapsed to zero height, so the grid looked empty.
      const aspect =
        zoomLevel === "days"
          ? Math.max(0.6, Math.min(1.8, 1 / size))
          : zoomLevel === "months"
            ? Math.max(0.75, Math.min(1.5, 1 / size / 1.2))
            : undefined;
      const isSelected = selectionMode && selectedIds.has(item.id);
      return (
        <Pressable
          onPress={() => {
            if (selectionMode) {
              toggleSelected(item.id);
              return;
            }
            // Search results page through the result set, not the full rows.
            const source = results ?? rows;
            navigation.navigate("Viewer", {
              ids: source.map((r) => r.id),
              index: source.findIndex((r) => r.id === item.id),
            });
          }}
          onLongPress={
            zoomLevel === "days" && !selectionMode && !results ? () => enterSelection(item.id) : undefined
          }
          style={[styles.cell, { aspectRatio: aspect }]}
        >
          <Image
            source={{ uri: item.thumb_uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`m-${item.id}`}
            transition={120}
          />
          {selectionMode ? (
            <View style={styles.tickWrap}>
              <Ionicons
                name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                size={17}
                style={isSelected ? styles.tickOn : styles.tickOff}
              />
            </View>
          ) : zoomLevel === "days" ? (
            <Pressable
              style={styles.favBtn}
              hitSlop={6}
              onPress={(e) => {
                e.stopPropagation();
                void toggleFavorite(item);
              }}
            >
              <Ionicons
                name={item.is_favorite ? "heart" : "heart-outline"}
                size={15}
                style={item.is_favorite ? styles.favIconOn : styles.favIconOff}
              />
            </Pressable>
          ) : null}
          {cols >= 4 && showDateOnPhotos ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{formatDayBadge(item.taken_at)}</Text>
            </View>
          ) : null}
          {item.state !== "synced" ? <View style={[styles.stateDot, styles[`dot_${item.state}` as const]]} /> : null}
        </Pressable>
      );
    },
    [navigation, rows, zoomLevel, showDateOnPhotos, toggleFavorite, selectionMode, selectedIds, toggleSelected, enterSelection, results]
  );

  const showEmptyState = !loading && data.length === 0;

  // Rail shows only for a real multi-month timeline in Days mode.
  const railVisible =
    zoomLevel === "days" &&
    !selectionMode &&
    !searching &&
    !showEmptyState &&
    rows.length > 0 &&
    timelineRange !== null &&
    timelineRange.max - timelineRange.min > 60 * 86400 * 1000;

  const railOffset = railBox.wrapH > railBox.railH ? (railBox.wrapH - railBox.railH) / 2 : 0;
  const clampY = (y: number) => Math.max(0, Math.min(railBox.railH, y));
  const handleTop =
    railOffset +
    (scrubbing
      ? clampY(scrubY)
      : rows.length > 0
        ? fracOf(rows[0].taken_at) * railBox.railH
        : 0) -
    11;
  const bubbleTop = Math.max(4, Math.min(Math.max(4, railBox.wrapH - 44), railOffset + clampY(scrubY) - 14));
  const bubbleTs = scrubMonthTs(scrubY);
  const bubbleLabel =
    bubbleTs !== null
      ? new Date(bubbleTs).toLocaleDateString(undefined, { month: "short", year: "numeric" })
      : "";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {selectionMode ? (
          <View style={styles.selHeader}>
            <Pressable onPress={exitSelection} hitSlop={8}>
              <Ionicons name="close" size={24} color={theme.colors.onSurface} />
            </Pressable>
            <Text style={styles.selCount}>
              {selectedIds.size} selected
              {results ? ` of ${results.length} results` : ""}
            </Text>
            <Pressable onPress={selectAllLoaded} hitSlop={8}>
              <Text style={styles.selAll}>Select all</Text>
            </Pressable>
          </View>
        ) : searchOpen ? (
          <View style={styles.searchRow}>
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder='Search "screenshot", "June 2026", "last month"…'
              placeholderTextColor={theme.colors.onSurfaceVariant + "88"}
              style={styles.searchInput}
            />
            {searching ? (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  const q = query.trim();
                  void saveSearch(q)
                    .then(() =>
                      Alert.alert(
                        "Search saved",
                        'Find it in Collections → "Smart albums" — it updates automatically.'
                      )
                    )
                    .catch(() => {});
                }}
              >
                <Text style={styles.searchCancel}>🔖</Text>
              </Pressable>
            ) : null}
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
              <Pressable style={styles.searchBtn} onPress={beginScan} hitSlop={6}>
                <Text style={styles.searchBtnIcon}>⟳</Text>
              </Pressable>
              {localOnlyCount > 0 ? (
                <Pressable style={styles.backupBtn} onPress={backUpAll} hitSlop={6}>
                  <Text style={styles.backupBtnText} numberOfLines={1}>
                    ▲ Back up {localOnlyCount}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                style={styles.searchBtn}
                onPress={() => void rediscover()}
                hitSlop={6}
              >
                <Text style={styles.searchBtnIcon}>🎲</Text>
              </Pressable>
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

      {heartbeat && heartbeat.total > 0 ? (
        <Text style={styles.heartbeat}>
          {heartbeat.synced >= heartbeat.total
            ? `🔒 All ${heartbeat.total} backed up${
                heartbeat.lastSyncedAt ? ` · ${timeAgo(heartbeat.lastSyncedAt)}` : ""
              }`
            : `🔒 ${heartbeat.synced}/${heartbeat.total} in Telegram${
                heartbeat.lastSyncedAt ? ` · last backup ${timeAgo(heartbeat.lastSyncedAt)}` : ""
              }`}
        </Text>
      ) : null}

      {scan ? (
        <View style={styles.scanBanner}>
          {scan.done ? (
            <>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => {
                  if (scan.failed === 0) return;
                  const names = scan.failedNames.map((n) => `• ${n}`).join("\n");
                  Alert.alert(
                    `${scan.failed} item${scan.failed === 1 ? "" : "s"} failed to index`,
                    `${names || "Unknown files"}\n\n${scan.lastError ?? "The files may be corrupt or unreadable."}\n\nThey were skipped and can be retried on the next scan.`
                  );
                }}
              >
                <Text style={styles.scanText} numberOfLines={2}>
                  Scan complete · {scan.added} added · {scan.duplicates} duplicates skipped
                  {scan.failed > 0 ? ` · ${scan.failed} failed (tap for details)` : ""}
                  {scan.failed === 0 && scan.lastError ? ` (${scan.lastError})` : ""}
                </Text>
              </Pressable>
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
          {scan.partialAccess ? (
            <Text style={styles.scanText}>
              ⚠ Only selected items visible — allow all photos in app settings
            </Text>
          ) : null}
        </View>
      ) : null}

      {showEmptyState ? (
        <View style={styles.emptyWrap}>
          {migrationBanner ? (
            <View style={styles.migrateBanner}>
              <Text style={styles.migrateTitle}>Restore your backup</Text>
              <Text style={styles.migrateBody}>
                We found your Photogram backup in Telegram on this phone — rebuild your library
                from it.
              </Text>
              <View style={styles.migrateActions}>
                <Pressable
                  style={styles.cta}
                  onPress={() => navigation.navigate("Migrate")}
                >
                  <Text style={styles.ctaText}>Restore</Text>
                </Pressable>
                <Pressable hitSlop={8} onPress={() => setMigrationBannerShown(true)}>
                  <Text style={styles.migrateDismiss}>Dismiss</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
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
        <View style={styles.listWrap}>
          <GestureDetector gesture={pinch}>
            <FlashList
              style={{ flex: 1 }}
              data={data}
              masonry
              numColumns={COLUMNS[zoomLevel]}
              renderItem={renderItem}
              keyExtractor={(it) =>
                it.__type === "year" ? `y${it.year}` : it.__type === "dayHeader" ? `d${it.ts}` : `m${it.id}`
              }
              getItemType={(it) => it.__type}
              overrideItemLayout={(layout, it) => {
                if (it.__type === "dayHeader") {
                  layout.span = COLUMNS[zoomLevel];
                }
              }}
              onEndReached={() => void loadMore()}
              onEndReachedThreshold={0.4}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              extraData={[zoomLevel, favTick, selectionMode, selTick]}
              ListHeaderComponent={
                !searching && zoomLevel === "days" ? (
                  <MemoriesCarousel
                    onOpen={(ids, title) =>
                      navigation.navigate("Story", { ids, title })
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
          {railVisible ? (
            <View
              style={styles.railWrap}
              pointerEvents="box-none"
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                setRailBox((b) => (b.wrapH === h ? b : { ...b, wrapH: h }));
              }}
            >
              <GestureDetector gesture={railGesture}>
                <View
                  style={styles.rail}
                  onLayout={(e) => {
                    const h = e.nativeEvent.layout.height;
                    setRailBox((b) => (b.railH === h ? b : { ...b, railH: h }));
                  }}
                >
                  <View style={styles.railTrack} />
                  <View style={[styles.railHandle, { top: handleTop }]} />
                </View>
              </GestureDetector>
              {scrubbing ? (
                <View style={[styles.scrubBubble, { top: bubbleTop }]}>
                  <Text style={styles.scrubBubbleText}>{bubbleLabel}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {jumped && !scrubbing ? (
            <Pressable style={styles.topChip} onPress={() => void loadFirstPage()} hitSlop={6}>
              <Text style={styles.topChipText}>⤒ Top</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {selectionMode ? (
        <View style={[styles.selBar, { paddingBottom: insets.bottom + 10 }]}>
          <Pressable
            style={[styles.selAction, backUpableCount === 0 && styles.selActionDisabled]}
            onPress={bulkBackUp}
            disabled={backUpableCount === 0}
          >
            <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.primary} />
            <Text style={styles.selActionLabel}>Back up</Text>
          </Pressable>
          <Pressable
            style={[styles.selAction, selectedRows.length === 0 && styles.selActionDisabled]}
            onPress={() => bulkVisibility("archived")}
            disabled={selectedRows.length === 0}
          >
            <Ionicons name="archive-outline" size={20} color={theme.colors.onSurface} />
            <Text style={styles.selActionLabel}>Archive</Text>
          </Pressable>
          <Pressable
            style={[styles.selAction, selectedRows.length === 0 && styles.selActionDisabled]}
            onPress={() => bulkVisibility("hidden")}
            disabled={selectedRows.length === 0}
          >
            <Ionicons name="eye-off-outline" size={20} color={theme.colors.onSurface} />
            <Text style={styles.selActionLabel}>Hide</Text>
          </Pressable>
          <Pressable
            style={[styles.selAction, selectedRows.length === 0 && styles.selActionDisabled]}
            onPress={bulkDelete}
            disabled={selectedRows.length === 0}
          >
            <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
            <Text style={[styles.selActionLabel, { color: theme.colors.error }]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
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
  backupBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: theme.colors.primaryContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  backupBtnText: { color: theme.colors.onPrimaryContainer, fontSize: 12.5, fontWeight: "700" },
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
  heartbeat: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 11.5,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
    marginTop: -4,
  },
  dayHeaderWrap: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  dayHeaderText: {
    color: theme.colors.onSurface,
    fontSize: 15,
    fontWeight: "700",
  },
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
  favBtn: { position: "absolute", left: 4, top: 4, padding: 3 },
  favIconOff: { color: "#FFFFFF", opacity: 0.55 },
  favIconOn: { color: "#EA4335", opacity: 1 },
  selHeader: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  selCount: { color: theme.colors.onSurface, fontSize: 16, fontWeight: "600", flex: 1 },
  selAll: { color: theme.colors.primary, fontWeight: "700", fontSize: 13.5 },
  selBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 10,
    backgroundColor: theme.colors.surfaceContainer,
    borderTopWidth: 1,
    borderTopColor: theme.colors.outlineVariant,
  },
  selAction: { alignItems: "center", gap: 3, paddingHorizontal: 12 },
  selActionDisabled: { opacity: 0.4 },
  selActionLabel: { color: theme.colors.onSurface, fontSize: 11, fontWeight: "600" },
  tickWrap: { position: "absolute", left: 4, top: 4 },
  tickOff: { color: "#FFFFFF" },
  tickOn: { color: theme.colors.primary },
  listWrap: { flex: 1 },
  railWrap: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  rail: { width: 26, height: "78%", alignItems: "center" },
  railTrack: { width: 4, flex: 1, borderRadius: 2, backgroundColor: theme.colors.surfaceContainer },
  railHandle: {
    position: "absolute",
    left: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.primaryContainer,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  scrubBubble: {
    position: "absolute",
    right: 38,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#000000CC",
  },
  scrubBubbleText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  topChip: {
    position: "absolute",
    top: 8,
    right: 44,
    backgroundColor: theme.colors.surfaceContainer,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  topChipText: { color: theme.colors.primary, fontSize: 12, fontWeight: "700" },
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
  migrateBanner: {
    width: "100%",
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
    alignItems: "center",
  },
  migrateTitle: { color: theme.colors.onSurface, fontSize: 18, fontWeight: "700" },
  migrateBody: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 13.5,
    textAlign: "center",
    lineHeight: 19,
    marginTop: theme.spacing.sm,
  },
  migrateActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing.lg, marginTop: theme.spacing.lg },
  migrateDismiss: { color: theme.colors.onSurfaceVariant, fontWeight: "600", fontSize: 13.5 },
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

