import { create } from "zustand";
import { Linking } from "react-native";
import TdLib from "react-native-tdlib";
import {
  TdError,
  ensureTdLibStarted,
  fetchAuthorizationState,
  onUpdate,
  sendRaw,
} from "../lib/tdlib";
import { buildQrLinks, QrLinks } from "../lib/qrLink";

export type AuthPhase =
  | "booting"
  | "choose"
  | "qr"
  | "phone"
  | "code"
  | "password"
  | "ready"
  | "fatal";

interface AuthState {
  phase: AuthPhase;
  busy: boolean;
  error: string | null;
  qrLinks: QrLinks | null;
  boot: () => Promise<void>;
  beginQrLogin: () => Promise<void>;
  usePhoneInstead: () => void;
  submitPhone: (fullNumber: string) => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  submitPassword: (password: string) => Promise<void>;
  openTelegramHandoff: () => Promise<void>;
  clearError: () => void;
}

function phaseFromStateType(stateType: string): Partial<AuthState> | null {
  switch (stateType) {
    case "authorizationStateWaitPhoneNumber":
      return { phase: "choose", busy: false };
    case "authorizationStateWaitCode":
      return { phase: "code", busy: false };
    case "authorizationStateWaitPassword":
      return { phase: "password", busy: false };
    case "authorizationStateWaitRegistration":
      return {
        phase: "fatal",
        busy: false,
        error:
          "Photogram needs an existing Telegram account. Please register inside the Telegram app first.",
      };
    case "authorizationStateReady":
      return { phase: "ready", busy: false, error: null };
    case "authorizationStateLoggingOut":
    case "authorizationStateClosing":
    case "authorizationStateClosed":
      return { phase: "booting", busy: true };
    default:
      return null;
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  phase: "booting",
  busy: true,
  error: null,
  qrLinks: null,

  boot: async () => {
    set({ phase: "booting", busy: true, error: null });
    try {
      await ensureTdLibStarted();
      onUpdate((update) => {
        if (update.type !== "updateAuthorizationState") return;
        const auth = update.payload.authorization_state as
          | Record<string, unknown>
          | undefined;
        const stateType = String(auth?.["@type"] ?? "");
        const mapped = phaseFromStateType(stateType);
        if (mapped) set(mapped);
        if (
          stateType === "authorizationStateWaitOtherDeviceConfirmation" &&
          typeof auth?.link === "string"
        ) {
          set({ qrLinks: buildQrLinks(auth.link), phase: "qr", busy: false });
        }
      });
      const current = await fetchAuthorizationState();
      const stateType = String(current?.["@type"] ?? "");
      if (stateType === "authorizationStateReady") {
        set({ phase: "ready", busy: false });
      } else if (stateType === "authorizationStateWaitOtherDeviceConfirmation") {
        const link = typeof current?.link === "string" ? current.link : "";
        if (link) set({ qrLinks: buildQrLinks(link), phase: "qr", busy: false });
        else set({ phase: "choose", busy: false });
      } else {
        const mapped = stateType ? phaseFromStateType(stateType) : null;
        set(mapped ?? { phase: "choose", busy: false });
      }
    } catch (err) {
      set({
        phase: "fatal",
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  beginQrLogin: async () => {
    set({ busy: true, error: null });
    try {
      await sendRaw({ "@type": "requestQrCodeAuthentication" });
    } catch (err) {
      set({
        busy: false,
        error:
          err instanceof TdError && err.code === 8
            ? "A login attempt was rate limited. Try again in a moment."
            : err instanceof Error
              ? err.message
              : String(err),
      });
    }
  },

  usePhoneInstead: () => {
    set({ phase: "phone", busy: false, error: null, qrLinks: null });
  },

  submitPhone: async (fullNumber) => {
    const trimmed = fullNumber.replace(/[^\d+]/g, "");
    if (trimmed.length < 6) {
      set({ error: "Enter a full phone number including country code." });
      return;
    }
    set({ busy: true, error: null });
    try {
      const match = trimmed.match(/^(\+\d{1,3})(\d+)$/);
      const countrycode = match ? match[1] : "+" + trimmed.slice(0, 2);
      const phoneNumber = match ? match[2] : trimmed.slice(2);
      await TdLib.login({ countrycode, phoneNumber });
    } catch (err) {
      set({ busy: false, error: describeError(err) });
    }
  },

  submitCode: async (code) => {
    const digits = code.replace(/\D/g, "");
    if (digits.length < 4) {
      set({ error: "Enter the code Telegram sent you." });
      return;
    }
    set({ busy: true, error: null });
    try {
      await TdLib.verifyPhoneNumber(digits);
    } catch (err) {
      set({ busy: false, error: describeError(err) });
    }
  },

  submitPassword: async (password) => {
    if (!password) {
      set({ error: "Enter your two-step verification password." });
      return;
    }
    set({ busy: true, error: null });
    try {
      await TdLib.verifyPassword(password);
    } catch (err) {
      set({ busy: false, error: describeError(err) });
    }
  },

  openTelegramHandoff: async () => {
    const link = get().qrLinks?.handoffUrl;
    if (!link) return;
    try {
      await Linking.openURL(link);
    } catch {
      set({ error: "Couldn't open the Telegram app. Scan the QR with another device instead." });
    }
  },

  clearError: () => set({ error: null }),
}));

function describeError(err: unknown): string {
  if (err instanceof TdError) {
    if (/PHONE_NUMBER_INVALID/i.test(err.message)) return "That phone number doesn't look valid.";
    if (/PHONE_CODE_INVALID/i.test(err.message)) return "Wrong code. Check Telegram and try again.";
    if (/PASSWORD_HASH_INVALID/i.test(err.message)) return "Wrong password. Try again.";
    if (/FLOOD/i.test(err.message)) return "Too many attempts. Wait a bit and retry.";
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
