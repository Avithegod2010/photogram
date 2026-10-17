import { File, Directory, Paths } from "expo-file-system";
import {
  listAllMediaForExport,
  listPeopleForExport,
  listFacesForExport,
  type MediaRow,
  type ExportPersonRow,
  type ExportFaceRow,
} from "../db/queries";

// v0.38 export-everything: one JSON manifest (+ a CSV spreadsheet) describing
// EVERY media row — including trashed/edited/hidden — plus people and face
// samples. This is the escape hatch: even if the app were deleted, the
// manifest proves what is in the Telegram warehouse, with the chat/message
// ids a future importer needs. File bytes are never copied here (the
// originals live in Telegram; this is the index that makes them addressable).
//
// Telegram-safety: pure local file writes, no TDLib calls.

export interface ExportManifest {
  format: "photogram-export";
  version: 1;
  exported_at: string;
  media_count: number;
  people_count: number;
  face_sample_count: number;
  media: ExportMediaEntry[];
  people: ExportPersonRow[];
  face_samples: ExportFaceEntry[];
}

export interface ExportMediaEntry {
  id: number;
  file_name: string | null;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  taken_at: string; // ISO
  uploaded_at: string | null;
  trashed_at: string | null;
  state: string;
  visibility: string;
  is_favorite: boolean;
  exif_kept: boolean;
  latitude: number | null;
  longitude: number | null;
  place_name: string | null;
  ml_labels: string | null;
  user_tags: string | null;
  ocr_text: string | null;
  note_text: string | null;
  note_synced: boolean;
  phash: string | null;
  sharpness: number | null;
  edited_from: number | null;
  remote_chat_id: string | null;
  remote_message_id: string | null;
  media_library_id: string | null;
}

export interface ExportFaceEntry {
  id: number;
  media_id: number;
  box_x: number;
  box_y: number;
  box_w: number;
  box_h: number;
  quality: number | null;
  model_id: string | null;
  person_id: number | null;
  created_at: string;
  embedding_hex: string | null;
}

function iso(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function mediaToExport(row: MediaRow): ExportMediaEntry {
  return {
    id: row.id,
    file_name: row.file_name ?? null,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    width: row.width ?? null,
    height: row.height ?? null,
    duration_ms: row.duration_ms ?? null,
    taken_at: iso(row.taken_at) ?? "1970-01-01T00:00:00.000Z",
    uploaded_at: iso(row.uploaded_at),
    trashed_at: iso(row.trashed_at),
    state: row.state,
    visibility: row.visibility,
    is_favorite: row.is_favorite === 1,
    exif_kept: row.exif_kept === 1,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    place_name: row.place_name ?? null,
    ml_labels: row.ml_labels ?? null,
    user_tags: row.user_tags ?? null,
    ocr_text: row.ocr_text ?? null,
    note_text: row.note_text ?? null,
    note_synced: row.note_synced === 1,
    phash: row.phash ?? null,
    sharpness: row.sharpness ?? null,
    edited_from: row.edited_from ?? null,
    remote_chat_id: row.remote_chat_id ?? null,
    remote_message_id: row.remote_message_id ?? null,
    media_library_id: row.media_library_id ?? null,
  };
}

export function bytesToHex(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null;
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export function faceToExport(row: ExportFaceRow): ExportFaceEntry {
  return {
    id: row.id,
    media_id: row.media_id,
    box_x: row.box_x,
    box_y: row.box_y,
    box_w: row.box_w,
    box_h: row.box_h,
    quality: row.quality ?? null,
    model_id: row.model_id ?? null,
    person_id: row.person_id ?? null,
    created_at: iso(row.created_at) ?? "1970-01-01T00:00:00.000Z",
    embedding_hex: bytesToHex(row.embedding),
  };
}

export function buildManifestJson(
  media: MediaRow[],
  people: ExportPersonRow[],
  faces: ExportFaceRow[],
  exportedAt: number,
  minify = false
): string {
  const manifest: ExportManifest = {
    format: "photogram-export",
    version: 1,
    exported_at: iso(exportedAt) ?? "1970-01-01T00:00:00.000Z",
    media_count: media.length,
    people_count: people.length,
    face_sample_count: faces.length,
    media: media.map(mediaToExport),
    people,
    face_samples: faces.map(faceToExport),
  };
  return minify ? JSON.stringify(manifest) : JSON.stringify(manifest, null, 2);
}

const CSV_COLUMNS = [
  "id",
  "file_name",
  "mime_type",
  "byte_size",
  "taken_at",
  "uploaded_at",
  "state",
  "visibility",
  "width",
  "height",
  "duration_ms",
  "latitude",
  "longitude",
  "place_name",
  "ml_labels",
  "user_tags",
  "note_text",
  "is_favorite",
  "phash",
  "edited_from",
  "remote_chat_id",
  "remote_message_id",
] as const;

// RFC 4180: a value containing a comma, quote or newline is wrapped in quotes
// and internal quotes are doubled.
export function csvEscape(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function buildCsv(media: MediaRow[]): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const row of media) {
    const entry = mediaToExport(row);
    lines.push(CSV_COLUMNS.map((c) => csvEscape(entry[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function exportDir(): Directory {
  const dir = new Directory(Paths.document, "export");
  if (!dir.exists) dir.create();
  return dir;
}

export interface ExportResult {
  uri: string;
  fileName: string;
  byteCount: number;
}

export async function runExport(kind: "json" | "csv", opts: { minify?: boolean } = {}): Promise<ExportResult> {
  const [media, people, faces] = await Promise.all([
    listAllMediaForExport(),
    listPeopleForExport(),
    listFacesForExport(),
  ]);
  const text =
    kind === "json"
      ? buildManifestJson(media, people, faces, Date.now(), opts.minify ?? false)
      : buildCsv(media);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName =
    kind === "json" ? `photogram-manifest-${stamp}.json` : `photogram-csv-${stamp}.csv`;
  const file = new File(exportDir(), fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(new TextEncoder().encode(text));
  return { uri: file.uri, fileName, byteCount: file.size };
}
