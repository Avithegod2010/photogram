import * as FileSystem from "expo-file-system/legacy";

// v0.33+ People & Pets step 1: the face-embedding model catalog. The app
// ships NO model — the user picks one and downloads it in-app (fast-tflite
// loads a model file at runtime, so no rebuild per model). Embeddings are
// only comparable within the same model, so the chosen id is recorded
// alongside every embedding (schema v17 model_id).

export interface FaceModelDef {
  id: string;
  name: string;
  sizeLabel: string;
  inputSize: number;
  embeddingDim: number;
  license: string;
  notes: string;
  url: string;
  recommended?: boolean;
}

// Verified 2026-10-05 via the GitHub contents API (sizes are exact bytes of
// the hosted files). The int8-quantized variants in the same repo are held
// back for now — int8 input preprocessing differs and v1 keeps one pipeline.
export const FACE_MODELS: FaceModelDef[] = [
  {
    id: "facenet-128",
    name: "FaceNet-128",
    sizeLabel: "~23 MB",
    inputSize: 160,
    embeddingDim: 128,
    license: "Apache-2.0 repo (weights lineage MIT)",
    notes: "Recommended default — fast, permissive",
    url: "https://raw.githubusercontent.com/shubham0204/FaceRecognition_With_FaceNet_Android/master/app/src/main/assets/facenet.tflite",
    recommended: true,
  },
  {
    id: "facenet-512",
    name: "FaceNet-512",
    sizeLabel: "~24 MB",
    inputSize: 160,
    embeddingDim: 512,
    license: "Apache-2.0 repo (weights lineage MIT)",
    notes: "Same speed, 512 dimensions — separates look-alikes better",
    url: "https://raw.githubusercontent.com/shubham0204/FaceRecognition_With_FaceNet_Android/master/app/src/main/assets/facenet_512.tflite",
  },
];

const ALLOWED_HOSTS = [
  "raw.githubusercontent.com",
  "github.com",
  "objects.githubusercontent.com",
];

// App rule for every model download: https only, allowlisted host, and never
// localhost / loopback / raw IP / private-looking names. The URLs come from
// this catalog, but the check also guards future catalog edits.
export function validateModelUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host.length === 0 || host === "localhost" || host.endsWith(".local")) return false;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false; // raw IPv4
    if (host.includes(":")) return false; // IPv6 literal
    return ALLOWED_HOSTS.includes(host);
  } catch {
    return false;
  }
}

export function modelFilePath(id: string): string {
  return `${FileSystem.documentDirectory}models/${id}.tflite`;
}

export async function isModelDownloaded(id: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(modelFilePath(id));
    return info.exists;
  } catch {
    return false;
  }
}

export async function downloadModel(
  id: string,
  url: string,
  onProgress?: (fraction: number) => void
): Promise<void> {
  if (!validateModelUrl(url)) throw new Error("Model URL failed the safety check.");
  const dest = modelFilePath(id);
  const dir = dest.substring(0, dest.lastIndexOf("/"));
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {}
  const resumable = FileSystem.createDownloadResumable(url, dest, {}, (progress) => {
    if (progress.totalBytesExpectedToWrite > 0) {
      onProgress?.(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
    }
  });
  const result = await resumable.downloadAsync();
  if (!result || result.status !== 200) {
    throw new Error(`Download failed (status ${result?.status ?? "unknown"}).`);
  }
}

export async function deleteModel(id: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(modelFilePath(id), { idempotent: true });
  } catch {}
}
