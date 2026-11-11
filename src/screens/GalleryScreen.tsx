import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  pageVisibleMedia,
  getRandomMedia,
  setMediaFavorite,
  setMediaVisibility,
  getTimelineRange,
  saveSearch,
  searchPeopleForQuery,
  updateMediaUserTags,
  type PersonHit,
  type MediaRow,
} from "../db/queries";
import { getBackupHeartbeat, type BackupHeartbeat } from "../lib/stats";
import { runSearch } from "../lib/search";
import { mergeTagList, normalizeUserTags } from "../lib/tags";
import { scanDeviceLibrary, type ScanProgress } from "../lib/scanner";
import { enqueueForUpload, startWorker } from "../lib/uploader";
import { hasSavedMessagesMedia } from "../lib/rehydrate";
import { MemoriesCarousel } from "../components/MemoriesCarousel";
import {
  collectOnboardingFacts,
  dismissOnboarding,
  isOnboardingDismissed,
  listPendingOnboardingSteps,
  shouldShowChecklist,
  type OnboardingStep,
} from "../lib/onboarding";
import { useSettingsStore } from "../store/settingsStore";
import { theme } from "../theme";
import { t, tCount, tf } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  GallerySkeleton,
  IconButton,
  Input,
  MediaTile,
  OfflineNotice,
  PressableScale,
  ProgressBar,
  Sheet,
  alertDialog,
  confirmDialog,
} from "../ui";
import { easing } from "../ui/motion";

