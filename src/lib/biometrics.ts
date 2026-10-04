import * as LocalAuthentication from "expo-local-authentication";

export async function canUseBiometrics(): Promise<{
  hardware: boolean;
  enrolled: boolean;
}> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return { hardware, enrolled };
  } catch {
    return { hardware: false, enrolled: false };
  }
}

// v0.28: generic gate for any locked album (and Hidden via the wrapper below).
// Deliberate fail-OPEN (audit round 2, deferred): with no enrolled biometric
// there is nothing to authenticate against, and failing closed would lock the
// owner out of their own content on such a device. Only a local privacy
// gate — an attacker holding the unlocked phone can read the DB directly — so
// the trade-off is accepted. Revisit only with device testing.
export async function authenticateLocal(promptMessage: string): Promise<boolean> {
  const { hardware, enrolled } = await canUseBiometrics();
  if (!hardware || !enrolled) return true;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  return result.success;
}

export async function unlockHiddenAlbum(): Promise<boolean> {
  return authenticateLocal("Unlock hidden photos");
}
