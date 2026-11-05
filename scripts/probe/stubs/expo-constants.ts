// @ts-nocheck
// Probe stub for expo-constants: resolveParameters reads expoConfig.extra —
// never called in the probe, but the module must load.
const Constants = {
  expoConfig: { extra: { tdlibApiId: 1, tdlibApiHash: "probe" }, version: "0.0.0-probe" },
  deviceName: "probe",
  platform: { android: { versionCode: 1 } },
};
export default Constants;
export const expoConfig = Constants.expoConfig;