type StackNav = NativeStackNavigationProp<{
  Viewer: { ids: number[]; index: number };
  Story: { ids: number[]; title: string };
  Migrate: undefined;
  People: { openPerson?: number };
  SafetyCheck: undefined;
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
  if (d >= startOfToday) return t("date.today");
  if (d >= startOfYesterday) return t("date.yesterday");
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
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return tf("time.minAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tf("time.hAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t("time.yesterday") : tf("time.dAgo", { count: days });
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
  const reduced = useReducedMotion();
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("days");
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queueNote, setQueueNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaRow[] | null>(null);
  const [peopleHits, setPeopleHits] = useState<PersonHit[]>([]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  // F1: one-time "Restore your backup" banner on a fresh install — shown only
  // when the library is empty AND Saved Messages actually holds Photogram
  // uploads, then never again (MMKV-persisted flag).
  const [migrationBanner, setMigrationBanner] = useState(false);
  const migrationBannerShown = useSettingsStore((s) => s.migrationBannerShown);
  const setMigrationBannerShown = useSettingsStore((s) => s.setMigrationBannerShown);
  // The per-tile date badge only shows when this setting is on.
  const showDateOnPhotos = useSettingsStore((s) => s.showDateOnPhotos);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanCancelRef = useRef({ cancelled: false });
  const cursorRef = useRef<number | null>(null);
  const exhaustedRef = useRef(false);

  // v0.15 Timeline scrubber: true right after a jump so a "Top" chip can offer
  // the way back to now; any fresh loadFirstPage clears it.
  const [jumped, setJumped] = useState(false);

  // Floating chrome: measured so the grid can start underneath it, hidden on
  // scroll down, restored on scroll up or when a modal state needs it.
  const [headerHeight, setHeaderHeight] = useState(insets.top + 92);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeRef = useRef(true);
  const chrome = useSharedValue(1);
  const scrollY = useRef(0);

  const setChrome = useCallback((visible: boolean) => {
    if (chromeRef.current === visible) return;
    chromeRef.current = visible;
    setChromeVisible(visible);
  }, []);

  useEffect(() => {
    chrome.set(
      reduced
        ? chromeVisible
          ? 1
          : 0
        : withTiming(chromeVisible ? 1 : 0, {
            duration: theme.motion.duration.base,
            easing: easing.standard,
          })
    );
  }, [chrome, chromeVisible, reduced]);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Master switch on → albums that opted into the timeline appear too.
      const master = useSettingsStore.getState().sharedTimelineMaster;
      const first = await pageVisibleMedia(null, 120, master);
      setRows(first);
      cursorRef.current = first.length > 0 ? first[first.length - 1].taken_at : null;
      exhaustedRef.current = first.length < 120;
      setJumped(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Scrubber jump: start the timeline AT a chosen month (same keyset paging,
  // seeded with the first ms of the month AFTER the target).
  const loadPageAt = useCallback(async (beforeTakenAt: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const master = useSettingsStore.getState().sharedTimelineMaster;
      const first = await pageVisibleMedia(beforeTakenAt, 120, master);
      setRows(first);
      cursorRef.current = first.length > 0 ? first[first.length - 1].taken_at : null;
      exhaustedRef.current = first.length < 120;
      setJumped(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
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

  // Feedback after queueing: the grid does not change until the worker starts,
  // so say what happened in the quiet status line.
  useEffect(() => {
    if (!queueNote) return;
    const timer = setTimeout(() => setQueueNote(null), 4200);
    return () => clearTimeout(timer);
  }, [queueNote]);

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
  // v0.55 bulk tagging dialog.
  const [tagOpen, setTagOpen] = useState(false);
  const [tagText, setTagText] = useState("");
  const [selTick, setSelTick] = useState(0);

  const enterSelection = useCallback((id: number) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
    setSelTick((t) => t + 1);
    setChrome(true);
  }, [setChrome]);

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
    void confirmDialog({
      title: t("gallery.backupTitle"),
      message: tf("gallery.backupQueue", { count: backUpableCount }),
      confirmLabel: t("gallery.backupAction"),
    }).then((ok) => {
      if (!ok) return;
      for (const r of selectedRows) {
        if (r.state === "local" || r.state === "failed") {
          void enqueueForUpload(r.id).catch(() => {});
        }
      }
      setQueueNote(tCount("gallery.queuedNote", backUpableCount));
      exitSelection();
    });
  }, [backUpableCount, selectedRows, exitSelection]);

  const bulkVisibility = useCallback(
    (vis: "archived" | "hidden") => {
      if (selectedRows.length === 0) return;
      const where = vis === "archived" ? `${t("collections.title")} → ${t("collections.archive")}` : `${t("collections.title")} → ${t("collections.hidden")}`;
      void confirmDialog({
        title: vis === "archived" ? t("gallery.archiveTitle") : t("gallery.hideTitle"),
        message: tf("gallery.moveOut", { count: selectedRows.length, where }),
        confirmLabel: vis === "archived" ? t("gallery.archiveAction") : t("gallery.hideAction"),
      }).then((ok) => {
        if (!ok) return;
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
      });
    },
    [selectedRows, exitSelection]
  );

  // v0.55 bulk tagging: add one comma-separated tag list to every selected row,
  // merging with whatever each photo already has (no duplicates).
  const applyBulkTag = useCallback(() => {
    const added = normalizeUserTags(tagText);
    const targets = selectedRows;
    if (!added || targets.length === 0) {
      setTagOpen(false);
      setTagText("");
      return;
    }
    void (async () => {
      try {
        for (const r of targets) {
          try {
            await updateMediaUserTags(r.id, mergeTagList(r.user_tags ?? null, added));
          } catch {}
        }
        const ids = new Set(targets.map((r) => r.id));
        setRows((prev) =>
          prev.map((r) =>
            ids.has(r.id) ? { ...r, user_tags: mergeTagList(r.user_tags ?? null, added) } : r
          )
        );
      } finally {
        setTagOpen(false);
        setTagText("");
        exitSelection();
      }
    })();
  }, [tagText, selectedRows, exitSelection]);

  const bulkFavorite = useCallback(() => {
    if (selectedRows.length === 0) return;
    const favCount = selectedRows.filter((r) => r.is_favorite === 1).length;
    void confirmDialog({
      title: t("gallery.favoriteTitle"),
      message: tf("gallery.favoriteBody", { count: selectedRows.length - favCount }),
      confirmLabel: t("gallery.favoriteAction"),
    }).then((ok) => {
      if (!ok) return;
      void (async () => {
        for (const r of selectedRows) {
          if (r.is_favorite !== 1) {
            try {
              await setMediaFavorite(r.id, true);
            } catch {}
          }
        }
        const ids = new Set(selectedRows.map((r) => r.id));
        setRows((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, is_favorite: 1 } : r)));
        exitSelection();
      })();
    });
  }, [selectedRows, exitSelection]);

  const bulkDelete = useCallback(() => {
    if (selectedRows.length === 0) return;
    void confirmDialog({
      title: t("gallery.trashTitle"),
      message: tf("gallery.trashBody", { count: selectedRows.length }),
      confirmLabel: t("gallery.trashAction"),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
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
    });
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

  // v0.47 first-run checklist: only while the owner has photos but NOTHING is
  // backed up yet — the three steps that actually gate a first backup.
  const [checklist, setChecklist] = useState<OnboardingStep[] | null>(null);
  useEffect(() => {
    if (!heartbeat || heartbeat.total === 0 || heartbeat.synced > 0) {
      setChecklist(null);
      return;
    }
    if (isOnboardingDismissed()) {
      setChecklist(null);
      return;
    }
    void collectOnboardingFacts(heartbeat.synced)
      .then((facts) => {
        const steps = listPendingOnboardingSteps(facts);
        setChecklist(shouldShowChecklist(steps, false) ? steps : null);
      })
      .catch(() => setChecklist(null));
  }, [heartbeat, rows.length]);

  const backUpAll = useCallback(() => {
    const pending = rows.filter((r) => r.state === "local" || r.state === "failed");
    if (pending.length === 0) return;
    void confirmDialog({
      title: t("gallery.backupTitle"),
      message: tf("gallery.backupQueue", { count: pending.length }),
      confirmLabel: t("gallery.backupAction"),
    }).then((ok) => {
      if (!ok) return;
      for (const item of pending) {
        void enqueueForUpload(item.id).catch(() => {});
      }
      setQueueNote(tCount("gallery.queuedNote", pending.length));
    });
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
      setPeopleHits([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length === 0) {
      setResults(null);
      setPeopleHits([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void runSearch(query.trim())
        .then(setResults)
        .catch(() => setResults([]));
      void searchPeopleForQuery(query.trim())
        .then(setPeopleHits)
        .catch(() => setPeopleHits([]));
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, searchOpen]);

  const searching = searchOpen && query.trim().length > 0;

  const showScanDetails = useCallback(() => {
    if (!scan) return;
    const names = scan.failedNames.map((n) => `• ${n}`).join("\n");
    void alertDialog({
      title: `${scan.failed} item${scan.failed === 1 ? "" : "s"} failed to index`,
      message: `${names || "Unknown files"}\n\n${scan.lastError ?? "The files may be corrupt or unreadable."}\n\nThey were skipped and can be retried on the next scan.`,
    });
  }, [scan]);

  const beginScan = useCallback(() => {
    scanCancelRef.current.cancelled = false;
    setScan({ scanned: 0, added: 0, duplicates: 0, failed: 0, failedNames: [], addedMediaIds: [], total: null, done: false });
    let warnedPartial = false;
    void scanDeviceLibrary((p) => {
      setScan(p);
      if (p.partialAccess && !warnedPartial) {
        warnedPartial = true;
        void alertDialog({
          title: t("gallery.partialAccessTitle"),
          message: t("gallery.partialAccessBody"),
        });
      }
    }, scanCancelRef.current)
      .then(() => loadFirstPage())
      .catch((err) => {
        setScan(null);
        void alertDialog({
          title: t("gallery.scanFailed"),
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, [loadFirstPage]);

  const pinch = Gesture.Pinch()    .runOnJS(true)
    .onEnd((e) => {
      if (e.scale > 1.35) {
        setZoomLevel((z) => (z === "days" ? "months" : z === "months" ? "years" : z));
      } else if (e.scale < 0.75) {
        setZoomLevel((z) => (z === "years" ? "months" : z === "months" ? "days" : z));
      }
    });

  const openStory = useCallback(
    (ids: number[], title: string) => navigation.navigate("Story", { ids, title }),
    [navigation]
  );

  const openViewer = useCallback(
    (item: MediaRow, source: MediaRow[]) => {
      if (selectionMode) {
        toggleSelected(item.id);
        return;
      }
      navigation.navigate("Viewer", {
        ids: source.map((r) => r.id),
        index: source.findIndex((r) => r.id === item.id),
      });
    },
    [navigation, selectionMode, toggleSelected]
  );

  const renderItem = useCallback(
    ({ item }: { item: GalleryItem }) => {
      if (item.__type === "year") {
        return (
          <View style={styles.yearRow}>
            <AppText variant="display" tabular>
              {item.year}
            </AppText>
            <AppText variant="callout" color={theme.colors.onSurfaceVariant}>
              {tCount("gallery.itemsCount", item.count)}
            </AppText>
          </View>
        );
      }
      if (item.__type === "dayHeader") {
        return (
          <View style={styles.dayHeaderWrap}>
            <AppText variant="callout" color={theme.colors.onSurfaceVariant}>
              {item.label}
            </AppText>
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
      const date = formatDayBadge(item.taken_at);
      const status = item.state === "synced" ? null : item.state;
      return (
        <View style={styles.cellWrap}>
          <MediaTile
            uri={item.thumb_uri}
            aspectRatio={aspect}
            selected={isSelected}
            selectionMode={selectionMode}
            favorite={item.is_favorite === 1}
            dateBadge={cols >= 4 && showDateOnPhotos ? date : null}
            status={status}
            onPress={() => openViewer(item, results ?? rows)}
            onLongPress={
              zoomLevel === "days" && !selectionMode && !results
                ? () => enterSelection(item.id)
                : undefined
            }
            onFavoritePress={item.is_favorite === 1 ? () => void toggleFavorite(item) : undefined}
            favoriteLabel={t("gallery.removeFavorite")}
            accessibilityLabel={
              tf("gallery.tileLabel", { date })
            }
            accessibilityHint={t("gallery.selectHint")}
          />
        </View>
      );
    },
    [
      rows,
      results,
      zoomLevel,
      showDateOnPhotos,
      selectionMode,
      selectedIds,
      enterSelection,
      openViewer,
      toggleFavorite,
    ]
  );

  const extraData = useMemo(
    () => ({ zoomLevel, favTick, selectionMode, selTick }),
    [zoomLevel, favTick, selectionMode, selTick]
  );

  const showEmptyState = !loading && !loadError && data.length === 0 && !searching;

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

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      if (selectionMode || searchOpen) {
        setChrome(true);
        scrollY.current = y;
        return;
      }
      const dy = y - scrollY.current;
      scrollY.current = y;
      if (y < 24) setChrome(true);
      else if (dy > 10 && y > headerHeight) setChrome(false);
      else if (dy < -8) setChrome(true);
    },
    [headerHeight, searchOpen, selectionMode, setChrome]
  );

  const headerStyle = useAnimatedStyle(() => ({
    opacity: chrome.get(),
    transform: [{ translateY: -(1 - chrome.get()) * headerHeight }],
  }));

  const openSearch = useCallback(() => {
    setOverflowOpen(false);
    setSearchOpen(true);
    setChrome(true);
  }, [setChrome]);

  const jumpMonths = useCallback(
    (delta: number) => {
      if (!timelineRange) return;
      if (delta > 0) {
        void loadFirstPage();
        return;
      }
      const top = rows[0]?.taken_at ?? timelineRange.max;
      const d = new Date(top);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      void loadPageAt(monthStart);
    },
    [timelineRange, rows, loadFirstPage, loadPageAt]
  );

  const heartbeatText = heartbeat
    ? heartbeat.synced >= heartbeat.total
      ? `${t("gallery.heartbeat.all")} · ${heartbeat.total.toLocaleString()}${
          heartbeat.lastSyncedAt ? ` · ${timeAgo(heartbeat.lastSyncedAt)}` : ""
        }`
      : `${heartbeat.synced.toLocaleString()}/${heartbeat.total.toLocaleString()} ${t("gallery.heartbeat.partial")}${
          heartbeat.lastSyncedAt ? ` · ${tf("gallery.lastBackup", { time: timeAgo(heartbeat.lastSyncedAt) })}` : ""
        }`
    : "";

  return (
    <View style={styles.root}>
      <Animated.View
        style={[styles.header, { paddingTop: insets.top }, headerStyle]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (Math.abs(h - headerHeight) > 1) setHeaderHeight(h);
        }}
        pointerEvents={chromeVisible || selectionMode || searchOpen ? "auto" : "none"}
      >
        {selectionMode ? (
          <View style={styles.searchRow}>
            <IconButton icon="close" label={t("common.close")} onPress={exitSelection} />
            <AppText variant="bodyLarge" weight="semibold" style={styles.flex} numberOfLines={1}>
              {tf("gallery.selected", { count: selectedIds.size })}
            </AppText>
            <Button label={t("common.selectAll")} variant="quiet" size="sm" onPress={selectAllLoaded} />
          </View>
        ) : searchOpen ? (
          <View style={styles.searchRow}>
            <Input
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={t("gallery.searchPlaceholder")}
              icon="search"
              containerStyle={styles.flex}
              returnKeyType="search"
              accessibilityLabel={t("common.search")}
            />
            {searching ? (
              <IconButton
                icon="bookmark-outline"
                label={t("gallery.saveSearch")}
                onPress={() => {
                  const q = query.trim();
                  void saveSearch(q)
                    .then(() =>
                      alertDialog({
                        title: t("gallery.searchSavedTitle"),
                        message: t("gallery.searchSavedBody"),
                      })
                    )
                    .catch(() => {});
                }}
              />
            ) : null}
            <Button
              label={t("common.cancel")}
              variant="quiet"
              size="sm"
              onPress={() => {
                setSearchOpen(false);
                setQuery("");
              }}
            />
          </View>
        ) : (
          <AppBar
            title={t("gallery.title")}
            large
            style={styles.transparentBar}
            actions={
              <>
                {localOnlyCount > 0 ? (
                  <Button
                    label={
                      localOnlyCount > 999
                        ? t("gallery.backupAction")
                        : tf("gallery.backupPill", { count: localOnlyCount })
                    }
                    accessibilityLabel={tf("gallery.backupPill", { count: localOnlyCount.toLocaleString() })}
                    icon="cloud-upload-outline"
                    size="sm"
                    onPress={backUpAll}
                    style={styles.backupPill}
                  />
                ) : null}
                <IconButton icon="search" label={t("common.search")} onPress={openSearch} />
                <IconButton
                  icon="ellipsis-horizontal"
                  label={t("common.more")}
                  onPress={() => setOverflowOpen(true)}
                />
              </>
            }
            bottom={
              queueNote ? (
                <View style={styles.heartbeatRow} accessibilityLiveRegion="polite">
                  <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} importantForAccessibility="no" />
                  <AppText variant="caption" color={theme.colors.success} numberOfLines={2} style={styles.flex}>
                    {queueNote}
                  </AppText>
                </View>
              ) : heartbeat && heartbeat.total > 0 ? (
                <Pressable
                  onPress={() => navigation.navigate("SafetyCheck")}
                  accessibilityRole="button"
                  accessibilityLabel={heartbeatText}
                  style={styles.heartbeatRow}
                >
                  <Ionicons
                    name={heartbeat.synced >= heartbeat.total ? "shield-checkmark" : "cloud-upload-outline"}
                    size={14}
                    importantForAccessibility="no"
                    color={
                      heartbeat.synced >= heartbeat.total
                        ? theme.colors.success
                        : theme.colors.onSurfaceVariant
                    }
                  />
                  <AppText
                    variant="caption"
                    color={theme.colors.onSurfaceVariant}
                    numberOfLines={2}
                    style={styles.flex}
                  >
                    {heartbeatText}
                  </AppText>
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.onSurfaceFaint} importantForAccessibility="no" />
                </Pressable>
              ) : null
            }
          />
        )}
        <OfflineNotice detail={t("state.offlineBackup")} />
      </Animated.View>

      {loadError ? (
        <View style={[styles.fill, { paddingTop: headerHeight }]}>
          <ErrorState
            title={t("gallery.loadError.title")}
            body={t("gallery.loadError.body")}
            retryLabel={t("common.retry")}
            onRetry={() => void loadFirstPage()}
          />
        </View>
      ) : showEmptyState ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: headerHeight, paddingBottom: theme.spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {scan ? (
            <ScanBanner scan={scan} onDismiss={() => setScan(null)} onDetails={showScanDetails} />
          ) : null}
          {migrationBanner ? (
            <View style={styles.bannerCard}>
              <AppText variant="title3">{t("gallery.migration.title")}</AppText>
              <AppText variant="body" color={theme.colors.onSurfaceVariant} style={styles.bannerBody}>
                {t("gallery.migration.body")}
              </AppText>
              <View style={styles.bannerActions}>
                <Button label={t("gallery.migration.restore")} onPress={() => navigation.navigate("Migrate")} />
                <Button
                  label={t("common.dismiss")}
                  variant="quiet"
                  onPress={() => setMigrationBannerShown(true)}
                />
              </View>
            </View>
          ) : null}
          <EmptyState
            icon="images-outline"
            title={t("gallery.empty.title")}
            body={t("gallery.empty.body")}
            actionLabel={t("gallery.scan")}
            onAction={beginScan}
          />
        </ScrollView>
      ) : loading ? (
        <View style={{ paddingTop: headerHeight }}>
          <GallerySkeleton label={t("gallery.loading")} />
        </View>
      ) : (
        <View style={styles.listWrap}>
          <GestureDetector gesture={pinch}>
            <FlashList
              style={styles.fill}
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
              contentContainerStyle={{
                paddingTop: headerHeight,
                paddingBottom: selectionMode ? 88 : theme.spacing.xl,
              }}
              extraData={extraData}
              onScroll={onScroll}
              scrollEventThrottle={16}
              ListHeaderComponent={
                <>
                  {scan ? (
                    <ScanBanner
                      scan={scan}
                      onDismiss={() => setScan(null)}
                      onDetails={showScanDetails}
                    />
                  ) : null}
                  {checklist && rows.length > 0 ? (
                    <View style={styles.checklistCard}>
                      <AppText variant="title3">{t("gallery.firstRun.title")}</AppText>
                      {checklist.map((s) => (
                        <View key={s.key} style={styles.checkRow}>
                          <Ionicons
                            name={s.done ? "checkmark-circle" : "ellipse-outline"}
                            size={18}
                            color={s.done ? theme.colors.success : theme.colors.onSurfaceFaint}
                            importantForAccessibility="no"
                          />
                          <AppText variant="footnote" numberOfLines={2} style={styles.flex}>
                            {s.title}
                          </AppText>
                        </View>
                      ))}
                      <View style={styles.checkActions}>
                        <Button label={t("gallery.firstRun.backupNow")} size="sm" onPress={backUpAll} />
                        <Button
                          label={t("common.dismiss")}
                          variant="quiet"
                          size="sm"
                          onPress={() => {
                            dismissOnboarding();
                            setChecklist(null);
                          }}
                        />
                      </View>
                    </View>
                  ) : null}
                  {searching && peopleHits.length > 0 ? (
                    <View style={styles.peopleStrip}>
                      <AppText variant="caption" weight="semibold" color={theme.colors.onSurfaceVariant}>
                        {t("gallery.people")}
                      </AppText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRow}>
                        {peopleHits.map((p) => (
                          <Chip
                            key={p.id}
                            label={`${p.name} · ${p.faceCount}`}
                            icon="person-outline"
                            onPress={() => navigation.navigate("People", { openPerson: p.id })}
                            accessibilityLabel={`${p.name}, ${p.faceCount} faces`}
                          />
                        ))}
                      </ScrollView>
                    </View>
                  ) : !searching && zoomLevel === "days" ? (
                    <MemoriesCarousel onOpen={openStory} />
                  ) : null}
                </>
              }
              ListEmptyComponent={
                searching ? (
                  <EmptyState
                    compact
                    icon="search-outline"
                    title={t("gallery.searchEmpty.title")}
                    body={t("gallery.searchEmpty.body")}
                    actionLabel={t("common.clear")}
                    onAction={() => setQuery("")}
                  />
                ) : null
              }
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  tintColor={theme.colors.accent}
                  colors={[theme.colors.accent]}
                  progressBackgroundColor={theme.colors.surfaceContainer}
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
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={t("gallery.scrubber")}
                  accessibilityHint={t("gallery.scrubberHint")}
                  accessibilityValue={{
                    text: rows[0]?.taken_at
                      ? new Date(rows[0].taken_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })
                      : undefined,
                  }}
                  accessibilityActions={[
                    { name: "increment", label: t("gallery.newerMonth") },
                    { name: "decrement", label: t("gallery.olderMonth") },
                  ]}
                  onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === "increment") jumpMonths(1);
                    if (e.nativeEvent.actionName === "decrement") jumpMonths(-1);
                  }}
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
                  <AppText variant="callout" weight="semibold" color={theme.colors.onViewer}>
                    {bubbleLabel}
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : null}
          {jumped && !scrubbing ? (
            <Button
              label={t("gallery.top")}
              icon="arrow-up"
              size="sm"
              variant="secondary"
              onPress={() => void loadFirstPage()}
              style={styles.topChip}
            />
          ) : null}
        </View>
      )}

      {selectionMode ? (
        <View style={[styles.selBar, { paddingBottom: insets.bottom + theme.spacing.sm }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selBarContent}
          >
            <SelectionAction
              icon="cloud-upload-outline"
              label={t("viewer.backup")}
              onPress={bulkBackUp}
              disabled={backUpableCount === 0}
              tone="accent"
            />
            <SelectionAction
              icon="heart-outline"
              label={t("viewer.favorite")}
              onPress={bulkFavorite}
              disabled={selectedRows.length === 0}
            />
            <SelectionAction
              icon="archive-outline"
              label={t("viewer.archive")}
              onPress={() => bulkVisibility("archived")}
              disabled={selectedRows.length === 0}
            />
            <SelectionAction
              icon="pricetag-outline"
              label={t("gallery.tag")}
              onPress={() => setTagOpen(true)}
              disabled={selectedRows.length === 0}
            />
            <SelectionAction
              icon="eye-off-outline"
              label={t("viewer.hide")}
              onPress={() => bulkVisibility("hidden")}
              disabled={selectedRows.length === 0}
            />
            <SelectionAction
              icon="trash-outline"
              label={t("common.delete")}
              onPress={bulkDelete}
              disabled={selectedRows.length === 0}
              tone="danger"
            />
          </ScrollView>
        </View>
      ) : null}

      <Sheet
        visible={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        title={t("common.more")}
        scroll
      >
        <View style={styles.sheetSection}>
          <AppText variant="callout" color={theme.colors.onSurfaceVariant}>
            {t("gallery.zoom")}
          </AppText>
          <View style={styles.sheetChips}>
            {(
              [
                { value: "days" as const, label: t("gallery.zoom.days") },
                { value: "months" as const, label: t("gallery.zoom.months") },
                { value: "years" as const, label: t("gallery.zoom.years") },
              ]
            ).map((z) => (
              <Chip
                key={z.value}
                label={z.label}
                selected={zoomLevel === z.value}
                onPress={() => {
                  setZoomLevel(z.value);
                  setOverflowOpen(false);
                }}
              />
            ))}
          </View>
        </View>
        <SheetAction
          icon="shuffle-outline"
          label={t("gallery.random")}
          onPress={() => {
            setOverflowOpen(false);
            void rediscover();
          }}
        />
        <SheetAction
          icon="scan-outline"
          label={t("gallery.rescan")}
          onPress={() => {
            setOverflowOpen(false);
            beginScan();
          }}
        />
        <SheetAction
          icon="shield-checkmark-outline"
          label={t("collections.safety")}
          onPress={() => {
            setOverflowOpen(false);
            navigation.navigate("SafetyCheck");
          }}
        />
      </Sheet>

      <Sheet
        visible={tagOpen}
        onClose={() => setTagOpen(false)}
        title={tf("gallery.tagTitle", { count: selectedRows.length })}
        subtitle={t("gallery.tagHint")}
        scroll
        footer={
          <>
            <Button label={t("common.cancel")} variant="quiet" onPress={() => setTagOpen(false)} />
            <Button label={t("common.save")} onPress={applyBulkTag} disabled={normalizeUserTags(tagText) === null} />
          </>
        }
      >
        <Input
          value={tagText}
          onChangeText={setTagText}
          placeholder={t("gallery.tagPlaceholder")}
          autoFocus
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={applyBulkTag}
          accessibilityLabel={t("gallery.tag")}
        />
      </Sheet>
    </View>
  );
}

function ScanBanner({
  scan,
  onDismiss,
  onDetails,
}: {
  scan: ScanProgress;
  onDismiss: () => void;
  onDetails: () => void;
}) {
  const progress = scan.total && scan.total > 0 ? scan.scanned / scan.total : 0.06;
  return (
    <View style={styles.scanBanner} accessibilityLiveRegion="polite">
      <View style={styles.scanHead}>
        <Ionicons
          name={scan.done ? "checkmark-circle-outline" : "cloud-download-outline"}
          size={18}
          color={scan.done ? theme.colors.success : theme.colors.accent}
          importantForAccessibility="no"
        />
        <AppText variant="body" weight="semibold" style={styles.flex}>
          {scan.done ? "Scan complete" : "Scanning device library…"}
        </AppText>
      </View>
      {!scan.done ? (
        <ProgressBar
          progress={progress}
          label="Scanning device library"
          valueText={scan.total ? `${scan.scanned} / ${scan.total}` : undefined}
          live
        />
      ) : (
        <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
          {scan.added} added · {scan.duplicates} duplicates skipped
          {scan.failed > 0 ? ` · ${scan.failed} failed` : ""}
        </AppText>
      )}
      {scan.partialAccess && !scan.done ? (
        <AppText variant="caption" color={theme.colors.warning}>
          {t("gallery.partialAccess")}
        </AppText>
      ) : null}
      <View style={styles.scanActions}>
        {scan.done && scan.failed > 0 ? (
          <Button label="Details" variant="quiet" size="sm" onPress={onDetails} />
        ) : null}
        <Button
          label={t("common.dismiss")}
          variant="quiet"
          size="sm"
          onPress={onDismiss}
        />
      </View>
    </View>
  );
}

function SelectionAction({
  icon,
  label,
  onPress,
  disabled,
  tone = "default",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "accent" | "danger";
}) {
  const color =
    tone === "danger"
      ? theme.colors.error
      : tone === "accent"
        ? theme.colors.accent
        : theme.colors.onSurface;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.selAction, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={22} color={color} importantForAccessibility="no" />
      <AppText variant="caption2" weight="medium" color={color} numberOfLines={1}>
        {label}
      </AppText>
    </PressableScale>
  );
}

function SheetAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: theme.colors.surfaceHover }}
      style={({ pressed }) => [styles.sheetAction, pressed && { backgroundColor: theme.colors.surfaceHover }]}
    >
      <Ionicons name={icon} size={22} color={theme.colors.onSurfaceVariant} importantForAccessibility="no" />
      <AppText variant="body" weight="medium" style={styles.flex}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: theme.colors.overlay,
    paddingBottom: theme.spacing.sm,
  },
  transparentBar: { backgroundColor: "transparent" },
  backupPill: { marginRight: theme.spacing.xs },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
    minHeight: theme.layout.appBar,
  },
  heartbeatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    minHeight: 28,
  },
  cellWrap: { flex: 1, margin: 1 },
  dayHeaderWrap: { paddingHorizontal: theme.spacing.xs, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.sm },
  yearRow: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  listWrap: { flex: 1 },
  peopleStrip: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  peopleRow: { gap: theme.spacing.sm, paddingRight: theme.spacing.md },
  bannerCard: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surfaceContainer,
    gap: theme.spacing.sm,
  },
  bannerBody: { marginTop: -theme.spacing.xs },
  bannerActions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.xs, flexWrap: "wrap" },
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
    backgroundColor: theme.colors.accent,
  },
  scrubBubble: {
    position: "absolute",
    right: 38,
    paddingHorizontal: theme.spacing.compact,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.mediaScrimStrong,
  },
  topChip: {
    position: "absolute",
    top: theme.spacing.sm,
    right: 44,
    ...theme.elevation.floating,
  },
  selBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
    ...theme.elevation.floating,
  },
  selBarContent: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    gap: theme.spacing.xs,
  },
  selAction: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minWidth: theme.layout.touch,
    minHeight: theme.layout.touch,
    paddingHorizontal: theme.spacing.xs,
  },
  disabled: { opacity: 0.4 },
  sheetSection: { gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  sheetChips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  scanBanner: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.compact,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surfaceContainer,
    gap: theme.spacing.xs,
  },
  scanHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  scanActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing.sm },
  checklistCard: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surfaceContainer,
    gap: theme.spacing.sm,
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  checkActions: { flexDirection: "row", gap: theme.spacing.sm, flexWrap: "wrap" },
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.compact,
    minHeight: theme.layout.touch + 4,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.control,
  },
});
