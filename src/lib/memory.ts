import { AppState } from "react-native";
import { Image } from "expo-image";

/**
 * Memory housekeeping for the media screens.
 *
 * The 2026-11-15 crash was a `java.lang.OutOfMemoryError` inside ExoPlayer at the
 * 268 MB heap limit after ~18 minutes of navigation: decoded full-screen bitmaps
 * plus several live video players. Native players are released on unmount, but
 * decoded images stay in expo-image's memory cache until something trims it.
 *
 * This drops that cache at the two moments where re-decoding costs nothing the
 * user is looking at: when the app leaves the foreground, and when the Viewer
 * closes. The disk cache is untouched, so pictures still appear instantly — they
 * are just decoded from disk again instead of held as bitmaps.
 */
export async function trimImageMemoryCache(): Promise<void> {
  try {
    await Image.clearMemoryCache();
  } catch {
    // Trimming is best-effort: a failure must never affect what is on screen.
  }
}

/** Trims the image cache whenever the app goes to the background. */
export function startMemoryHygiene(): () => void {
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "background") void trimImageMemoryCache();
  });
  return () => sub.remove();
}
