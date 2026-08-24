import { File } from "expo-file-system";
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

export async function freeUpDeviceSpace(
  onProgress?: (freedFiles: number) => void
): Promise<FreeUpResult> {
  const rows = await getSyncedWithLocal();
  const result: FreeUpResult = { freedFiles: 0, freedBytes: 0, failedFiles: 0 };
  for (const row of rows) {
    try {
      const file = new File(row.local_uri);
      if (file.exists) {
        file.delete();
      }
      await clearLocalUri(row.id);
      result.freedFiles++;
      result.freedBytes += row.byte_size || 0;
    } catch {
      result.failedFiles++;
    }
    onProgress?.(result.freedFiles);
  }
  return result;
}
