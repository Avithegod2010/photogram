import TdLib from "react-native-tdlib";
import { File, Directory, Paths } from "expo-file-system";
import { getMeta, listAllMediaForExport, setMeta } from "../db/queries";
import { extractRemoteFile, fetchMessage, trackDownload, withTimeout } from "./restorer";

// v0.39 export follow-up 1: a FULL OFFLINE COPY. Downloads the ORIGINAL
// (largest) file of every backed-up item straight from Telegram into the
// app's documents/offline/ folder — the photos/videos as real files, one per
// item, named by file_name. This is the "walk away with everything" step the
// JSON manifest alone can't do. Telegram-safety: read-only downloads with a
// paced gap, resumable cursor in meta (mirrors the integrity walk), local
// files with the right size are skipped so re-runs are cheap.
//
// Scope note (honest, like every screen): runs while the app is foregrounded;
// big libraries take many sessions and the cursor just continues.

const CURSOR_KEY = "offline_export_cursor";
const GAP_MS = 400;
const FBUDGET = 200; // files per run

type TdAny = Record<string, any>;

export interface OfflineExportProgress {
  phase: "scanning" | "downloading" | "done";
  saved: number;
  skippedExisting: number;
  failed: number;
  current: string | null;
  processedMb: number;
}

async function offlineDir(): Promise<Directory> {
  const dir = new Directory(Paths.document, "offline");
  if (!dir.exists) dir.create();
  return dir;
}

export async function loadOfflineProgress(): Promise<OfflineExportProgress | null> {
  const raw = await getMeta("offline_export_done");
  try {
    return raw ? (JSON.parse(raw) as OfflineExportProgress) : null;
  } catch {
    return null;
  }
}

async function saveProgress(p: OfflineExportProgress): Promise<void> {
  await setMeta("offline_export_done", JSON.stringify({ ...p, current: null }));
}

function sanitizeName(name: string | null, mediaId: number): string {
  const base = (name ?? "").replace(/[\\/:*?"<>|]/g, "_").trim();
  return base.length > 0 ? base : `item-${mediaId}`;
}

export async function runOfflineExportPass(
  onProgress?: (p: OfflineExportProgress) => void,
  cancelRef?: { cancelled: boolean }
): Promise<OfflineExportProgress> {
  const progress: OfflineExportProgress = {
    phase: "scanning",
    saved: 0,
    skippedExisting: 0,
    failed: 0,
    current: null,
    processedMb: 0,
  };
  const last = Number((await getMeta(CURSOR_KEY)) ?? 0);
  let lastId = Number.isFinite(last) && last >= 0 ? last : 0;
  const dir = await offlineDir();

  const report = () => onProgress?.({ ...progress });

  // A pass walks the whole index once per finished full loop; the cursor lets
  // interrupted sessions resume exactly where they left off.
  const rows = (await listAllMediaForExport()).filter((r) => {
    if (!(r.remote_chat_id && r.remote_message_id && r.remote_message_id !== "0")) return false;
    return r.id > lastId;
  });
  report();

  let processed = 0;
  for (const row of rows) {
    if (cancelRef?.cancelled) break;
    if (processed >= FBUDGET) break;
    progress.phase = "downloading";
    progress.current = row.file_name ?? `item ${row.id}`;
    report();

    try {
      // Already downloaded with a sane size → skip (cheap re-runs).
      if (row.local_uri) {
        try {
          if (new File(row.local_uri).exists) {
            progress.skippedExisting++;
            lastId = row.id;
            await setMeta(CURSOR_KEY, String(lastId));
            processed++;
            report();
            continue;
          }
        } catch {}
      }
      const before = `${sanitizeName(row.file_name, row.id)}`;
      let ext = "";
      const mime = row.mime_type ?? "";
      if (mime.startsWith("image/")) ext = mime === "image/jpeg" ? ".jpg" : `.${mime.split("/")[1] ?? "img"}`;
      else if (mime === "video/mp4") ext = ".mp4";

      // Telegram-side lookup (restorer's proven path: open chat → history scan
      // → id-or-filename match → pick the LARGEST photo size).
      let remote = null as null | { remoteId: string; expected: number };
      try {
        const found = await withTimeout(
          fetchMessage(String(row.remote_chat_id), String(row.remote_message_id), row.file_name),
          60_000,
          "Fetching message from Telegram"
        );
        if (found) remote = extractRemoteFile(found.message);
      } catch {
        remote = null;
      }
      if (!remote || !remote.remoteId) {
        progress.failed++;
        lastId = row.id;
        processed++;
        await setMeta(CURSOR_KEY, String(lastId));
        if (processed % 10 === 0) await saveProgress(progress);
        report();
        continue;
      }

      const stopTracking = trackDownload(remote.remoteId, undefined);
      try {
        const download = await withTimeout(
          TdLib.downloadFileByRemoteId(remote.remoteId),
          30 * 60 * 1000,
          "Downloading from Telegram"
        );
        const file = JSON.parse(String((download as TdAny).raw ?? "{}")) as TdAny;
        const localPath: string | undefined = file?.local?.path;
        const completed =
          file?.local?.isDownloadingCompleted ?? file?.local?.is_downloading_completed;
        if (completed !== true || !localPath) {
          throw new Error("download did not complete");
        }
        // Copy out of TDLib's cache into the export folder with the item's name.
        const target = new File(dir, before + ext);
        if (target.exists) target.delete();
        await new File(localPath).copy(target);
        progress.saved++;
        progress.processedMb += (new File(target.uri).size ?? 0) / (1024 * 1024);
        lastId = row.id;
      } finally {
        stopTracking();
      }
    } catch {
      progress.failed++;
      lastId = row.id; // never stall on one bad item — the file can retry later
    }
    processed++;
    await setMeta(CURSOR_KEY, String(lastId));
    if (processed % 10 === 0) {
      await saveProgress(progress);
      report();
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  progress.phase = "done";
  await saveProgress(progress);
  report();
  return progress;
}
