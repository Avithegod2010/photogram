import type * as FaceDetectionModule from "@react-native-ml-kit/face-detection";

// v0.33+ People & Pets step 1: on-device face detection over the 320px
// thumbnails. Soft-require — the native module only exists after the next
// gradle rebuild; until then detection silently does nothing (the exact OCR /
// smart-tags pattern, so the app can never crash from a missing module).

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

// Returns null when detection is unavailable (module missing / failure) —
// callers must treat null as "not checked" and skip, never as "no faces".
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
    return null;
  }
}
