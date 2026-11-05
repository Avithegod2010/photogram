// @ts-nocheck
// Probe stub for react-native-tdlib: getMessage/openChat are controllable so
// the real integrity.ts engine can be exercised end-to-end (verified / error /
// no-response / transient-throw). Everything else resolves null harmlessly.
const state = {
  responses: new Map<number, unknown>(),
  throwOn: new Set<number>(),
  openChats: new Set<number>(),
};

export default {
  openChat: async (chatId: number) => {
    state.openChats.add(chatId);
    return null;
  },
  getMessage: async (chatId: number, messageId: number) => {
    if (state.throwOn.has(messageId)) throw new Error("probe: TDLib down");
    return state.responses.has(messageId) ? state.responses.get(messageId) : null;
  },
};

export function __setResponse(messageId: number, value: unknown): void {
  state.responses.set(messageId, value);
  state.throwOn.delete(messageId); // a real response replaces the throw too
}
export function __setThrowOn(messageId: number): void {
  state.throwOn.add(messageId);
}
export function __openChatCount(): number {
  return state.openChats.size;
}
