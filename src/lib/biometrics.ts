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
  if (!hardware || !enrolled) return true;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock hidden photos",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  return result.success;
}
