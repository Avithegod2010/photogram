import { File } from "expo-file-system";
import * as MediaLibrary from "expo-media-library/legacy";
import { getSyncedWithLocal, clearLocalUri } from "../db/queries";

export interface FreeUpResult {
  freedFiles: number;
  freedBytes: number;
  failedFiles: number;
}

export function getFreeableStats(rows: { byte_size: number }[]): {
  count: number;
  bytes: number;
} {
  return {
    count: rows.length,
    bytes: rows.reduce((sum, r) => sum + (r.byte_size || 0), 0),
  };
}

// Android 11+ scoped storage blocks deleting files owned by OTHER apps directly.
// The system delete flow (createDeleteRequest, surfaced by deleteAssetsAsync) is the
// only reliable route, and it needs the media-library asset id. So: batch-delete via
// the media library when ids are known, then verify each file is actually gone before
// clearing the DB row — a denied system dialog leaves everything intact.
export async function freeUpDeviceSpace(
  onProgress?: (freedFiles: number) => void
): Promise<FreeUpResult> {
  const rows = await getSyncedWithLocal();
  const result: FreeUpResult = { freedFiles: 0, freedBytes: 0, failedFiles: 0 };

  const withLibraryIds = rows
    .filter((r) => r.media_library_id)
    .map((r) => r.media_library_id as string);
  if (withLibraryIds.length > 0) {
    try {
      await MediaLibrary.deleteAssetsAsync(withLibraryIds);
    } catch {}
  }

  for (const row of rows) {
    try {
      let file = new File(row.local_uri);
      if (file.exists) {
        try {
          file.delete();
        } catch {}
        file = new File(row.local_uri);
      }
      if (!file.exists) {
        await clearLocalUri(row.id);
        result.freedFiles++;
        result.freedBytes += row.byte_size || 0;
      } else {
        result.failedFiles++;
      }
    } catch {
      result.failedFiles++;
    }
    onProgress?.(result.freedFiles);
  }
  return result;
}
