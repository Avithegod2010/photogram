import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { formatBytes } from "../lib/stats";
import {
  listCloudOnly,
  rehydrateInventory,
  RehydrateSummary,
} from "../lib/rehydrate";
import { restoreMediaToDevice } from "../lib/restorer";
import { claimAlbumMedia, ClaimProgress } from "../lib/claimer";
import {
  countMediaRows,
  createSharedAlbum,
  listSharedAlbums,
  SharedAlbumRow,
} from "../db/queries";
import { listMyGroups, TelegramGroup } from "../lib/chats";
import { theme } from "../theme";

// F1 One-tap phone migration (docs/PLAN-FEATURES-v0.11-plus.md): rebuild this
// phone's library from the Saved Messages backup, optionally re-download the
// originals at the owner's pace, and re-link shared family albums.

type MigrateNav = NativeStackNavigationProp<{ Migrate: undefined }>;

interface CloudRow {
  id: number;
  byte_size: number;
  file_name: string | null;
}

interface RestoreState {
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
  current: string | null;
}

export function MigrateScreen({ navigation }: { navigation: MigrateNav }) {
  const insets = useSafeAreaInsets();

  // Phase 1+2 — inventory + index rebuild (one idempotent pass over history).
  const [summary, setSummary] = useState<RehydrateSummary | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanText, setScanText] = useState<string | null>(null);
  const scanCancelRef = useRef({ cancelled: false });

  // Phase 3 — optional paced restore.
  const [cloudOnly, setCloudOnly] = useState<CloudRow[]>([]);
  const [restore, setRestore] = useState<RestoreState | null>(null);
  const [restorePaused, setRestorePaused] = useState(false);
  const restorePauseRef = useRef(false);
  const restoreCancelRef = useRef({ cancelled: false });

  // Phase 4 — shared-album re-link.
  const [groups, setGroups] = useState<TelegramGroup[] | null>(null);
  const [albums, setAlbums] = useState<SharedAlbumRow[]>([]);
  const [claimBanner, setClaimBanner] = useState<string | null>(null);
  const [claimProgress, setClaimProgress] = useState<ClaimProgress | null>(null);

  const reloadCloudOnly = useCallback(() => {
    void listCloudOnly()
      .then(setCloudOnly)
      .catch(() => setCloudOnly([]));
  }, []);

  const reloadAlbums = useCallback(() => {
    void listSharedAlbums()
      .then(setAlbums)
      .catch(() => setAlbums([]));
  }, []);

  const scan = useCallback(
    (warned = false) => {
      if (scanning) return;
      // Review MAJOR 1B: migration assumes an EMPTY library (a new phone). On a
      // phone that already has local photos, the rebuild creates parallel
      // cloud-only rows for everything that is backed up, and the scanner can
      // only merge restored files whose media-library id matches — already-local
      // photos without a Telegram-side fingerprint stay duplicated. Warn before
      // every rebuild start (an explicit Continue is a deliberate owner choice);
      // never hard-block.
      void (async () => {
        if (!warned) {
          const existing = await countMediaRows().catch(() => 0);
          if (existing > 0) {
            Alert.alert(
              "This phone already has photos",
              `Migration is meant for a NEW phone. This device already has ${existing.toLocaleString()} item${
                existing === 1 ? "" : "s"
              } in its Photogram library — on this phone, backed-up photos may end up duplicated alongside the migrated cloud copies. Continue?`,
              [
                { text: "Cancel", style: "cancel" },
                { text: "Continue", onPress: () => scan(true) },
              ]
            );
            return;
          }
        }
        scanCancelRef.current.cancelled = true;
        const cancelRef = { cancelled: false };
        scanCancelRef.current = cancelRef;
        setScanning(true);
        setScanText("Looking through your Saved Messages…");
        void rehydrateInventory((p) => {
          setScanText(
            `Reading backup… ${p.scanned} checked · ${p.found} photos found${
              p.added ? ` · ${p.added} indexed` : ""
            }`
          );
        }, cancelRef)
          .then((result) => {
            setSummary(result);
            reloadCloudOnly();
          })
          .catch((err) =>
            Alert.alert("Scan failed", err instanceof Error ? err.message : String(err))
          )
          .finally(() => {
            if (scanCancelRef.current === cancelRef) setScanning(false);
            setScanText(null);
          });
      })();
    },
    [scanning, reloadCloudOnly]
  );

  // The plan's trigger point (a): the screen does its job in one tap — start
  // scanning as soon as it opens. Groups load once for the re-link section.
  useEffect(() => {
    scan();
    reloadCloudOnly();
    reloadAlbums();
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runRestore = useCallback(
    (rows: CloudRow[]) => {
      if (rows.length === 0) return;
      const totalBytes = rows.reduce((s, r) => s + (r.byte_size || 0), 0);
      Alert.alert(
        "Restore to this device?",
        `Download ${rows.length} item${rows.length === 1 ? "" : "s"} (${formatBytes(
          totalBytes
        )}) from your Telegram backup into this phone's gallery? You can pause at any time — downloads are not affected by the upload throttle.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            onPress: () => {
              restorePauseRef.current = false;
              restoreCancelRef.current.cancelled = false;
              setRestorePaused(false);
              setRestore({ done: 0, total: rows.length, bytes: 0, totalBytes, current: null });
              void (async () => {
                let done = 0;
                let bytes = 0;
                const failed: string[] = [];
                for (const row of rows) {
                  while (restorePauseRef.current && !restoreCancelRef.current.cancelled) {
                    await new Promise((resolve) => setTimeout(resolve, 400));
                  }
                  if (restoreCancelRef.current.cancelled) break;
                  setRestore((s) => (s ? { ...s, current: row.file_name ?? null } : s));
                  const result = await restoreMediaToDevice(row.id, (p) => {
                    if (p.phase !== "fetching") {
                      setRestore((s) =>
                        s ? { ...s, bytes: Math.min(s.totalBytes, bytes + p.receivedBytes) } : s
                      );
                    }
                  });
                  if (result.outcome === "restored") {
                    done++;
                    bytes += row.byte_size || 0;
                    setRestore((s) => (s ? { ...s, done, bytes } : s));
                  } else if (result.message) {
                    failed.push(result.message);
                  }
                }
                const cancelled = restoreCancelRef.current.cancelled;
                setRestore(null);
                reloadCloudOnly();
                Alert.alert(
                  cancelled ? "Restore stopped" : "Restore finished",
                  `${done} item${done === 1 ? "" : "s"} back on this device${
                    failed.length ? ` · ${failed.length} failed` : ""
                  }${failed.length ? `\n\n${failed.slice(0, 2).join("\n\n")}` : ""}`
                );
              })();
            },
          },
        ]
      );
    },
    [reloadCloudOnly]
  );

  const togglePause = useCallback(() => {
    restorePauseRef.current = !restorePauseRef.current;
    setRestorePaused(restorePauseRef.current);
  }, []);

  const runClaim = useCallback(
    (albumId: number, title: string) => {
      setClaimBanner(title);
      setClaimProgress({ claimed: 0, duplicates: 0, failed: 0, done: false });
      void claimAlbumMedia(albumId, setClaimProgress)
        .then((p) => {
          Alert.alert(
            "Album ready",
            `Claimed ${p.claimed} new item${p.claimed === 1 ? "" : "s"}${
              p.duplicates ? ` · ${p.duplicates} already in your library` : ""
            }${p.failed ? ` · ${p.failed} failed${p.lastError ? ` — ${p.lastError}` : ""}` : ""}.`
          );
        })
        .catch((err) =>
          Alert.alert("Claim failed", err instanceof Error ? err.message : String(err))
        )
        .finally(() => {
          setClaimBanner(null);
          setClaimProgress(null);
          reloadAlbums();
        });
    },
    [reloadAlbums]
  );

  const linkGroup = useCallback(
    (group: TelegramGroup) => {
      const linked = albums.find((a) => a.chat_id === group.id);
      if (linked) {
        runClaim(linked.id, group.title);
        return;
      }
      Alert.alert(
        "Link this group?",
        `Creates the shared album "${group.title}" here and claims its photos, exactly like Collections → Shared albums does. Existing messages are matched by fingerprint, so nothing is duplicated.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Link + claim",
            onPress: () => {
              void (async () => {
                try {
                  const albumId = await createSharedAlbum(group.title, group.id);
                  reloadAlbums();
                  runClaim(albumId, group.title);
                } catch (err) {
                  Alert.alert("Link failed", err instanceof Error ? err.message : String(err));
                }
              })();
            },
          },
        ]
      );
    },
    [albums, reloadAlbums, runClaim]
  );

  const loadGroups = useCallback(() => {
    setGroups(null);
    void listMyGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  const totalTypeCount =
    (summary?.byType.photos ?? 0) +
    (summary?.byType.videos ?? 0) +
    (summary?.byType.animations ?? 0) +
    (summary?.byType.documents ?? 0);
  const cloudBytes = cloudOnly.reduce((s, r) => s + (r.byte_size || 0), 0);
  const restorePct =
    restore && restore.totalBytes > 0
      ? Math.max(2, Math.min(100, (restore.bytes / restore.totalBytes) * 100))
      : 2;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Migrate</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          New phone? Photogram can rebuild itself from your Telegram backup: it re-indexes
          everything stored in Saved Messages, then brings the original files back here whenever
          you say so.
        </Text>

        <Section title="1 · Rebuild the index">
          {scanning ? (
            <>
              <Text style={styles.bodyText}>{scanText ?? "Reading your backup…"}</Text>
              <ActivityIndicator color={theme.colors.primary} style={styles.spinner} />
              <Text style={styles.hint}>Safe to leave this screen — the scan is idempotent.</Text>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                onPress={() => {
                  scanCancelRef.current.cancelled = true;
                }}
              >
                <Text style={styles.secondaryText}>Stop</Text>
              </Pressable>
            </>
          ) : summary === null ? (
            <>
              <Text style={styles.bodyText}>The scan has not run yet.</Text>
              <PrimaryButton label="Scan my Telegram backup" onPress={scan} />
            </>
          ) : totalTypeCount === 0 ? (
            <>
              <Text style={styles.bodyText}>
                No photos or videos found in Saved Messages yet. If your old phone is still
                backing up, come back and scan again later.
              </Text>
              <PrimaryButton label="Scan again" onPress={scan} />
            </>
          ) : (
            <>
              <Text style={styles.headline}>
                Found {summary?.found.toLocaleString()} photos, {formatBytes(summary?.bytes ?? 0)}{" "}
                in your Telegram backup
              </Text>
              <Text style={styles.bodyText}>
                {summary?.byType.photos ?? 0} photos · {summary?.byType.videos ?? 0} videos ·{" "}
                {summary?.byType.animations ?? 0} animations · {summary?.byType.documents ?? 0}{" "}
                files{"\n"}
                {summary?.added ?? 0} newly indexed · {summary?.duplicates ?? 0} already in your
                library
                {(summary?.failed ?? 0) > 0 ? ` · ${summary?.failed} failed` : ""}
                {summary?.lastError ? ` — ${summary.lastError}` : ""}
              </Text>
              <PrimaryButton
                label="Re-scan for new items"
                sub="Your old phone may still be uploading — re-runs pick up only what is new."
                onPress={scan}
              />
            </>
          )}
        </Section>

        {cloudOnly.length > 0 ? (
          <Section title="2 · Restore to this device (optional)">
            {restore ? (
              <>
                <Text style={styles.bodyText}>
                  {restorePaused ? "Paused — " : "Restoring — "}
                  {formatBytes(restore.bytes)} of {formatBytes(restore.totalBytes)} ·{" "}
                  {restore.done}/{restore.total} items
                </Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${restorePct}%` }]} />
                </View>
                {restore.current ? (
                  <Text style={styles.hint} numberOfLines={1}>
                    {restore.current}
                  </Text>
                ) : null}
                <View style={styles.btnRow}>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                    onPress={togglePause}
                  >
                    <Text style={styles.secondaryText}>{restorePaused ? "Resume" : "Pause"}</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                    onPress={() => {
                      restoreCancelRef.current.cancelled = true;
                      restorePauseRef.current = false;
                    }}
                  >
                    <Text style={styles.secondaryText}>Stop</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.bodyText}>
                  {cloudOnly.length} item{cloudOnly.length === 1 ? "" : "s"} (
                  {formatBytes(cloudBytes)}) live in your Telegram backup but not yet on this
                  phone's gallery.
                </Text>
                <PrimaryButton
                  label={`Restore ${formatBytes(cloudBytes)}`}
                  onPress={() => runRestore(cloudOnly)}
                />
              </>
            )}
          </Section>
        ) : null}

        <Section title="3 · Re-link shared albums">
          <Text style={styles.bodyText}>
            Your family's Telegram groups do not migrate automatically — link each one again.
            Photos already claimed keep their history; nothing is downloaded twice.
          </Text>
          {claimBanner ? (
            <View style={styles.claimBanner}>
              <Text style={styles.bodyText}>
                Claiming "{claimBanner}"…{" "}
                {claimProgress ? `${claimProgress.claimed} new · ${claimProgress.duplicates} dup` : ""}
              </Text>
            </View>
          ) : null}
          {groups === null ? (
            <>
              <Text style={styles.hint}>Loading your Telegram groups…</Text>
              <PrimaryButton label="Load my groups" onPress={loadGroups} />
            </>
          ) : groups.length === 0 ? (
            <Text style={styles.hint}>
              No groups found. Create your family group in Telegram first, then come back.
            </Text>
          ) : (
            groups.map((g) => {
              const linked = albums.find((a) => a.chat_id === g.id);
              return (
                <View key={g.id} style={styles.groupRow}>
                  <View style={styles.groupText}>
                    <Text style={styles.groupName} numberOfLines={1}>
                      {g.title}
                    </Text>
                    <Text style={styles.hint}>
                      {linked
                        ? `Already linked · ${linked.count} item${linked.count === 1 ? "" : "s"}`
                        : g.kind === "basic"
                          ? "Group"
                          : "Supergroup"}
                      {g.memberCount && !linked ? ` · ${g.memberCount} members` : ""}
                    </Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]}
                    onPress={() => linkGroup(g)}
                  >
                    <Text style={styles.smallBtnText}>{linked ? "⟳ Claim" : "Link + claim"}</Text>
                  </Pressable>
                </View>
              );
            })
          )}
          <Text style={styles.hint}>
            Groups load once per visit — tap "Load my groups" to refresh the list.
          </Text>
        </Section>
      </ScrollView>
    </View>
  );
}

function PrimaryButton(props: { label: string; sub?: string; onPress: () => void }) {
  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        onPress={props.onPress}
      >
        <Text style={styles.primaryBtnText}>{props.label}</Text>
      </Pressable>
      {props.sub ? <Text style={styles.hint}>{props.sub}</Text> : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 4,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700", flex: 1 },
  scroll: { padding: theme.spacing.md, paddingBottom: 48 },
  intro: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: theme.spacing.md,
  },
  section: { marginBottom: theme.spacing.lg },
  sectionTitle: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginLeft: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  sectionCard: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    padding: theme.spacing.md,
    gap: 10,
  },
  headline: { color: theme.colors.onSurface, fontSize: 16.5, fontWeight: "700", lineHeight: 22 },
  bodyText: { color: theme.colors.onSurfaceVariant, fontSize: 13.5, lineHeight: 19 },
  hint: { color: theme.colors.onSurfaceVariant, fontSize: 12, lineHeight: 16, opacity: 0.8 },
  spinner: { alignSelf: "flex-start" },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: theme.colors.onPrimary, fontWeight: "700", fontSize: 14.5 },
  secondaryBtn: {
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryText: { color: theme.colors.onSurface, fontWeight: "600", fontSize: 14 },
  btnRow: { flexDirection: "row", gap: theme.spacing.sm },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.surfaceHighest,
    overflow: "hidden",
  },
  barFill: { height: "100%", backgroundColor: theme.colors.primary, borderRadius: 4 },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  groupText: { flex: 1 },
  groupName: { color: theme.colors.onSurface, fontSize: 15, fontWeight: "600" },
  smallBtn: {
    backgroundColor: theme.colors.primaryContainer,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallBtnText: { color: theme.colors.onPrimaryContainer, fontSize: 12.5, fontWeight: "700" },
  claimBanner: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  pressed: { opacity: 0.85 },
});
