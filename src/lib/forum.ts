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

// General topic = Telegram's constant thread id "1" as reported by the server
// (forumTopicInfo.forumTopicId). getForumTopicHistory addresses topics by that
// same id, so one constant serves both display and history fetches.
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
    if (type?.["@type"] !== "chatTypeSupergroup") {
      console.log(`[forum] isForumChat(${chatId}): chat type=${type?.["@type"] ?? "null"}`);
      return false;
    }
    const supergroupId = Number(firstDefined(type.supergroupId, type.supergroup_id));
    if (!Number.isFinite(supergroupId) || supergroupId <= 0) {
      console.log(`[forum] isForumChat(${chatId}): bad supergroupId=${supergroupId}`);
      return false;
    }

    const sg = await parseRawResult(await TdLib.getSupergroup(supergroupId));
    const isForum = firstDefined(sg?.isForum, sg?.is_forum) === true;
    console.log(`[forum] isForumChat(${chatId}): supergroupId=${supergroupId} sg=${sg ? "ok" : "null"} isForum=${isForum}`);
    return isForum;
  } catch (err) {
    console.log(`[forum] isForumChat(${chatId}) threw:`, err instanceof Error ? err.message : err);
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
    // TDLib loads a chat's topic list lazily: right after openChat on a cold
    // chat, getForumTopics can legitimately answer forumTopics with an EMPTY
    // array while the server sync is still in flight (observed live: 0 topics
    // on a 4-topic group). An empty first answer is therefore retried briefly
    // before being accepted — a topic-less forum still terminates after the
    // same bounded window, just ~3s later.
    const EMPTY_RETRIES = 3;
    const EMPTY_RETRY_DELAY_MS = 1200;
    let parsed: TdAny | null = null;
    let emptyRuns = 0;
    while (true) {
      const result = await TdLib.getForumTopics(Number(chatId), 100);
      parsed = await parseRawResult(result);
      if (!parsed || !Array.isArray(parsed.topics)) {
        console.log(`[forum] listForumTopics(${chatId}): no topics array — raw=${String(result?.raw?.slice(0, 300))}`);
        return null;
      }
      if (parsed.topics.length > 0 || emptyRuns >= EMPTY_RETRIES) break;
      emptyRuns++;
      console.log(`[forum] TOPICLIST ${chatId} empty (lazy sync), retry ${emptyRuns}/${EMPTY_RETRIES}`);
      await new Promise((resolve) => setTimeout(resolve, EMPTY_RETRY_DELAY_MS));
    }
    const raw: TdAny[] = parsed.topics;
    const topics: ForumTopicRef[] = [];
    const seen = new Set<string>();
    for (const t of raw) {
      const info: TdAny = (t?.info as TdAny) ?? {};
      // gson JAVA names: ForumTopicInfo{forumTopicId, name, isHidden} — the wire
      // names (message_thread_id/title) never appear in this library's output.
      const threadId = String(firstDefined(info.forumTopicId, info.forum_topic_id, t?.id, ""));
      if (!threadId || threadId === "0" || seen.has(threadId)) continue;
      seen.add(threadId);
      topics.push({
        threadId,
        title: String(firstDefined(info.name, info.title, "Topic")) || "Topic",
        isHidden: firstDefined(info.isHidden, info.is_hidden) === true,
      });
    }
    // General is ensured only on a successfully read, non-empty list (D2d);
    // an empty list stays [] so a topic-less forum legitimately claims flat.
    // The server reports General with forumTopicId=1; getForumTopicHistory
    // addresses topics by that id, so no remapping is needed.
    if (topics.length > 0 && !seen.has(GENERAL_THREAD_ID)) {
      // TDLib did not report General's real is_hidden here; false keeps the
      // chip visible (worst case an empty General chip shows, never the
      // opposite: hiding an active General topic).
      topics.unshift({ threadId: GENERAL_THREAD_ID, title: "General", isHidden: false });
    }
    // Concise diagnostics: the parsed topic list (raw dump was removed after
    // the gson field-name debugging that found forumTopicId/name).
    console.log(`[forum] TOPICLIST ${chatId} count=${topics.length} [${topics.map((t) => `${t.title}#${t.threadId}`).join(", ")}]`);
    return topics;
  } catch (err) {
    console.log("[forum] listForumTopics failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Newest-first page of one topic's history via the typed getForumTopicHistory
// wrapper (D2c — addresses topics by forumTopicId directly; the earlier
// getMessageThreadHistory route needed each topic's root message pre-loaded and
// 400'd "Message not found" on cold chats). Message ids come from the loop
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
      await TdLib.getForumTopicHistory(Number(chatId), Number(threadId), 0, 0, limit)
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
