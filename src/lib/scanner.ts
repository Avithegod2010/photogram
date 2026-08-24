import * as MediaLibrary from "expo-media-library/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as VideoThumbnails from "expo-video-thumbnails";
import { File, Paths } from "expo-file-system";
import { insertMedia } from "../db/queries";
import { findDuplicate, quickFingerprint } from "./dedupe";

export interface ScanProgress {
  scanned: number;
  added: number;
  duplicates: number;
  failed: number;
  total: number | null;
  done: boolean;
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

async function makeThumbnail(uri: string, isVideo: boolean): Promise<string> {
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
  const saved = await rendered.saveAsync({ compress: 0.5, format: "jpeg" as never });
  return saved.uri;
}

async function fileSizeOf(uri: string): Promise<number> {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

export async function ensureMediaPermission(): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync();
  return perm.granted;
}

export async function scanDeviceLibrary(
  onProgress?: (progress: ScanProgress) => void,
  cancelRef?: { cancelled: boolean }
): Promise<ScanProgress> {
  const granted = await ensureMediaPermission();
  if (!granted) throw new Error("Photo library permission denied.");

  const progress: ScanProgress = {
    scanned: 0,
    added: 0,
    duplicates: 0,
    failed: 0,
    total: null,
    done: false,
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
          progress.duplicates++;
          continue;
        }

        const thumbUri = await makeThumbnail(localUri, isVideo);
        const inserted = await insertMedia({
          local_uri: localUri,
          thumb_uri: thumbUri,
          file_name: asset.filename,
          mime_type: mimeFromAsset(asset),
          byte_size: byteSize,
          width: asset.width,
          height: asset.height,
          duration_ms: isVideo ? Math.round(asset.duration * 1000) : null,
          taken_at: Math.round(asset.creationTime * 1000),
          fingerprint,
          state: "local",
        });
        if (inserted !== null) progress.added++;
        else progress.duplicates++;
      } catch {
        progress.failed++;
      }
      onProgress?.({ ...progress });
    }

    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);

  progress.done = true;
  onProgress?.({ ...progress });
  return progress;
}
