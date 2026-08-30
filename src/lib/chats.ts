import TdLib from "react-native-tdlib";

// S9 groundwork: list the user's own Telegram group chats so the future
// "Shared album" flow can offer a picker. Uses the same raw
// td_json_client_send → JSON response pattern the uploader relies on
// (getChats returns chat ids; getChat fills in title/type per id).

type TdAny = Record<string, any>;

export interface TelegramGroup {
  id: string; // TEXT-safe: Telegram ids exceed JS safe integers
  title: string;
  kind: "basic" | "supergroup";
  memberCount: number | null;
}

function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

async function sendTd(request: TdAny): Promise<TdAny | null> {
  try {
    const response = await TdLib.td_json_client_send(request);
    if (typeof response !== "string") return null;
    return JSON.parse(response) as TdAny;
  } catch {
    return null;
  }
}

// TDLib may need a moment after startup before getChats returns anything.
async function sendTdWithRetry(request: TdAny, attempts = 3, delayMs = 1500): Promise<TdAny | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const parsed = await sendTd(request);
    if (parsed && parsed["@type"] !== "error") return parsed;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

export async function listMyGroups(): Promise<TelegramGroup[]> {
  const chatIds = await sendTdWithRetry({
    "@type": "getChats",
    chat_list: { "@type": "chatListMain" },
    limit: 100,
  });
  if (!chatIds) return [];

  const ids: Array<string | number> = Array.isArray(chatIds.chat_ids) ? chatIds.chat_ids : [];
  const groups: TelegramGroup[] = [];

  for (const chatId of ids) {
    const chat = await sendTd({ "@type": "getChat", chat_id: Number(chatId) });
    if (!chat) continue;
    const type = chat.type as TdAny | undefined;
    const kind =
      type?.["@type"] === "chatTypeSupergroup"
        ? "supergroup"
        : type?.["@type"] === "chatTypeBasicGroup"
          ? "basic"
          : null;
    if (!kind) continue; // private chats / channels are not shared-album targets
    const memberCount = Number(
      firstDefined(chat.member_count, chat.memberCount, 0)
    );
    groups.push({
      id: String(chat.id),
      title: String(chat.title ?? "Untitled group"),
      kind,
      memberCount: memberCount > 0 ? memberCount : null,
    });
  }

  return groups;
}

const senderNameCache = new Map<string, string>();

// Resolve Telegram user ids to display names for the activity feed (cached).
export async function resolveSenderNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  for (const id of unique) {
    const cached = senderNameCache.get(id);
    if (cached) {
      result.set(id, cached);
      continue;
    }
    const chat = await sendTd({ "@type": "getChat", chat_id: Number(id) });
    const name = chat ? String(firstDefined(chat.title, chat.firstName, chat.first_name, "Someone")) : "Someone";
    senderNameCache.set(id, name);
    result.set(id, name);
  }
  return result;
}
