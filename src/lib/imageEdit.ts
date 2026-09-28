import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import jpeg from "jpeg-js";
import { Directory, File, Paths } from "expo-file-system";

// v0.19 Photo editor lite: rotate (90° steps) + crop + brightness/contrast/
// saturation. Geometry runs through expo-image-manipulator (already native);
// the color pass is pure JS over jpeg-js pixels — no new native modules, no
// rebuild. Working resolution caps at 2048 long edge (matches storage-saver);
// originals are never re-encoded — an edit becomes its own media row.

export interface EditAdjustments {
  rotation: 0 | 90 | 180 | 270;
  // Normalized (0..1) rect relative to the ROTATED image frame.
  crop: { x: number; y: number; width: number; height: number } | null;
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
}

export interface EditRenderResult {
  uri: string;
  width: number;
  height: number;
  byteSize: number;
}

function editsDir(): Directory {
  const dir = new Directory(Paths.document, "edits");
  if (!dir.exists) dir.create();
  return dir;
}

function hasColorAdjustments(adj: EditAdjustments): boolean {
  return adj.brightness !== 0 || adj.contrast !== 0 || adj.saturation !== 0;
}

// Geometry only: rotate → crop (px on the rotated frame) → cap long edge.
async function transformStage(
  sourceUri: string,
  adj: EditAdjustments,
  sourceWidth: number,
  sourceHeight: number,
  maxDim: number
): Promise<{ uri: string; width: number; height: number }> {
  let man = ImageManipulator.manipulate(sourceUri);
  if (adj.rotation !== 0) man = man.rotate(adj.rotation);

  const rotatedW = adj.rotation % 180 === 0 ? sourceWidth : sourceHeight;
  const rotatedH = adj.rotation % 180 === 0 ? sourceHeight : sourceWidth;

  let width = rotatedW;
  let height = rotatedH;
  if (adj.crop) {
    width = Math.max(1, Math.round(adj.crop.width * rotatedW));
    height = Math.max(1, Math.round(adj.crop.height * rotatedH));
    man = man.crop({
      originX: Math.max(0, Math.round(adj.crop.x * rotatedW)),
      originY: Math.max(0, Math.round(adj.crop.y * rotatedH)),
      width,
      height,
    });
  }

  const longEdge = Math.max(width, height);
  if (longEdge > maxDim) {
    if (width >= height) {
      man = man.resize({ width: maxDim });
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      man = man.resize({ height: maxDim });
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const rendered = await man.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  return { uri: saved.uri, width, height };
}

// Brightness → contrast → saturation, clamped per channel.
function applyColorPass(
  px: Uint8Array,
  brightness: number,
  contrast: number,
  saturation: number
): void {
  const bOffset = brightness * 2.55;
  const c255 = contrast * 2.55;
  const cFactor = (259 * (c255 + 255)) / (255 * (259 - c255));
  const sAmount = 1 + saturation / 100;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] + bOffset;
    let g = px[i + 1] + bOffset;
    let b = px[i + 2] + bOffset;
    r = cFactor * (r - 128) + 128;
    g = cFactor * (g - 128) + 128;
    b = cFactor * (b - 128) + 128;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sAmount;
    g = gray + (g - gray) * sAmount;
    b = gray + (b - gray) * sAmount;
    px[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    px[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    px[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

// Renders an edited copy of the photo.
// - preview: true → small fast pass over the 320px thumbnail (UI live preview),
//   written to a stable cache path so <Image> can reload it with a cache-buster.
// - preview: false → full pipeline at ≤ 2048 px, written to document/edits/.
export async function renderEdit(
  sourceUri: string,
  thumbUri: string | null,
  sourceWidth: number,
  sourceHeight: number,
  adj: EditAdjustments,
  preview: boolean
): Promise<EditRenderResult> {
  const maxDim = preview ? 640 : 2048;
  const stage = await transformStage(
    preview && thumbUri ? thumbUri : sourceUri,
    adj,
    sourceWidth,
    sourceHeight,
    maxDim
  );

  if (!hasColorAdjustments(adj)) {
    return { uri: stage.uri, width: stage.width, height: stage.height, byteSize: 0 };
  }

  const raw = jpeg.decode(
    new Uint8Array((await new File(stage.uri).arrayBuffer()) as ArrayBuffer),
    { useTArray: true, tolerantDecoding: true, maxMemoryUsageInMB: 128 }
  );
  applyColorPass(raw.data, adj.brightness, adj.contrast, adj.saturation);
  const out = jpeg.encode(raw, 92);

  const outPath = preview ? `preview.jpg` : `edit-${Date.now()}.jpg`;
  const file = new File(editsDir(), outPath);
  if (file.exists) file.delete();
  file.create();
  file.write(out.data);

  return {
    uri: file.uri,
    width: raw.width,
    height: raw.height,
    byteSize: out.data.length,
  };
}
