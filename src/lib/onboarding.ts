import * as MediaLibrary from "expo-media-library/legacy";
import * as Network from "expo-network";
import { mmkv } from "../store/settingsStore";

// v0.47 first-run checklist. Pure decision function is probe-testable; the
// device collectors are thin. The card lives on GalleryScreen and disappears
// the moment every step is done (or the owner taps Dismiss — MMKV onboarding_dismissed).

export const ONBOARDING_DISMISS_KEY = "onboarding_dismissed";

export interface OnboardingFacts {
  permissionGranted: boolean;
  wifiAvailable: boolean;
  firstBackupDone: boolean;
}

export interface OnboardingStep {
  key: string;
  title: string;
  done: boolean;
}

export function listPendingOnboardingSteps(facts: OnboardingFacts): OnboardingStep[] {
  return [
    { key: "access", title: "Allow photo access", done: facts.permissionGranted },
    { key: "wifi", title: "Connect to Wi-Fi (default gate)", done: facts.wifiAvailable },
    {
      key: "backup",
      title: "Run your first backup",
      done: facts.firstBackupDone,
    },
  ];
}

export function shouldShowChecklist(steps: OnboardingStep[], dismissed: boolean): boolean {
  if (dismissed) return false;
  return steps.some((s) => !s.done);
}

export async function collectOnboardingFacts(syncedCount: number): Promise<OnboardingFacts> {
  let permissionGranted = false;
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    permissionGranted = perm.granted && (perm as { accessPrivileges?: string }).accessPrivileges !== "selected";
  } catch {
    permissionGranted = false;
  }
  let wifiAvailable = false;
  try {
    const net = await Network.getNetworkStateAsync();
    wifiAvailable = String(net?.type ?? "").toUpperCase() === "WIFI" && net.isConnected !== false;
  } catch {
    wifiAvailable = false;
  }
  return {
    permissionGranted,
    wifiAvailable,
    firstBackupDone: syncedCount > 0,
  };
}

export function isOnboardingDismissed(): boolean {
  return mmkv.getString(ONBOARDING_DISMISS_KEY) === "1";
}

export function dismissOnboarding(): void {
  mmkv.set(ONBOARDING_DISMISS_KEY, "1");
}
