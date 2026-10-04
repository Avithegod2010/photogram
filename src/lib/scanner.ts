import * as MediaLibrary from "expo-media-library/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as VideoThumbnails from "expo-video-thumbnails";
import { File, Paths } from "expo-file-system";
import type * as TextRecognitionModule from "@react-native-ml-kit/text-recognition";
import type * as ImageLabelingModule from "@react-native-ml-kit/image-labeling";
import { findMediaIdByMediaLibraryId, getMediaByIds, insertMedia, updateMediaLibraryId, backfillTakenAt, updateOcrText, updateMediaLabels, updateMediaPhash, setMediaState, setMediaPlace } from "../db/queries";
import { nearestCity } from "./places";
import { findDuplicate, quickFingerprint } from "./dedupe";
import { decodeThumbToGray, pHash64 } from "./imageAnalysis";
import { useSettingsStore } from "../store/settingsStore";

export interface ScanProgress {
  scanned: number;
  added: number;
  duplicates: number;
  failed: number;
  failedNames: string[];
  addedMediaIds: number[];
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

// OCR (idea 5): reads text inside photos so search can find it. Owner opt-in
// via Settings. Soft-require — the native module only exists after the next
// gradle rebuild; until then OCR silently does nothing.
let textRecognition: typeof TextRecognitionModule.default | null | undefined;
function requireTextRecognition(): typeof TextRecognitionModule.default | null {
  if (textRecognition !== undefined) return textRecognition;
  try {
    const mod = require("@react-native-ml-kit/text-recognition") as typeof TextRecognitionModule;
    const fn = mod?.default;
    textRecognition = typeof fn?.recognize === "function" ? fn : null;
  } catch {
    textRecognition = null;
  }
  return textRecognition;
}

async function readTextFromImage(uri: string): Promise<string | null> {
  const tr = requireTextRecognition();
  if (!tr) return null;
  try {
    const result = await tr.recognize(uri);
    const text = String(result?.text ?? "").replace(/\s+/g, " ").trim();
    return text.length > 0 ? text.slice(0, 4000) : null;
  } catch {
    return null;
  }
}

// v0.23 vibe search: on-device ML Kit labels ("beach", "food", "dog") make
// photos searchable by content. Same opt-in + soft-require pattern as OCR —
// the native module only exists after the next gradle rebuild; until then
// labeling silently does nothing.
let imageLabeler: typeof ImageLabelingModule.default | null | undefined;
function requireImageLabeler(): typeof ImageLabelingModule.default | null {
  if (imageLabeler !== undefined) return imageLabeler;
  try {
    const mod = require("@react-native-ml-kit/image-labeling") as typeof ImageLabelingModule;
    const fn = mod?.default;
    imageLabeler = typeof fn?.label === "function" ? fn : null;
  } catch {
    imageLabeler = null;
  }
  return imageLabeler;
}

const LABEL_MIN_CONFIDENCE = 0.6;
const LABEL_MAX_COUNT = 5;

// Top labels at >= 0.6 confidence, lowercased, space-joined ("beach sky dog").
// Null = module missing / nothing confident enough / failure — the row stays
// NULL and the next rescan retries; a labeling failure never fails the scan.
async function labelImage(uri: string): Promise<string | null> {
  const labeler = requireImageLabeler();
  if (!labeler) return null;
  try {
    const found = await labeler.label(uri);
    const picked = (found ?? [])
      .filter(
        (l) =>
          typeof l?.text === "string" &&
          l.text.length > 0 &&
          Number(l?.confidence ?? 0) >= LABEL_MIN_CONFIDENCE
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, LABEL_MAX_COUNT)
      .map((l) => l.text.toLowerCase());
    const joined = Array.from(new Set(picked)).join(" ").trim();
    return joined.length > 0 ? joined : null;
  } catch {
    return null;
  }
}

// v0.24 "Find similar": 64-bit pHash of the thumbnail, stored as 16-char hex.
// Always-on (no opt-in — hashing a 320px thumb is a few ms), photos only.
// Null = thumbnail missing/undecodable; the row stays NULL and the duplicate
// finder's backfill (or a later rescan) retries it.
async function hashThumb(uri: string): Promise<string | null> {
  try {
    return pHash64(await decodeThumbToGray(uri)).toString(16).padStart(16, "0");
  } catch {
    return null;
  }
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
    addedMediaIds: [],
    total: null,
    done: false,
    partialAccess,
  };
  const ocrOn = useSettingsStore.getState().ocrSearchEnabled;
  const smartTagsOn = useSettingsStore.getState().smartTagsEnabled;
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

