import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import * as jpeg from "jpeg-js";
import type * as FaceDetectionModule from "@react-native-ml-kit/face-detection";
import { FACE_MODELS, isModelDownloaded, modelFilePath } from "./faceModels";
import { useSettingsStore } from "../store/settingsStore";

// v0.33+ People & Pets: on-device face detection + embedding over the 320px
// thumbnails. Both halves are soft-required — the native modules (face
// detection; fast-tflite + nitro for embeddings) only exist after the next
// gradle rebuild, and a missing module must never crash the app.

let faceDetection: typeof FaceDetectionModule.default | null | undefined;
function requireFaceDetection(): typeof FaceDetectionModule.default | null {
  if (faceDetection !== undefined) return faceDetection;
  try {
    const mod = require("@react-native-ml-kit/face-detection") as typeof FaceDetectionModule;
    const fd = mod?.default;
    faceDetection = typeof fd?.detect === "function" ? fd : null;
  } catch {
    faceDetection = null;
  }
  return faceDetection;
}

export interface DetectedFace {
  // Pixel coordinates on the 320px-wide thumbnail (thumbs are uniformly
  // generated, so pixel boxes are consistent across the library).
  x: number;
  y: number;
  w: number;
  h: number;
}

// Returns null ONLY when detection is unavailable (native module missing) —
// callers must treat null as "not checked" and skip without recording.
// A detection failure on one image returns [] ("checked, no faces" sentinel).
export async function detectFaces(uri: string): Promise<DetectedFace[] | null> {
  const fd = requireFaceDetection();
  if (!fd) return null;
  try {
    // minFaceSize 0.05 = a face as small as 5% of the image width (~16px on
    // the thumbnail) — catches people in group shots at a small false-positive
    // cost; clustering quality filters come later.
    const faces = await fd.detect(uri, { performanceMode: "fast", minFaceSize: 0.05 });
    return (faces ?? [])
      .map((face) => ({
        x: Number(face?.frame?.left ?? 0),
        y: Number(face?.frame?.top ?? 0),
        w: Number(face?.frame?.width ?? 0),
        h: Number(face?.frame?.height ?? 0),
      }))
      .filter((f) => f.w > 0 && f.h > 0);
  } catch {
    return [];
  }
}

// --- embeddings (People & Pets step 2) -----------------------------------------

interface Embedder {
  runSync: (inputs: ArrayBuffer[]) => ArrayBuffer[];
  inputSize: number;
  embeddingDim: number;
}

let embedder: Embedder | null = null;
let embedderFor: string | null = null;

// Loads the downloaded model through react-native-fast-tflite (Nitro). Null
// when no model is chosen/downloaded or the native module is missing.
async function ensureEmbedder(): Promise<Embedder | null> {
  const modelId = useSettingsStore.getState().faceModelId;
  if (!modelId) return null;
  if (embedder && embedderFor === modelId) return embedder;
  if (!(await isModelDownloaded(modelId))) return null;
  const def = FACE_MODELS.find((m) => m.id === modelId);
  if (!def) return null;
  try {
    const mod = require("react-native-fast-tflite") as {
      loadTensorflowModel?: (source: { url: string }, delegates: string[]) => Promise<{
        runSync: (inputs: ArrayBuffer[]) => ArrayBuffer[];
      }>;
    };
    if (typeof mod?.loadTensorflowModel !== "function") return null;
    const model = await mod.loadTensorflowModel({ url: modelFilePath(modelId) }, []);
    embedder = {
      runSync: (inputs) => model.runSync(inputs),
      inputSize: def.inputSize,
      embeddingDim: def.embeddingDim,
    };
    embedderFor = modelId;
    return embedder;
  } catch {
    embedder = null;
    return null;
  }
}

// The exact preprocessing the FaceNet model expects (verified against the
// repo's FaceNetModel.kt): bilinear-resize happens in the crop below, then a
// PER-IMAGE standardization x' = (x - mean) / max(std, 1/sqrt(N)) over every
// RGB value of the image — NOT the common (x - 127.5) / 128.
export function rgbaToModelInput(rgba: Uint8Array, size: number): Float32Array {
  const rgb = new Float32Array(new ArrayBuffer(size * size * 3 * 4));
  const n = size * size;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    rgb[i * 3] = rgba[p];
    rgb[i * 3 + 1] = rgba[p + 1];
    rgb[i * 3 + 2] = rgba[p + 2];
  }
  let sum = 0;
  for (let i = 0; i < rgb.length; i++) sum += rgb[i];
  const mean = sum / rgb.length;
  let sq = 0;
  for (let i = 0; i < rgb.length; i++) {
    const d = rgb[i] - mean;
    sq += d * d;
  }
  const std = Math.max(Math.sqrt(sq / rgb.length), 1 / Math.sqrt(rgb.length));
  for (let i = 0; i < rgb.length; i++) rgb[i] = (rgb[i] - mean) / std;
  return rgb;
}

// Embeddings are stored as little-endian float32 BLOBs.
export function f32ToBytes(f32: Float32Array): Uint8Array {
  const out = new Uint8Array(f32.length * 4);
  new Float32Array(out.buffer).set(f32);
  return out;
}

export function bytesToF32(bytes: Uint8Array): Float32Array {
  // DataView.getFloat32 decodes the stored bits — an int32 read via `|` and
  // assigned into a Float32Array would store the INTEGER, not the float.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const f32 = new Float32Array(bytes.length / 4);
  for (let i = 0; i < f32.length; i++) f32[i] = view.getFloat32(i * 4, true);
  return f32;
}

// Crop the face box out of the thumbnail, resize to the model's input size,
// preprocess and run the model. Null = embedder unavailable or the crop/model
// failed for this face (the caller records a "tried, failed" sentinel).
export async function embedFace(
  thumbUri: string,
  box: { x: number; y: number; w: number; h: number },
  modelId: string
): Promise<Float32Array | null> {
  const embedder = await ensureEmbedder();
  if (!embedder) return null;
  try {
    const context = ImageManipulator.manipulate(thumbUri)
      .crop({
        originX: Math.max(0, Math.floor(box.x)),
        originY: Math.max(0, Math.floor(box.y)),
        width: Math.max(1, Math.round(box.w)),
        height: Math.max(1, Math.round(box.h)),
      })
      .resize({ width: embedder.inputSize, height: embedder.inputSize });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 85, format: SaveFormat.JPEG });
    const bytes = new Uint8Array(await new File(saved.uri).arrayBuffer());
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      tolerantDecoding: true,
      maxMemoryUsageInMB: 64,
    });
    const input = rgbaToModelInput(decoded.data, embedder.inputSize);
    const outputs = embedder.runSync([input.buffer as ArrayBuffer]);
    const out = new Float32Array(outputs[0]);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
