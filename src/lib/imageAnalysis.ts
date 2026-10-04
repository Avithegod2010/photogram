import * as jpeg from "jpeg-js";
import { File } from "expo-file-system";

// F2 shared image-analysis pipeline (docs/PLAN-FEATURES-v0.11-plus.md section 3).
// Pure, synchronous math over grayscale pixel buffers — every threshold is a
// parameter so callers (src/lib/junk.ts) stay tunable. Input thumbnails are the
// scanner's ~320px-wide JPEGs (src/lib/scanner.ts makeThumbnail).

export interface GrayImage {
  gray: Float64Array; // luminance 0..255, row-major
  width: number;
  height: number;
}

// jpeg-js decodes to RGBA by default; we only need luminance. Decoding a 320px
// thumbnail takes tens of milliseconds on-device.
export async function decodeThumbToGray(uri: string): Promise<GrayImage> {
  const file = new File(uri);
  const data = new Uint8Array((await file.arrayBuffer()) as ArrayBuffer);
  const decoded = jpeg.decode(data, {
    useTArray: true,
    tolerantDecoding: true,
    maxMemoryUsageInMB: 64,
  });
  const { width, height } = decoded;
  const gray = new Float64Array(width * height);
  const px = decoded.data;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
  }
  return { gray, width, height };
}

// Variance of the 3x3 Laplacian — the classic sharpness metric. In-focus photos
// have strong edge responses (high variance); blurry ones sit near zero.
export function varianceOfLaplacian(img: GrayImage): number {
  const { gray, width, height } = img;
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export interface LuminanceNoise {
  mean: number; // mean luminance 0..255
  noise: number; // high-frequency energy estimate (mean |3x3 high-pass|)
}

// "Pocket shot" detector inputs: a covered lens gives near-black frames, but
// so does a night scene — the high-frequency energy separates them (real dark
// scenes still have some structure; a lens-under-fabric frame is noisy mush).
export function meanLuminanceAndNoise(img: GrayImage): LuminanceNoise {
  const { gray, width, height } = img;
  const n = gray.length;
  if (n === 0) return { mean: 0, noise: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i];
  const mean = sum / n;

  if (width < 3 || height < 3) return { mean, noise: 0 };
  let hf = 0;
  let m = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const hp = Math.abs(
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      );
      hf += hp;
      m++;
    }
  }
  return { mean, noise: m === 0 ? 0 : hf / m };
}

// --- pHash (32x32 DCT, top-left 8x8 -> 64 bits) ------------------------------

const PHASH_SIZE = 32;
const PHASH_CELLS = 8;

function precomputeDct(n: number): Float64Array[] {
  const table: Float64Array[] = [];
  // Full n-row basis: BOTH transform loops in pHash64 iterate PHASH_SIZE
  // frequencies, so every row must exist (a cell-size table throws there).
  for (let u = 0; u < n; u++) {
    const row = new Float64Array(n);
    for (let x = 0; x < n; x++) {
      row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
    }
    table.push(row);
  }
  return table;
}

const DCT_T = precomputeDct(PHASH_SIZE);

function bilinearResizeGray(img: GrayImage, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const wx = fx - x0;
      const a = img.gray[y0 * img.width + x0];
      const b = img.gray[y0 * img.width + x1];
      const c = img.gray[y1 * img.width + x0];
      const d = img.gray[y1 * img.width + x1];
      out[y * w + x] = a * (1 - wx) * (1 - wy) + b * wx * (1 - wy) + c * (1 - wx) * wy + d * wx * wy;
    }
  }
  return out;
}

// Standard pHash: bilinear-resize to 32x32, 2D DCT via separable matrix rows,
// keep the top-left 8x8 (low frequencies), threshold each cell against the
// median (excluding the DC term).
export function pHash64(img: GrayImage): bigint {
  const small = bilinearResizeGray(img, PHASH_SIZE, PHASH_SIZE);

  // Row transform: S (32x32) * T^T stored row-major.
  const rows = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let y = 0; y < PHASH_SIZE; y++) {
    const src = y * PHASH_SIZE;
    for (let u = 0; u < PHASH_SIZE; u++) {
      const dct = DCT_T[u];
      let acc = 0;
      for (let x = 0; x < PHASH_SIZE; x++) acc += small[src + x] * dct[x];
      rows[y * PHASH_SIZE + u] = acc;
    }
  }
  // Column transform on the frequency axis.
  const coeffs = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let x = 0; x < PHASH_SIZE; x++) {
    for (let v = 0; v < PHASH_SIZE; v++) {
      const dct = DCT_T[v];
      let acc = 0;
      for (let y = 0; y < PHASH_SIZE; y++) acc += rows[y * PHASH_SIZE + x] * dct[y];
      coeffs[v * PHASH_SIZE + x] = acc;
    }
  }

  const cells: number[] = [];
  for (let v = 0; v < PHASH_CELLS; v++) {
    for (let u = 0; u < PHASH_CELLS; u++) cells.push(coeffs[v * PHASH_SIZE + u]);
  }
  // Median over the AC terms (skip index 0, the DC coefficient).
  const ac = cells.slice(1).sort((a, b) => a - b);
  const median = ac[ac.length >> 1];

  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (cells[i] > median) hash |= 1n << BigInt(i);
  }
  return hash;
}

export function hamming64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}
