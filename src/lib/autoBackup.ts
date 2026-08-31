import { scanDeviceLibrary, ScanProgress } from "./scanner";
import { enqueueForUpload } from "./uploader";
import { getMediaByIds } from "../db/queries";
import { useSettingsStore } from "../store/settingsStore";

// Idea 6: auto-backup. When enabled, Photogram periodically rescans the device
// library and queues any NEW photos/videos for upload — backup becomes
// automatic instead of button-driven. Folder selection filters which of the
// new items are queued (empty selection = everything).

const PASS_INTERVAL_MS = 5 * 60 * 1000;
let loopStarted = false;
let running = false;

// Family-album media is claimed, never auto-enqueued, so no shared-album
// concerns here — this only touches newly scanned rows of the owner's library.
function folderAllows(localUri: string | null, folders: string[]): boolean {
  if (folders.length === 0) return true; // no selection = all folders
  if (!localUri) return false;
  const uri = decodeURIComponent(localUri).toLowerCase();
  return folders.some((f) => uri.includes(f.toLowerCase()));
}

export async function runAutoBackupPass(): Promise<{ added: number; queued: number } | null> {
  const { autoBackupEnabled, autoBackupFolders } = useSettingsStore.getState();
  if (!autoBackupEnabled || running) return null;
  running = true;
  try {
    const progress: ScanProgress = await scanDeviceLibrary();
    let queued = 0;
    if (progress.addedMediaIds.length > 0) {
      const rows = await getMediaByIds(progress.addedMediaIds);
      for (const row of rows) {
        if (!folderAllows(row.local_uri, autoBackupFolders)) continue;
        try {
          await enqueueForUpload(row.id);
          queued++;
        } catch {}
      }
    }
    return { added: progress.added, queued };
  } catch {
    return null;
  } finally {
    running = false;
  }
}

export function startAutoBackupLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  // First pass shortly after boot, then on an interval. The worker's own
  // Wi-Fi-only / charge-only holds apply to whatever we queue.
  setTimeout(() => void runAutoBackupPass(), 15_000);
  setInterval(() => void runAutoBackupPass(), PASS_INTERVAL_MS);
}
