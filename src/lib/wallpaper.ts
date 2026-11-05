import { File, Paths } from "expo-file-system";
import { listWallpaperCandidates } from "../db/queries";
import { useSettingsStore } from "../store/settingsStore";

// v0.55 wallpaper rotation (JS half).
//
// The native side (WallpaperRotation.kt, written by the config plugin) owns the
// scheduling: a daily AlarmManager tick + a boot receiver. JS only describes
// WHICH photos to use by writing files/wallpaper_config.json, which keeps the
// feature working while the app is closed and needs no JS bridge.
//
// Only favourites with a local file qualify - a cloud-only row would make the
// service download on a timer, which is not what "wallpaper" should do.

export const WALLPAPER_CONFIG_FILE = "wallpaper_config.json";
export const MAX_WALLPAPER_PATHS = 50;

export interface WallpaperConfig {
  enabled: boolean;
  paths: string[];
}

export function buildWallpaperConfig(
  rows: Array<{ local_uri: string | null; taken_at: number }>,
  enabled: boolean
): WallpaperConfig {
  // Disabled means "store nothing": no stale paths on disk, and re-enabling
  // writes a fresh list anyway.
  if (!enabled) return { enabled: false, paths: [] };
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const row of rows) {
    const uri = (row.local_uri ?? "").trim();
    if (uri.length === 0) continue;
    if (!uri.startsWith("/")) continue; // Android file paths only; no content://
    if (seen.has(uri)) continue;
    seen.add(uri);
    paths.push(uri);
    if (paths.length >= MAX_WALLPAPER_PATHS) break;
  }
  return { enabled: enabled && paths.length > 0, paths };
}

export function configFile(): File {
  return new File(Paths.document, WALLPAPER_CONFIG_FILE);
}

// Never throws: a failed write just means the native side keeps the old list.
export async function syncWallpaperConfig(): Promise<boolean> {
  try {
    const enabled = useSettingsStore.getState().wallpaperRotation;
    const rows = enabled ? await listWallpaperCandidates(MAX_WALLPAPER_PATHS * 2) : [];
    const config = buildWallpaperConfig(rows, enabled);
    const file = configFile();
    if (file.exists) file.delete();
    file.create();
    file.write(new TextEncoder().encode(JSON.stringify(config)));
    return true;
  } catch {
    return false;
  }
}