        // Media-library id gate (F1): a file the restorer saved to the gallery
        // carries the migration's cloud-side fingerprint (message date + tg
        // name), which this device-side fingerprint can never equal — so also
        // match the stored media_library_id and treat the hit exactly like a
        // fingerprint duplicate (same taken_at / OCR backfill path below).
        let existing = await findDuplicate(fingerprint);
        if (!existing && asset.id) {
          const byLibraryId = await findMediaIdByMediaLibraryId(asset.id);
          if (byLibraryId !== null) {
            const rows = await getMediaByIds([byLibraryId]);
            const row = rows[0];
            // findDuplicate's narrow shape; MediaRow doesn't expose ocr_text,
            // so null lets the OCR backfill below cover migrated+restored
            // photos (they never had text indexed). ml_labels passes through
            // so already-labeled rows aren't re-labeled on every rescan.
            if (row) {
              existing = {
                id: row.id,
                state: row.state,
                taken_at: row.taken_at,
                ocr_text: null,
                thumb_uri: row.thumb_uri,
                ml_labels: row.ml_labels ?? null,
                phash: row.phash ?? null,
              };
            }
          }
        }
        if (existing) {
          if (asset.id && existing.id) {
            await updateMediaLibraryId(existing.id, asset.id);
          }
          if (existing.taken_at <= 86400000) {
            await backfillTakenAt(existing.id, takenAtMsOf(asset));
          }
          // OCR backfill for pre-existing rows missing text (photos only).
          if (ocrOn && !isVideo && (existing.ocr_text ?? null) === null) {
            const ocr = await readTextFromImage(localUri);
            if (ocr) await updateOcrText(existing.id, ocr);
          }
          // v0.23 smart-tag backfill for never-labeled rows (mirrors the OCR
          // backfill above; labels run on the 320px thumbnail, photos only).
          if (smartTagsOn && !isVideo && (existing.ml_labels ?? null) === null) {
            const labels = await labelImage(existing.thumb_uri);
            if (labels) await updateMediaLabels(existing.id, labels);
          }
          // v0.24 phash backfill for never-hashed rows (photos only).
          if (!isVideo && (existing.phash ?? null) === null) {
            const phash = await hashThumb(existing.thumb_uri);
            if (phash) await updateMediaPhash(existing.id, phash);
          }
          // v0.21 place backfill: rows carrying GPS (mirrors the OCR backfill
          // pattern; the dataset is static so recompute is idempotent).
          if (info.location?.latitude != null && info.location?.longitude != null) {
            const place = nearestCity(info.location.latitude, info.location.longitude);
            if (place) await setMediaPlace(existing.id, place);
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
        if (inserted !== null) {
          progress.added++;
          progress.addedMediaIds.push(inserted);
          // Idea 5: index searchable text (photos only, owner opt-in).
          if (ocrOn && !isVideo) {
            const ocr = await readTextFromImage(localUri);
            if (ocr) await updateOcrText(inserted, ocr);
          }
          // v0.23: index content labels from the thumbnail (photos only,
          // owner opt-in).
          if (smartTagsOn && !isVideo) {
            const labels = await labelImage(thumbUri);
            if (labels) await updateMediaLabels(inserted, labels);
          }
          // v0.24: persist the perceptual hash for "Find similar" (photos
          // only, always-on).
          if (!isVideo) {
            const phash = await hashThumb(thumbUri);
            if (phash) await updateMediaPhash(inserted, phash);
          }
          // v0.21: offline nearest-city place name for GPS-tagged items.
          if (location?.latitude != null && location?.longitude != null) {
            const place = nearestCity(location.latitude, location.longitude);
            if (place) await setMediaPlace(inserted, place);
          }
        } else {
          progress.duplicates++;
        }
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
