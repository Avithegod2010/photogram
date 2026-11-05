// @ts-nocheck
// Probe stub for expo-file-system/legacy: download helpers are only exercised
// on-device; the probe tests the catalog + URL validation, so the legacy
// module just needs to load and report "not downloaded".
export const documentDirectory = "/probe-docs/";
export const cacheDirectory = "/probe-cache/";

let fileExists = false;
export function __setLegacyFileExists(v: boolean): void {
  fileExists = v;
}
export async function getInfoAsync(uri) {
  return { exists: fileExists, uri };
}
export async function makeDirectoryAsync() {}
export async function deleteAsync() {}
export function createDownloadResumable() {
  return { downloadAsync: async () => ({ uri: "", status: 0 }) };
}
export async function downloadAsync() {
  return { uri: "", status: 0 };
}
