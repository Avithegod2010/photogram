import TdLib from "react-native-tdlib";

// S9: list the user's own Telegram group chats so the "Shared album" flow can
// offer a picker. IMPORTANT: this library build's raw td_json_client_send is
// FIRE-AND-FORGET (it resolves "Request sent successfully" and never returns
// the response), so request/response calls MUST use the library's typed
// wrappers (loadChats → getChats → getChat), which register real native
// handlers. Responses are gson JAVA camelCase — read every field through
// firstDefined(camel, snake). Ids stay strings (TEXT-safe: Telegram ids exceed
// JS safe integers).

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

export async function listMyGroups(): Promise<TelegramGroup[]> {
  // TDLib keeps the chat list out of memory until loadChats pulls it from the
  // server; without it a cold start yields an empty list. Its 404 ("end of
  // list") arrives as a rejection — fine to swallow, getChats still reads.
  try {
    await TdLib.loadChats(100);
  } catch {
    // end-of-list or transient hiccup — proceed with whatever is cached
  }

  // Typed getChats resolves a JSON array of FULL chat objects (the native
  // wrapper fetches each chat by id before resolving).
  let chats: TdAny[] = [];
  try {
    const parsed: unknown = JSON.parse(await TdLib.getChats(100));
    if (Array.isArray(parsed)) chats = parsed as TdAny[];
  } catch {
    return [];
  }

  const groups: TelegramGroup[] = [];
  for (const chat of chats) {
    const type = chat?.type as TdAny | undefined;
    const kind =
      type?.["@type"] === "chatTypeSupergroup"
        ? "supergroup"
        : type?.["@type"] === "chatTypeBasicGroup"
          ? "basic"
          : null;
    if (!kind) continue; // private chats / channels are not shared-album targets
    const memberCount = Number(firstDefined(chat.member_count, chat.memberCount, 0));
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
    let name = "Someone";
    try {
      const chat = JSON.parse((await TdLib.getChat(Number(id))).raw) as TdAny;
      name = String(firstDefined(chat.title, chat.firstName, chat.first_name, "Someone"));
    } catch {
      // keep the fallback name
    }
    senderNameCache.set(id, name);
    result.set(id, name);
  }
  return result;
}
