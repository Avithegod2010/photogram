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

export async function unlockHiddenAlbum(): Promise<boolean> {
  const { hardware, enrolled } = await canUseBiometrics();
  // Deliberate fail-OPEN (audit round 2, deferred): with no enrolled biometric
  // there is nothing to authenticate against, and failing closed would lock the
  // owner out of their own Hidden album on such a device. Only a local privacy
  // gate — an attacker holding the unlocked phone can read the DB directly — so
  // the trade-off is accepted. Revisit only with device testing.
  if (!hardware || !enrolled) return true;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock hidden photos",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  return result.success;
}
