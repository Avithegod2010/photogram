# Photogram — Agent Ownership Rules

This folder (`E:\Opencode CLI\Projects\photogram`) is **Photogram**, the TDLib-based app.

- Engine: `react-native-tdlib` — real user account via QR/tap-to-confirm login, media stored in the user's Saved Messages
- Package name: `com.photogram.app`
- Sibling folder: `..\photogram-bot` is a DIFFERENT app (Bot API version) owned by another agent

## Strict rules for ANY AI agent working in this folder

1. **Boundary:** Work ONLY inside this folder. Never read, write, move, or delete anything inside `E:\Opencode CLI\Projects\photogram-bot`.
2. **Protected core** — do not remove or redesign these without asking the user first:
   - `src/lib/tdlib.ts`, `src/lib/qrLink.ts`, `src/auth/authStore.ts`, `src/screens/LoginScreen.tsx`
   - `src/db/schema.ts` + `src/db/index.ts` (SQLite foundation)
   - `app.config.ts` (injects TDLib credentials from gitignored file)
3. **Secrets:** `tdlib.secrets.json` is gitignored on purpose. Never commit it, never copy its contents into code or docs.
4. **Architecture direction:** user account storage via TDLib/Saved Messages. Do NOT migrate this project to the Bot API.
5. **Expo SDK 57:** read exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.
