// Probe stub for expo-crypto (native module is unavailable in Node).
// Deterministic fake digest is enough: the probe only checks the *comparison*
// logic (verifyChecksum), never real cryptographic strength.
export const CryptoDigestAlgorithm = {
  SHA256: "SHA-256",
  SHA1: "SHA-1",
  MD5: "MD5",
} as const;

export type CryptoDigestAlgorithmValue =
  (typeof CryptoDigestAlgorithm)[keyof typeof CryptoDigestAlgorithm];

// expo-crypto also exports digest(algorithm, data: Uint8Array).
export async function digest(
  _algorithm: CryptoDigestAlgorithmValue,
  data: Uint8Array
): Promise<string> {
  let text = "";
  for (let i = 0; i < data.length; i++) text += String.fromCharCode(data[i]);
  return digestStringAsync(_algorithm, text);
}

export async function digestStringAsync(
  _algorithm: CryptoDigestAlgorithmValue,
  data: string
): Promise<string> {
  // FNV-1a expanded to 64 hex chars — stable per input, no crypto claims.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(4);
}
