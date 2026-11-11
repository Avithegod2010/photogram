import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
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
import { t } from "../lib/i18n";
import {
  AppBar,
  AppText,
  Button,
  ListRow,
  ProgressBar,
  Screen,
  Section,
  Skeleton,
  Stat,
  alertDialog,
  confirmDialog,
} from "../ui";

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
            void confirmDialog({
              title: "This phone already has photos",
              message: `Migration is meant for a NEW phone. This device already has ${existing.toLocaleString()} item${
                existing === 1 ? "" : "s"
              } in its Photogram library — on this phone, backed-up photos may end up duplicated alongside the migrated cloud copies. Continue?`,
              confirmLabel: "Continue",
            }).then((ok) => {
              if (ok) scan(true);
            });
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
            void alertDialog({
              title: "Scan failed",
              message: err instanceof Error ? err.message : String(err),
            })
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
      void confirmDialog({
        title: "Restore to this device?",
        message: `Download ${rows.length} item${rows.length === 1 ? "" : "s"} (${formatBytes(
          totalBytes
        )}) from your Telegram backup into this phone's gallery? You can pause at any time — downloads are not affected by the upload throttle.`,
        confirmLabel: "Restore",
      }).then((ok) => {
        if (!ok) return;
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
          void alertDialog({
            title: cancelled ? "Restore stopped" : "Restore finished",
            message: `${done} item${done === 1 ? "" : "s"} back on this device${
              failed.length ? ` · ${failed.length} failed` : ""
            }${failed.length ? `\n\n${failed.slice(0, 2).join("\n\n")}` : ""}`,
          });
        })();
      });
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
          void alertDialog({
            title: "Album ready",
            message: `Claimed ${p.claimed} new item${p.claimed === 1 ? "" : "s"}${
              p.duplicates ? ` · ${p.duplicates} already in your library` : ""
            }${p.failed ? ` · ${p.failed} failed${p.lastError ? ` — ${p.lastError}` : ""}` : ""}.`,
          });
        })
        .catch((err) =>
          void alertDialog({
            title: "Claim failed",
            message: err instanceof Error ? err.message : String(err),
          })
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
      void confirmDialog({
        title: "Link this group?",
        message: `Creates the shared album "${group.title}" here and claims its photos, exactly like Collections → Shared albums does. Existing messages are matched by fingerprint, so nothing is duplicated.`,
        confirmLabel: "Link + claim",
      }).then((ok) => {
        if (!ok) return;
        void (async () => {
          try {
            const albumId = await createSharedAlbum(group.title, group.id);
            reloadAlbums();
            runClaim(albumId, group.title);
          } catch (err) {
            void alertDialog({
              title: "Link failed",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      });
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
    <Screen>
      <AppBar
        title="Migrate"
        subtitle="Rebuild this phone from your Telegram backup"
        large
        onBack={() => navigation.goBack()}
        backLabel={t("common.back")}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="body" color={theme.colors.onSurfaceVariant} style={styles.intro}>
          New phone? Photogram can rebuild itself from your Telegram backup: it re-indexes
          everything stored in Saved Messages, then brings the original files back here whenever
          you say so.
        </AppText>

        <Section title="1 · Rebuild the index" icon="cloud-download-outline">
          {scanning ? (
            <View style={styles.block}>
              <AppText
                variant="body"
                color={theme.colors.onSurfaceVariant}
                accessibilityLiveRegion="polite"
              >
                {scanText ?? "Reading your backup…"}
              </AppText>
              <View style={styles.scanRow}>
                <ActivityIndicator color={theme.colors.accent} />
                <AppText variant="footnote" color={theme.colors.onSurfaceFaint} style={styles.flex}>
                  Safe to leave this screen — the scan is idempotent.
                </AppText>
              </View>
              <Button
                label="Stop"
                variant="secondary"
                icon="stop-circle-outline"
                onPress={() => {
                  scanCancelRef.current.cancelled = true;
                }}
              />
            </View>
          ) : summary === null ? (
            <View style={styles.block}>
              <AppText variant="body" color={theme.colors.onSurfaceVariant}>
                The scan has not run yet.
              </AppText>
              <Button label="Scan my Telegram backup" icon="scan-outline" onPress={() => scan()} />
            </View>
          ) : totalTypeCount === 0 ? (
            <View style={styles.block}>
              <AppText variant="body" color={theme.colors.onSurfaceVariant}>
                No photos or videos found in Saved Messages yet. If your old phone is still
                backing up, come back and scan again later.
              </AppText>
              <Button label="Scan again" icon="refresh" onPress={() => scan()} />
            </View>
          ) : (
            <View style={styles.block}>
              <AppText variant="title3">
                Found {summary?.found.toLocaleString()} photos, {formatBytes(summary?.bytes ?? 0)}{" "}
                in your Telegram backup
              </AppText>
              <View style={styles.statRow}>
                <Stat value={(summary?.byType.photos ?? 0).toLocaleString()} label="Photos" />
                <Stat value={(summary?.byType.videos ?? 0).toLocaleString()} label="Videos" />
                <Stat value={(summary?.byType.animations ?? 0).toLocaleString()} label="Animations" />
                <Stat value={(summary?.byType.documents ?? 0).toLocaleString()} label="Files" />
              </View>
              <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
                {`${summary?.added ?? 0} newly indexed · ${
                  summary?.duplicates ?? 0
                } already in your library` +
                  ((summary?.failed ?? 0) > 0 ? ` · ${summary?.failed} failed` : "") +
                  (summary?.lastError ? ` — ${summary.lastError}` : "")}
              </AppText>
              <Button
                label="Re-scan for new items"
                variant="secondary"
                icon="refresh"
                onPress={() => scan()}
              />
              <AppText variant="captionRegular" color={theme.colors.onSurfaceFaint}>
                Your old phone may still be uploading — re-runs pick up only what is new.
              </AppText>
            </View>
          )}
        </Section>

        {cloudOnly.length > 0 ? (
          <Section title="2 · Restore to this device (optional)" icon="phone-portrait-outline">
            {restore ? (
              <View style={styles.block}>
                <View style={styles.rowBetween}>
                  <AppText variant="body" weight="medium">
                    {restorePaused ? "Paused" : "Restoring"}
                  </AppText>
                  <AppText variant="footnote" color={theme.colors.onSurfaceVariant} tabular>
                    {`${restore.done.toLocaleString()}/${restore.total.toLocaleString()} ${
                      restore.total === 1 ? "item" : "items"
                    }`}
                  </AppText>
                </View>
                <ProgressBar
                  progress={restorePct / 100}
                  label="Restore progress"
                  valueText={`${formatBytes(restore.bytes)} of ${formatBytes(
                    restore.totalBytes
                  )}`}
                  live
                />
                {restore.current ? (
                  <AppText
                    variant="captionRegular"
                    color={theme.colors.onSurfaceFaint}
                    numberOfLines={1}
                  >
                    {restore.current}
                  </AppText>
                ) : null}
                <View style={styles.buttonRow}>
                  <Button
                    label={restorePaused ? "Resume" : "Pause"}
                    variant="secondary"
                    icon={restorePaused ? "play" : "pause"}
                    onPress={togglePause}
                  />
                  <Button
                    label="Stop"
                    variant="secondary"
                    icon="stop-circle-outline"
                    onPress={() => {
                      restoreCancelRef.current.cancelled = true;
                      restorePauseRef.current = false;
                    }}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.block}>
                <AppText variant="body" color={theme.colors.onSurfaceVariant}>
                  {cloudOnly.length} item{cloudOnly.length === 1 ? "" : "s"} (
                  {formatBytes(cloudBytes)}) live in your Telegram backup but not yet on this
                  phone's gallery.
                </AppText>
                <Button
                  label={`Restore ${formatBytes(cloudBytes)}`}
                  icon="download-outline"
                  onPress={() => runRestore(cloudOnly)}
                />
              </View>
            )}
          </Section>
        ) : null}

        <Section
          title="3 · Re-link shared albums"
          icon="people-outline"
          footer="Groups load once per visit — tap “Load my groups” to refresh the list."
        >
          <View style={styles.block}>
            <AppText variant="body" color={theme.colors.onSurfaceVariant}>
              Your family's Telegram groups do not migrate automatically — link each one again.
              Photos already claimed keep their history; nothing is downloaded twice.
            </AppText>
          </View>

          {claimBanner ? (
            <View style={styles.blockTight}>
              <AppText variant="footnote" color={theme.colors.onSurfaceVariant} accessibilityLiveRegion="polite">
                {`Claiming “${claimBanner}”… `}
                {claimProgress
                  ? `${claimProgress.claimed} new · ${claimProgress.duplicates} dup`
                  : ""}
              </AppText>
            </View>
          ) : null}

          {groups === null ? (
            <>
              <View style={styles.skeletonRows} accessible accessibilityRole="progressbar" accessibilityLabel="Loading your Telegram groups">
                {Array.from({ length: 3 }).map((_, i) => (
                  <View key={i} style={styles.skeletonRow}>
                    <Skeleton width="60%" height={16} />
                    <Skeleton width="35%" height={12} />
                  </View>
                ))}
              </View>
              <View style={styles.block}>
                <Button
                  label="Load my groups"
                  variant="secondary"
                  icon="refresh"
                  onPress={loadGroups}
                />
              </View>
            </>
          ) : groups.length === 0 ? (
            <View style={styles.blockTight}>
              <AppText variant="footnote" color={theme.colors.onSurfaceVariant}>
                No groups found. Create your family group in Telegram first, then come back.
              </AppText>
            </View>
          ) : (
            groups.map((g) => {
              const linked = albums.find((a) => a.chat_id === g.id);
              return (
                <ListRow
                  key={g.id}
                  title={g.title}
                  subtitle={
                    (linked
                      ? `Already linked · ${linked.count} item${linked.count === 1 ? "" : "s"}`
                      : g.kind === "basic"
                        ? "Group"
                        : "Supergroup") +
                    (g.memberCount && !linked ? ` · ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` : "")
                  }
                  trailing={
                    <Button
                      label={linked ? "Claim" : "Link + claim"}
                      size="sm"
                      variant="secondary"
                      onPress={() => linkGroup(g)}
                      accessibilityLabel={`${linked ? "Claim new photos from" : "Link and claim"} ${
                        g.title
                      }`}
                    />
                  }
                />
              );
            })
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  intro: { marginBottom: theme.spacing.md },
  block: {
    padding: theme.spacing.md,
    gap: theme.spacing.compact,
  },
  blockTight: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  flex: { flex: 1 },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  statRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  skeletonRows: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.compact,
    gap: theme.spacing.md,
  },
  skeletonRow: { gap: theme.spacing.sm },
});
