import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { getDb } from "../db";
import { quickFingerprint } from "./dedupe";

// v0.39 export follow-up 2: import a Photogram manifest (JSON) on a new
// install. The manifest is the JSON this app's Export screen produces — rows
// carry taken_at ISO dates, Telegram chat/message ids, tags, notes, and
// (optionally) face samples. Import is ADDITIVE with dry-run gating:
//  - rows whose remote ids are already known are counted as duplicates;
//  - rows whose fingerprint (size+date+name) collides are skipped the
//    scanner's way;
//  - everything else becomes a new cloud-only row (state 'synced',
//    thumb '' — the SAME idempotent path rehydrate.ts uses, so Restore and
//    the migration screens natively pick these rows up).
// Photos are NEVER faked: a row without a real Telegram message will simply
// fail restore later, exactly like a deleted backup — the dry-run summary is
// the contract the owner sees before anything is written.

export type { DocumentPickerAsset } from "expo-document-picker";

const MIN_ROW_LIMIT = 20000;

export interface ImportRow {
  id: number | string;
  file_name: string | null;
  mime_type: string;
  byte_size: number;
  taken_at: string;
  uploaded_at?: string | null;
  state?: string;
  visibility?: string;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  place_name?: string | null;
  ml_labels?: string | null;
  user_tags?: string | null;
  ocr_text?: string | null;
  note_text?: string | null;
  phash?: string | null;
  fingerprint?: string | null; // exported when the source exported it (v0.39+)
  edited_from?: number | null;
  remote_chat_id?: string | null;
  remote_message_id?: string | null;
  media_library_id?: string | null;
}

export interface ParsedManifest {
  format: string;
  version: number;
  rows: ImportRow[];
}

export function parseManifest(text: string): ParsedManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const m = parsed as Record<string, unknown>;
  if (m.format !== "photogram-export" || typeof m.version !== "number") return null;
  if (!Array.isArray(m.media)) return null;
  const rows = (m.media as unknown as ImportRow[]).slice(0, MIN_ROW_LIMIT);
  return { format: String(m.format), version: m.version, rows: rows as ImportRow[] };
}

export async function pickManifestFile(): Promise<{ name: string; text: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: "application/json",
    copyToCacheDirectory: true,
  });
  if (res.canceled || res.assets.length === 0) return null;
  const asset = res.assets[0];
  if (!asset?.uri) return null;
  const file = new File(asset.uri);
  if (!file.exists) return null;
  const text = new TextDecoder("utf-8").decode((await file.arrayBuffer()) as ArrayBuffer);
  return { name: asset.name ?? "manifest.json", text };
}

// Classifies every manifest row without writing anything (the screen shows
// this first and asks for a confirm).
export async function dryRunImport(manifest: ParsedManifest): Promise<ImportDryRunResult> {
  const db = await getDb();
  const summary: ImportDryRunResult = {
    total: manifest.rows.length,
    newRows: 0,
    duplicateRemote: 0,
    duplicateFingerprint: 0,
    missingRemote: 0,
    sampleNames: [],
  };
  for (const row of manifest.rows) {
    const chat = row.remote_chat_id ?? null;
    const msg = row.remote_message_id ?? null;
    if (!msg || msg === "0") {
      summary.missingRemote++;
      continue;
    }
    const rem = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM media WHERE remote_chat_id = ? AND remote_message_id = ? LIMIT 1",
      [String(chat ?? ""), String(msg)]
    );
    if (rem !== null) {
      summary.duplicateRemote++;
      continue;
    }
    const takenAt = Date.parse(row.taken_at);
    const fingerprint =
      typeof row.fingerprint === "string" && row.fingerprint.length > 0
        ? row.fingerprint
        : quickFingerprint({
            byteSize: row.byte_size ?? 0,
            modifiedAtMs: Number.isFinite(takenAt) ? takenAt : 0,
            fileName: row.file_name ?? "imported",
          });
    const fp = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM media WHERE fingerprint = ? LIMIT 1",
      [fingerprint]
    );
    if (fp !== null) {
      summary.duplicateFingerprint++;
      continue;
    }
    summary.newRows++;
    if (summary.sampleNames.length < 5) {
      summary.sampleNames.push(row.file_name ?? `row ${row.id}`);
    }
  }
  return summary;
}

