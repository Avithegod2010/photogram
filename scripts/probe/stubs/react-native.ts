// @ts-nocheck
// Probe stub for react-native: just enough module surface to LOAD the chain.
export const NativeModules = {};
export class NativeEventEmitter {
  constructor(_mod?: unknown) {}
  addListener() {
    return { remove() {} };
  }
  removeAllListeners() {}
  listenerCount() {
    return 0;
  }
}
export const Platform = { select: (o) => o?.default ?? o?.android, OS: "android" };
export const DeviceEventEmitter = { addListener() { return { remove() {} }; }, emit() {} };
export const PixelRatio = { get: () => 2, getPixelSizeForLayoutSize: (v) => v * 2 };
export const StyleSheet = { create: (s) => s, flatten: (s) => s, absoluteFill: {}, absoluteFillObject: {} };
export const Alert = { alert() {} };
export const View = () => null;
export const Text = () => null;
export const AppRegistry = { registerComponent() {}, registerRunnable() {}, runApplication() {} };
export const LogBox = { ignoreAllLogs() {}, ignoreLogs() {}, install() {}, clearAllLogs() {}, warn() {} };
export const TurboModuleRegistry = {
  get: () => undefined,
  getEnforcing: () => undefined,
  has: () => false,
};
export default { NativeModules, NativeEventEmitter, Platform, DeviceEventEmitter, PixelRatio, StyleSheet, TurboModuleRegistry, AppRegistry, LogBox };
