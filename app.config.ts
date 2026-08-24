/// <reference types="node" />
import type { ExpoConfig } from "expo/config";
import * as fs from "fs";
import * as path from "path";

type TdlibSecrets = { apiId: number | null; apiHash: string | null };

function loadTdlibSecrets(): TdlibSecrets {
  const secretPath = path.resolve(__dirname, "tdlib.secrets.json");
  if (fs.existsSync(secretPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(secretPath, "utf-8"));
      return {
        apiId: typeof raw.api_id === "number" ? raw.api_id : null,
        apiHash: typeof raw.api_hash === "string" ? raw.api_hash : null,
      };
    } catch {
      console.warn("tdlib.secrets.json is malformed — TDLib auth will fail until fixed.");
    }
  } else {
    console.warn(
      "tdlib.secrets.json not found. Copy tdlib.secrets.example.json and add your api_id/api_hash from https://my.telegram.org"
    );
  }
  return { apiId: null, apiHash: null };
}

const secrets = loadTdlibSecrets();

const config: ExpoConfig = {
  name: "Photogram",
  slug: "photogram",
  version: "0.1.0",
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
    versionCode: 1,
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
  plugins: ["expo-sqlite"],
  extra: {
    tdlibApiId: secrets.apiId,
    tdlibApiHash: secrets.apiHash,
  },
};

export default config;
