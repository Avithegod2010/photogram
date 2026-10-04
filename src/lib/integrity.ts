import TdLib from "react-native-tdlib";
import { getMeta, listIntegrityBatch, setMeta } from "../db/queries";

// v0.30 backup integrity: for every "synced" row, ask TDLib whether the
// Telegram message behind it still exists and still carries a file. Answers
// "is my backup really intact?" instead of just "did the app say synced".
//
// Telegram-safety: read-only getMessage calls, throttled (150 ms gap), and
// RESUMABLE — each pass walks at most `budget` rows, the cursor survives app
// kills, and the accumulating report lives in the meta table so the screen
// can show the last result without re-running anything. A transient TDLib
// failure (network/auth) STOPS the pass without advancing the cursor and
// never counts as a broken backup.

const CURSOR_KEY = "integrity_cursor";
const REPORT_KEY = "integrity_report";
const GAP_MS = 150;
const BATCH = 50;
const MAX_ROWS_KEPT = 200;

// The content types a photo/video backup message can legitimately have
// (TDLib classifies small MP4s as messageAnimation — see the restorer notes).
const KNOWN_CONTENT = new Set(["messagePhoto", "messageDocument", "messageAnimation"]);

export interface IntegrityBrokenRow {
  id: number;
  thumb_uri: string;
  file_name: string;
  reason: string;
}

export interface IntegrityReport {
  checked: number;
  verified: number;
  broken: number;
  finishedAt: number | null; // set once the whole library has been walked
  stoppedReason: string | null;
  rows: IntegrityBrokenRow[];
}

function emptyReport(): IntegrityReport {
  return { checked: 0, verified: 0, broken: 0, finishedAt: null, stoppedReason: null, rows: [] };
}

export async function loadIntegrityReport(): Promise<IntegrityReport | null> {
  const raw = await getMeta(REPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as IntegrityReport;
    if (typeof parsed?.checked !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveReport(report: IntegrityReport): Promise<void> {
  await setMeta(REPORT_KEY, JSON.stringify(report));
}

// getMessage's response arrives as JSON (string or object depending on the
// wrapper path) — normalize to an object or null.
function asObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function brokenRow(row: { id: number; thumb_uri: string; file_name: string | null }, reason: string): IntegrityBrokenRow {
  return { id: row.id, thumb_uri: row.thumb_uri, file_name: row.file_name ?? "Untitled", reason };
}

export async function runIntegrityPass(
  onProgress?: (report: IntegrityReport) => void,
  cancelRef?: { cancelled: boolean },
  budget = 400
): Promise<IntegrityReport> {
  let cursor = Number((await getMeta(CURSOR_KEY)) ?? 0);
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  // Cursor at 0 = a fresh pass begins → reset the accumulating report.
  let report = cursor === 0 ? emptyReport() : (await loadIntegrityReport()) ?? emptyReport();
  const openedChats = new Set<number>();
  let processed = 0;
  let stopped = false;

  try {
    while (processed < budget) {
      if (cancelRef?.cancelled) break;
      const batch = await listIntegrityBatch(cursor, BATCH);
      if (batch.length === 0) {
        cursor = 0;
        report.finishedAt = Date.now();
        break;
      }
      for (const row of batch) {
        if (cancelRef?.cancelled) break;
        const chatId = Number(row.remote_chat_id);
        const messageId = Number(row.remote_message_id);
        try {
          // Freshly opened chats return empty history for a few seconds —
          // openChat first, once per chat per run (the notes.ts pattern).
          if (!openedChats.has(chatId)) {
            await TdLib.openChat(chatId);
            openedChats.add(chatId);
          }
          const parsed = asObject(await TdLib.getMessage(chatId, messageId));
          if (!parsed) {
            report.rows.push(brokenRow(row, "no response from Telegram"));
            report.broken++;
          } else if (parsed["@type"] === "error") {
            report.rows.push(brokenRow(row, `Telegram error ${String(parsed.code ?? "?")}`));
            report.broken++;
          } else {
            const content = asObject(parsed.content);
            const type = (content?.["@type"] as string) ?? null;
            if (type && KNOWN_CONTENT.has(type)) {
              report.verified++;
            } else {
              report.rows.push(brokenRow(row, `unexpected content: ${type ?? "none"}`));
              report.broken++;
            }
          }
          report.checked = report.verified + report.broken;
        } catch (err) {
          // Transient failure — the row stays unprocessed (cursor not advanced)
          // and the pass stops; the next Run retries exactly here.
          report.stoppedReason = err instanceof Error ? err.message : "TDLib call failed";
          stopped = true;
          break;
        }
        cursor = row.id;
        processed++;
        await setMeta(CURSOR_KEY, String(cursor));
        if (processed % 20 === 0) await saveReport(report);
        if (processed % 10 === 0) {
          onProgress?.(report);
          await new Promise((resolve) => setTimeout(resolve, GAP_MS));
        }
      }
      if (stopped) break;
      await saveReport(report);
      onProgress?.(report);
    }
  } finally {
    await saveReport(report);
  }
  if (report.rows.length > MAX_ROWS_KEPT) report.rows = report.rows.slice(0, MAX_ROWS_KEPT);
  onProgress?.(report);
  return report;
}
