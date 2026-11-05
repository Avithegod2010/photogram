// Stub for the probe: expo-network has a real native module. The uploader's
// Wi-Fi gate reads network state; in the probe there is no Wi-Fi to check, so
// return something that never blocks.
export async function getNetworkStateAsync() {
  return { type: "wifi", isInternetReachable: true, isConnected: true };
}
export async function isInternetReachableAsync() {
  return true;
}
