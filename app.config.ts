/// <reference types="node" />
import type { ExpoConfig } from "expo/config";
import * as fs from "fs";
import * as path from "path";

type TdlibSecrets = {
  apiId: number | null;
  apiHash: string | null;
  google_maps_api_key?: string | null;
};

function loadTdlibSecrets(): TdlibSecrets {
  const secretPath = path.resolve(__dirname, "tdlib.secrets.json");
  if (fs.existsSync(secretPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(secretPath, "utf-8"));
      return {
        apiId: typeof raw.api_id === "number" ? raw.api_id : null,
        apiHash: typeof raw.api_hash === "string" ? raw.api_hash : null,
        google_maps_api_key:
          typeof raw.google_maps_api_key === "string" ? raw.google_maps_api_key : null,
      };
    } catch {
      console.warn("tdlib.secrets.json is malformed — TDLib auth will fail until fixed.");
    }
  } else {
    console.warn(
      "tdlib.secrets.json not found. Copy tdlib.secrets.example.json and add your api_id/api_hash from https://my.telegram.org"
    );
  }
  // Cloud builds (EAS) never see the gitignored file, so the same values can be
  // injected as environment variables (set them as EAS secrets, never commit).
  const envId = Number(process.env.TDLIB_API_ID);
  const envHash = process.env.TDLIB_API_HASH;
  if (Number.isFinite(envId) && envId > 0 && typeof envHash === "string" && envHash.length > 0) {
    return {
      apiId: envId,
      apiHash: envHash,
      google_maps_api_key: process.env.GOOGLE_MAPS_API_KEY || null,
    };
  }
  return { apiId: null, apiHash: null, google_maps_api_key: null };
}

const secrets = loadTdlibSecrets();

const config: ExpoConfig = {
  name: "Photogram",
  slug: "photogram",
  version: "0.54.3",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#101014",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.photogram.app",
  },
  android: {
    package: "com.photogram.app",
    versionCode: 2,
    // Privacy hardening: keep the local photo index (SQLite + thumbnails) out of
    // Google's device backup service.
    allowBackup: false,
    // Audit: a photo app needs no audio access, and the overlay permission is a
    // dev-client-only convenience — strip both from every build (incl. release).
    blockedPermissions: ["android.permission.READ_MEDIA_AUDIO", "android.permission.SYSTEM_ALERT_WINDOW"],
    permissions: ["ACCESS_MEDIA_LOCATION"],
    config: secrets.google_maps_api_key
      ? { googleMaps: { apiKey: secrets.google_maps_api_key } }
      : undefined,
    adaptiveIcon: {
      backgroundColor: "#101014",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: ["expo-sqlite", "expo-quick-actions", "./plugins/withPhotogramWidget"],
  extra: {
    tdlibApiId: secrets.apiId,
    tdlibApiHash: secrets.apiHash,
    // EAS project (cloud builds) — not a secret, safe to commit.
    eas: { projectId: "a4035bbc-d072-419f-abec-1123ff72089a" },
  },
};

export default config;
