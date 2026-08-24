import { NativeEventEmitter, NativeModules } from "react-native";
import Constants from "expo-constants";
import TdLib from "react-native-tdlib";

export interface TdUpdate {
  type: string;
  payload: Record<string, unknown>;
}

export class TdError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

type Listener = (update: TdUpdate) => void;

const listeners = new Set<Listener>();
let started = false;

function resolveParameters() {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    tdlibApiId?: number | null;
    tdlibApiHash?: string | null;
  };
  if (typeof extra.tdlibApiId !== "number" || typeof extra.tdlibApiHash !== "string") {
    throw new Error(
      "TDLib credentials missing. Create tdlib.secrets.json (see tdlib.secrets.example.json)."
    );
  }
  return {
    api_id: extra.tdlibApiId,
    api_hash: extra.tdlibApiHash,
    device_model: Constants.deviceName ?? "Photogram",
    system_version: `${Constants.platform?.android?.versionCode ?? ""} android`.trim() || "Android",
    application_version: Constants.expoConfig?.version ?? "0.1.0",
    system_language_code: "en",
  };
}

function parseJsonString(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function ensureTdLibStarted(): Promise<void> {
  if (started) return;
  const emitter = new NativeEventEmitter(NativeModules.TdLibModule as never);
  emitter.addListener("tdlib-update", (event: { type: string; raw: string }) => {
    const payload = parseJsonString(event.raw) ?? {};
    listeners.forEach((listener) => listener({ type: event.type, payload }));
  });
  await TdLib.startTdLib(resolveParameters());
  started = true;
}

export function onUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function sendRaw(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = await TdLib.td_json_client_send(request);
  const response = parseJsonString(raw);
  if (!response) throw new TdError(-1, `Unparseable TDLib response for ${request["@type"]}`);
  if (response["@type"] === "error") {
    throw new TdError(Number(response.code ?? -1), String(response.message ?? "Unknown TDLib error"));
  }
  return response;
}

export async function fetchAuthorizationState(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await TdLib.getAuthorizationState();
    return parseJsonString(raw);
  } catch {
    return null;
  }
}

export async function fetchProfile(): Promise<Record<string, unknown> | null> {
  try {
    let parsed = parseJsonString(await TdLib.getProfile());
    if (parsed && typeof parsed.raw === "string") parsed = parseJsonString(parsed.raw);
    return parsed;
  } catch {
    return null;
  }
}
