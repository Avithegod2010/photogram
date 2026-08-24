import { File } from "expo-file-system";
import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { getDb } from "../db";

export interface FileFingerprintInput {
  byteSize: number;
  modifiedAtMs: number;
  fileName: string;
}

const CONTENT_SAMPLE_BYTES = 64 * 1024;

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function quickFingerprint(input: FileFingerprintInput): string {
  return `${input.byteSize}:${input.modifiedAtMs}:${fnv1a(input.fileName)}`;
}

export async function findDuplicate(
  fingerprint: string
): Promise<{ id: number; state: string } | null> {
  const db = await getDb();
  return (
    db.getFirstAsync<{ id: number; state: string }>(
      "SELECT id, state FROM media WHERE fingerprint = ? LIMIT 1",
      [fingerprint]
    ) ?? null
  );
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function readSampleBytes(
  file: File,
  offsetBytes: number,
  lengthBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const blob = file.slice(offsetBytes, offsetBytes + lengthBytes);
    return new Uint8Array((await blob.arrayBuffer()) as ArrayBuffer);
  } catch {
    return new Uint8Array(0);
  }
}

export async function computeContentHash(fileUri: string, byteSize: number): Promise<string> {
  const file = new File(fileUri);
  const encoder = new TextEncoder();
  const prefix = encoder.encode(`${byteSize}|`);
  const head = await readSampleBytes(file, 0, Math.min(byteSize, CONTENT_SAMPLE_BYTES));
  let tail = new Uint8Array(0);
  if (byteSize > CONTENT_SAMPLE_BYTES) {
    tail = await readSampleBytes(file, byteSize - CONTENT_SAMPLE_BYTES, CONTENT_SAMPLE_BYTES);
  }
  const combined = new Uint8Array(prefix.length + head.length + tail.length);
  combined.set(prefix, 0);
  combined.set(head, prefix.length);
  combined.set(tail, prefix.length + head.length);
  const digestBuffer = await digest(CryptoDigestAlgorithm.SHA256, combined);
  return toHex(digestBuffer);
}
