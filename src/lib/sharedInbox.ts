import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library/legacy";

// v0.55 share-sheet intake (JS half).
//
// SharedMediaIntake.kt copies every shared uri into files/shared_inbox and
// lists the absolute paths in files/shared_inbox.json. This module hands those
// files to the Android MediaStore (so they appear in the gallery) and then
// deletes the temporary copies - from there the normal scanner/backup path
// takes over exactly like a camera photo.
//
// The parse step is pure so the probe can check the guard rails without a
// device: only absolute paths, de-duped, capped.

export const SHARED_INBOX_INDEX = "shared_inbox.json";
export const MAX_SHARED_ITEMS = 20;

export function parseSharedInbox(json: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of parsed) {
    if (typeof value !== "string") continue;
    const path = value.trim();
    if (!path.startsWith("/")) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= MAX_SHARED_ITEMS) break;
  }
  return out;
}

export function sharedInboxIndexFile(): File {
  return new File(Paths.document, SHARED_INBOX_INDEX);
}

// Never throws. Returns how many files reached the gallery.
export async function consumeSharedInbox(): Promise<number> {
  try {
    const index = sharedInboxIndexFile();
    if (!index.exists) return 0;
    const paths = parseSharedInbox(await index.text());
    let imported = 0;
    for (const path of paths) {
      try {
        const file = new File(path);
        if (file.exists) {
          await MediaLibrary.createAssetAsync(path);
          imported++;
        }
        try {
          file.delete();
        } catch {}
      } catch {
        // One unreadable share must not block the rest.
      }
    }
    try {
      index.delete();
    } catch {}
    return imported;
  } catch {
    return 0;
  }
}
