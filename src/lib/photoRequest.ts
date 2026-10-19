import { sendRaw } from "./tdlib";

// v0.44 photo requests: a plain text message asking the family for photos.
// replies containing media land in the linked album automatically through the
// normal group-sync claim engine — nothing new to "match": the claimer claims
// every media message in the chat, including answers to the request.

export function composeRequestText(subject: string): string {
  const trimmed = subject.trim().slice(0, 120);
  return trimmed.length > 0
    ? `📷 Photo request: does anyone have photos about "${trimmed}"? Reply with them in this chat and they'll be added to the album automatically.`
    : `📷 Photo request: reply with photos in this chat and they'll be added to the album automatically.`;
}

// Sends the request into the album's Telegram group chat via the raw TDLib
// path (same start/permission machinery as every other call). Throws on
// failure; the caller shows the error.
export async function sendPhotoRequest(chatId: string, subject: string): Promise<void> {
  if (!chatId || chatId.length === 0) throw new Error("The album is not linked to a chat");
  const text = composeRequestText(subject);
  const parsed = await sendRaw({
    "@type": "sendMessage",
    chat_id: Number(chatId),
    input_message_content: {
      "@type": "inputMessageText",
      text: { "@type": "formattedText", text },
    },
  });
  const type = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["@type"] : null;
  if (typeof type === "string" && type.startsWith("error")) {
    throw new Error("Telegram refused the request message");
  }
}
