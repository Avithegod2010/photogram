import * as MediaLibrary from "expo-media-library/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as VideoThumbnails from "expo-video-thumbnails";
import { File, Paths } from "expo-file-system";
import { insertMedia, updateMediaLibraryId, backfillTakenAt } from "../db/queries";
import { findDuplicate, quickFingerprint } from "./dedupe";

export interface ScanProgress {
  scanned: number;
  added: number;
  duplicates: number;
  failed: number;
  failedNames: string[];
  lastError?: string;
  total: number | null;
  done: boolean;
  partialAccess?: boolean;
}

const PAGE_SIZE = 100;

function mimeFromAsset(asset: MediaLibrary.Asset): string {
  if (asset.mediaType === MediaLibrary.MediaType.video) return "video/mp4";
  const name = asset.filename.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function autoTagsFor(asset: MediaLibrary.Asset): string {
  const name = asset.filename.toLowerCase();
  const tags: string[] = [asset.mediaType === MediaLibrary.MediaType.video ? "video" : "photo"];
  if (name.includes("screenshot")) tags.push("screenshot");
  if (name.includes("download")) tags.push("download");
  if (name.includes("whatsapp")) tags.push("whatsapp");
  return tags.join(" ");
}

export async function makeThumbnail(uri: string, isVideo: boolean): Promise<string> {
  const thumbsDir = new File(Paths.cache, "thumbs");
  if (!thumbsDir.exists) {
    try {
      thumbsDir.create();
    } catch {}
  }
  if (isVideo) {
    const result = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 500,
      quality: 0.5,
    });
    return result.uri;
  }
  const context = ImageManipulator.manipulate(uri).resize({ width: 320 });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.5, format: SaveFormat.JPEG });
  return saved.uri;
}

async function fileSizeOf(uri: string): Promise<number> {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

// WhatsApp videos often have no capture date in MediaStore (creationTime = 0 → shows as
// "1 Jan 1970" everywhere). Fall back to the file's mtime, which is when it was saved.
// Empirically creationTime/modificationTime arrive in MILLISECONDS on this stack — but
// guard against seconds too (values > 1e11 are already ms).
function toMs(secondsOrMs: number): number {
  return secondsOrMs > 1e11 ? Math.round(secondsOrMs) : Math.round(secondsOrMs * 1000);
}

function takenAtMsOf(asset: MediaLibrary.Asset): number {
  const creationMs = toMs(asset.creationTime);
  if (creationMs > 86400000) return creationMs; // > 2 Jan 1970: a real date
  return toMs(asset.modificationTime || Date.now());
}

export async function ensureMediaPermission(): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync();
  return perm.granted;
}

async function hasOnlySelectedAccess(): Promise<boolean> {
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    return perm.granted && (perm as { accessPrivileges?: string }).accessPrivileges === "selected";
  } catch {
    return false;
  }
}

export async function scanDeviceLibrary(
  onProgress?: (progress: ScanProgress) => void,
  cancelRef?: { cancelled: boolean }
): Promise<ScanProgress> {
  const granted = await ensureMediaPermission();
  if (!granted) throw new Error("Photo library permission denied.");
  const partialAccess = await hasOnlySelectedAccess();

  const progress: ScanProgress = {
    scanned: 0,
    added: 0,
    duplicates: 0,
    failed: 0,
    failedNames: [],
    total: null,
    done: false,
    partialAccess,
  };
  let cursor: string | undefined = undefined;

  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after: cursor,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    });
    progress.total = page.totalCount;

    for (const asset of page.assets) {
      if (cancelRef?.cancelled) {
        progress.done = true;
        onProgress?.({ ...progress });
        return progress;
      }
      progress.scanned++;
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset);
        const localUri = (info.localUri ?? asset.uri) as string;
        const isVideo = asset.mediaType === MediaLibrary.MediaType.video;
        const byteSize = await fileSizeOf(localUri);
        const fingerprint = quickFingerprint({
          byteSize,
          modifiedAtMs: Math.round((asset.modificationTime || asset.creationTime) * 1000),
          fileName: asset.filename,
        });

        const existing = await findDuplicate(fingerprint);
        if (existing) {
          if (asset.id && existing.id) {
            await updateMediaLibraryId(existing.id, asset.id);
          }
          if (existing.taken_at <= 86400000) {
            await backfillTakenAt(existing.id, takenAtMsOf(asset));
          }
          progress.duplicates++;
          continue;
        }

        const thumbUri = await makeThumbnail(localUri, isVideo);
        const location = info.location ?? null;
        const inserted = await insertMedia({
          local_uri: localUri,
          thumb_uri: thumbUri,
          file_name: asset.filename,
          mime_type: mimeFromAsset(asset),
          byte_size: byteSize,
          width: asset.width,
          height: asset.height,
          duration_ms: isVideo ? Math.round(asset.duration * 1000) : null,
          taken_at: takenAtMsOf(asset),
          fingerprint,
          state: "local",
          tags: autoTagsFor(asset),
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          media_library_id: asset.id ?? null,
        });
        if (inserted !== null) progress.added++;
        else progress.duplicates++;
      } catch (err) {
        progress.failed++;
        if (progress.failedNames.length < 8) progress.failedNames.push(asset.filename);
        if (!progress.lastError && err instanceof Error) progress.lastError = err.message;
      }
      onProgress?.({ ...progress });
    }

    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);

  progress.done = true;
  onProgress?.({ ...progress });
  return progress;
}
