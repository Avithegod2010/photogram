import TdLib from "react-native-tdlib";

// S9 fast-follow: forum topic helpers (docs/PLAN-S9-TOPICS.md D2).
// IMPORTANT: this library build's raw td_json_client_send is FIRE-AND-FORGET
// (it resolves "Request sent successfully" and never returns the response), so
// every call here goes through the library's typed wrappers, which register
// real native handlers and resolve TdRawResult { raw: string }. Responses are
// gson JAVA camelCase; every field read goes through firstDefined(camel, snake).
// Thread ids are returned as strings (TEXT-safe: Telegram ids exceed JS safe
// integers).

type TdAny = Record<string, any>;

// General topic = Telegram's constant thread id "1" (D2d).
const GENERAL_THREAD_ID = "1";

export interface ForumTopicRef {
  threadId: string; // Telegram message_thread_id as TEXT
  title: string;
  isHidden: boolean;
}

function firstDefined(...values: Array<unknown>): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

// Parses a TdRawResult's raw JSON; null when the wrapper failed or TDLib
// answered with an `error` object.
async function parseRawResult(result: { raw: string } | null): Promise<TdAny | null> {
  if (!result || typeof result.raw !== "string") return null;
  try {
    const parsed = JSON.parse(result.raw) as TdAny;
    if (!parsed || parsed["@type"] === "error") return null;
    return parsed;
  } catch {
    return null;
  }
}

// Only supergroups can have topics (D2a); basic groups, channels and private
// chats return false immediately. Any error also means "not a forum" — the
// caller then uses the non-forum claim path unchanged (D5).
export async function isForumChat(chatId: string): Promise<boolean> {
  try {
    const chat = await parseRawResult(await TdLib.getChat(Number(chatId)));
    const type = chat?.type as TdAny | undefined;
    if (type?.["@type"] !== "chatTypeSupergroup") return false;
    const supergroupId = Number(firstDefined(type.supergroupId, type.supergroup_id));
    if (!Number.isFinite(supergroupId) || supergroupId <= 0) return false;

    const sg = await parseRawResult(await TdLib.getSupergroup(supergroupId));
    return firstDefined(sg?.isForum, sg?.is_forum) === true;
  } catch {
    return false;
  }
}

// Topic list via the patched native getForumTopics wrapper (td_api.tl
// getForumTopics; there is no getForumTopicList). Returns null when TDLib
// could not be read (an `error` response, e.g. the chat is not a forum, or no
// usable reply) — a transient failure, NOT an empty forum: the claimer claims
// flat and retries the split next run, and nothing may be written to the
// cached forum_topics table. Returns [] only for a genuinely empty topic list
// (the claimer legitimately claims flat, no note). On success the General
// thread ("1") is ensured present (D2d) — only here, so a failed read can
// never clobber the cache with a lone General row.
export async function listForumTopics(chatId: string): Promise<ForumTopicRef[] | null> {
  try {
    const parsed = await parseRawResult(await TdLib.getForumTopics(Number(chatId), 100));
    if (!parsed || !Array.isArray(parsed.topics)) return null;
    const raw: TdAny[] = parsed.topics;
    const topics: ForumTopicRef[] = [];
    const seen = new Set<string>();
    for (const t of raw) {
      const info: TdAny = (t?.info as TdAny) ?? {};
      const threadId = String(firstDefined(info.messageThreadId, info.message_thread_id, t?.id, ""));
      if (!threadId || seen.has(threadId)) continue;
      seen.add(threadId);
      topics.push({
        threadId,
        title: String(firstDefined(info.title, "Topic")) || "Topic",
        isHidden: firstDefined(info.isHidden, info.is_hidden) === true,
      });
    }
    // General is ensured only on a successfully read, non-empty list (D2d);
    // an empty list stays [] so a topic-less forum legitimately claims flat.
    if (topics.length > 0 && !seen.has(GENERAL_THREAD_ID)) {
      // TDLib did not report General's real is_hidden here; false keeps the
      // chip visible (worst case an empty General chip shows, never the
      // opposite: hiding an active General topic).
      topics.unshift({ threadId: GENERAL_THREAD_ID, title: "General", isHidden: false });
    }
    return topics;
  } catch (err) {
    console.log("[forum] listForumTopics failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Newest-first page of one topic's history via the typed
// getMessageThreadHistory wrapper (D2c). Message ids come from the loop
// variable in the claimer, so topic attribution never depends on the drifted
// message_thread_id / replyTo message fields here. Contract: null = the fetch
// FAILED (TDLib error or an unreadable payload) — the topic must NOT be
// treated as empty; [] = a genuine success with an empty history (the topic
// exists but has no messages). The claimer uses this distinction to decide
// whether the claim cursor may advance: an empty topic counts as read, a
// failure does not.
export async function fetchThreadMessages(
  chatId: string,
  threadId: string,
  limit = 100
): Promise<TdAny[] | null> {
  try {
    const parsed = await parseRawResult(
      await TdLib.getMessageThreadHistory(Number(chatId), Number(threadId), 0, 0, limit)
    );
    const raw: unknown = firstDefined(parsed?.messages, parsed?.Messages);
    if (!Array.isArray(raw)) return null;
    const messages = raw.filter(
      (m): m is TdAny => !!m && typeof m === "object" && typeof (m as TdAny).id === "number"
    );
    // A non-empty payload whose every entry is unreadable is a failure too —
    // [] must mean "genuinely no messages", never "could not read anything".
    if (messages.length === 0 && raw.length > 0) return null;
    return messages;
  } catch (err) {
    console.log("[forum] fetchThreadMessages failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
