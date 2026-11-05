import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";

// v0.55 checksum proof.
//
// "Backed up" used to mean "a message with this name exists in Telegram". A
// SHA-256 recorded at scan time and re-checked against the *downloaded* copy
// turns it into "the bytes are identical". Hashing is capped so a 4 GB video
// can never stall a scan or blow the JS heap: anything larger stays unchecked
// and says so, instead of pretending.

export const CHECKSUM_MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export type ChecksumVerdict = "match" | "mismatch" | "unchecked";

export function shouldHash(byteSize: number, mimeType: string | null): boolean {
  if (!Number.isFinite(byteSize) || byteSize <= 0) return false;
  if (byteSize > CHECKSUM_MAX_BYTES) return false;
  // Videos are skipped: base64-ing gigabytes is not a scan-time cost worth
  // paying, and the drill still verifies their size and download.
  if (typeof mimeType === "string" && mimeType.startsWith("video/")) return false;
  return true;
}

export function verifyChecksum(expected: string | null, actual: string | null): ChecksumVerdict {
  const e = (expected ?? "").trim().toLowerCase();
  const a = (actual ?? "").trim().toLowerCase();
  if (e.length === 0 || a.length === 0) return "unchecked";
  return e === a ? "match" : "mismatch";
}

// Hex SHA-256 of a local file, or null when it cannot be read / is too large.
export async function hashLocalFile(uri: string): Promise<string | null> {
  try {
    const file = new File(uri);
    if (!file.exists) return null;
    const size = Number(file.size ?? 0);
    if (size <= 0 || size > CHECKSUM_MAX_BYTES) return null;
    const base64 = await file.base64();
    if (!base64) return null;
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
  } catch {
    return null;
  }
}
