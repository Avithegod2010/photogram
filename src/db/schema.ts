export const DB_NAME = "photogram.db";

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  cover_media_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_uri TEXT,
  thumb_uri TEXT NOT NULL,
  remote_chat_id TEXT,
  remote_message_id TEXT,
  file_name TEXT,
  mime_type TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  taken_at INTEGER NOT NULL,
  uploaded_at INTEGER,
  fingerprint TEXT NOT NULL UNIQUE,
  content_hash TEXT,
  exif_kept INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL CHECK (state IN ('local','queued','uploading','synced','failed')),
  visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible','archived','trashed','hidden')),
  trashed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_taken ON media (taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_state ON media (state);
CREATE INDEX IF NOT EXISTS idx_media_visibility ON media (visibility);

CREATE TABLE IF NOT EXISTS album_media (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_album_media_media ON album_media (media_id);

CREATE TABLE IF NOT EXISTS upload_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  local_uri TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','done','failed')),
  error TEXT,
  enqueued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON upload_queue (status, enqueued_at);
`;

const SCHEMA_V2 = `
ALTER TABLE media ADD COLUMN tags TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN latitude REAL;
ALTER TABLE media ADD COLUMN longitude REAL;
CREATE INDEX IF NOT EXISTS idx_media_geo ON media (latitude, longitude) WHERE latitude IS NOT NULL;
`;

const SCHEMA_V3 = `
ALTER TABLE media ADD COLUMN media_library_id TEXT;
`;

// S9 Phase 1: shared albums backed by Telegram groups. Reuses the v1 albums +
// album_media tables. chat_id NULL = a local album (unused for now);
// last_claimed_message_id = claim cursor into the group's history.
const SCHEMA_V4 = `
ALTER TABLE albums ADD COLUMN chat_id TEXT;
ALTER TABLE albums ADD COLUMN last_claimed_message_id TEXT;
ALTER TABLE albums ADD COLUMN show_in_timeline INTEGER NOT NULL DEFAULT 0;
ALTER TABLE album_media ADD COLUMN sender_id TEXT;
ALTER TABLE album_media ADD COLUMN message_id TEXT;
ALTER TABLE upload_queue ADD COLUMN chat_id TEXT;
`;

// Idea 5: searchable text inside photos (screenshots/receipts). Only populated
// when the owner enables OCR in Settings.
const SCHEMA_V5 = `
ALTER TABLE media ADD COLUMN ocr_text TEXT;
`;

// S9 fast-follow: forum topic sub-albums (docs/PLAN-S9-TOPICS.md, D1).
// forum_topic_id records which Telegram topic (message_thread_id) each claimed
// message came from; forum_topics caches the group's topic list per album,
// rebuilt by each claim run. Thread ids are TEXT: Telegram ids exceed JS safe
// integers.
const SCHEMA_V6 = `
ALTER TABLE album_media ADD COLUMN forum_topic_id TEXT;
CREATE TABLE IF NOT EXISTS forum_topics (
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  title     TEXT NOT NULL,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, thread_id)
);
`;

// F2 Junk Sweeper (docs/PLAN-FEATURES-v0.11-plus.md): on-device heuristics
// (blur / pocket / near-duplicate / stale screenshot) produce findings that the
// owner reviews before any deletion. "Keep" is recorded in the same table
// (status='kept') so the sweeper never re-suggests a dismissed photo.
const SCHEMA_V7 = `
CREATE TABLE IF NOT EXISTS junk_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('blurry','pocket','near_duplicate','stale_screenshot')),
  score REAL,
  detail TEXT,
  group_key TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','kept','deleted'))
);

CREATE INDEX IF NOT EXISTS idx_junk_findings_status ON junk_findings (status, category);
CREATE INDEX IF NOT EXISTS idx_junk_findings_media ON junk_findings (media_id);
`;

// v0.13 Favorites: a per-device heart on any photo/video. Local-only state —
// never synced to Telegram. The partial index keeps the favorites lookup tiny.
const SCHEMA_V8 = `
ALTER TABLE media ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_media_favorite ON media (is_favorite) WHERE is_favorite = 1;
`;

// F3 Photo journaling (docs/PLAN-F3-JOURNALING.md, renumbered v8→v9: v8 is
// Favorites). note_text = the local note (NULL = note removed); note_synced = 0
// until Telegram confirms the caption matches (push or fileName restore).
const SCHEMA_V9 = `
ALTER TABLE media ADD COLUMN note_text TEXT;
ALTER TABLE media ADD COLUMN note_synced INTEGER NOT NULL DEFAULT 0;
`;

export interface Migration {
  version: number;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, up: SCHEMA_V1 },
  { version: 2, up: SCHEMA_V2 },
  { version: 3, up: SCHEMA_V3 },
  { version: 4, up: SCHEMA_V4 },
  { version: 5, up: SCHEMA_V5 },
  { version: 6, up: SCHEMA_V6 },
  { version: 7, up: SCHEMA_V7 },
  { version: 8, up: SCHEMA_V8 },
  { version: 9, up: SCHEMA_V9 },
];

export function migrationsAfter(version: number): Migration[] {
  return MIGRATIONS.filter((m) => m.version > version).sort((a, b) => a.version - b.version);
}