export interface ImportDryRunResult {
  total: number;
  newRows: number;
  duplicateRemote: number;
  duplicateFingerprint: number;
  missingRemote: number;
  sampleNames: string[];
}

// Applies what dryRunImport classified. Trashed rows stay trashed; favorites
// and notes/tags ride along.

export interface ImportApplyResult {
  inserted: number;
  skipped: number;
}

// Note: insertMedia is bypassed for one reason — the manifest carries the
// FULL column set (fingerprints come from the manifest where present; older
// files have them recomputed deterministically so a future re-scan of the
// same files still dedupes). Same typed SQL as insertMedia.
export async function applyImport(manifest: ParsedManifest): Promise<ImportApplyResult> {
  const db = await getDb();
  const summary: ImportApplyResult = { inserted: 0, skipped: 0 };
  for (const row of manifest.rows) {
    const chat = row.remote_chat_id ?? null;
    const msg = row.remote_message_id ?? null;
    if (!msg || msg === "0") {
      summary.skipped++;
      continue;
    }
    const rem = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM media WHERE remote_chat_id = ? AND remote_message_id = ? LIMIT 1",
      [String(chat ?? ""), String(msg)]
    );
    if (rem !== null) {
      summary.skipped++;
      continue;
    }
    const takenAtMs = Date.parse(row.taken_at);
    if (!Number.isFinite(takenAtMs)) {
      summary.skipped++;
      continue;
    }
    const fingerprint =
      typeof row.fingerprint === "string" && row.fingerprint.length > 0
        ? row.fingerprint
        : quickFingerprint({
            byteSize: row.byte_size ?? 0,
            modifiedAtMs: takenAtMs,
            fileName: row.file_name ?? "imported",
          });
    const fp = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM media WHERE fingerprint = ? LIMIT 1",
      [fingerprint]
    );
    if (fp !== null) {
      summary.skipped++;
      continue;
    }
    const state = row.state === "synced" || row.state === "failed" ? row.state : "synced";
    const visibility = row.visibility === "trashed" ? "trashed" : row.visibility === "archived" ? "archived" : row.visibility === "hidden" ? "hidden" : "visible";
    const result = await db.runAsync(
      `INSERT INTO media
        (local_uri, thumb_uri, remote_chat_id, remote_message_id, file_name, mime_type, byte_size,
         width, height, duration_ms, taken_at, uploaded_at, fingerprint, state, visibility, trashed_at,
         is_favorite, note_text, ml_labels, user_tags, ocr_text, phash, latitude, longitude, place_name,
         media_library_id, created_at, updated_at)
       VALUES (NULL, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(chat ?? ""),
        String(msg),
        row.file_name ?? `imported-${row.id}`,
        row.mime_type ?? "application/octet-stream",
        row.byte_size ?? 0,
        row.width ?? null,
        row.height ?? null,
        row.duration_ms ?? null,
        takenAtMs,
        row.uploaded_at ? Date.parse(row.uploaded_at) || null : null,
        fingerprint,
        state,
        visibility,
        sanitizeNullable(row.note_text),
        sanitizeNullable(row.ml_labels),
        sanitizeNullable(row.user_tags),
        sanitizeNullable(row.ocr_text),
        sanitizeNullable(row.phash),
        row.latitude ?? null,
        row.longitude ?? null,
        sanitizeNullable(row.place_name),
        row.media_library_id ?? null,
        Date.now(),
        Date.now(),
      ]
    );
  if (result.lastInsertRowId > 0) summary.inserted++;
    else summary.skipped++;
  }
  return summary;
}

function sanitizeNullable(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}
