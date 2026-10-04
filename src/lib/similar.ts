import {
  getMediaByIds,
  listMissingPhash,
  listPhashRows,
  updateMediaPhash,
  MediaRow,
} from "../db/queries";
import { decodeThumbToGray, hamming64, pHash64 } from "./imageAnalysis";
import { DUP_HAMMING_MAX } from "./junk";

// v0.24 "Find similar" / visual duplicate finder. The scanner persists a
// 64-bit pHash of every photo's 320px thumbnail (media.phash, hex); this lib
// ranks other photos by Hamming distance in JS — no SQL index can help, and
// the whole library fits in one query.

// Looser than the junk sweeper's DUP_HAMMING_MAX: this is search (recall
// beats precision — the owner just wants to SEE the similar shots), and it
// also runs across days, not only within one.
const SIMILAR_HAMMING_MAX = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const HASH_CHUNK = 200;

function hexToBigint(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

// Computes + stores the hash on first use (e.g. a photo from before v0.24
// that the Viewer asks about directly). Returns null for videos/undecodable.
async function ensurePhash(row: MediaRow): Promise<string | null> {
  if (row.phash && row.phash.length === 16) return row.phash;
  if (!row.mime_type.startsWith("image/") || !row.thumb_uri) return null;
  try {
    const phash = pHash64(await decodeThumbToGray(row.thumb_uri)).toString(16).padStart(16, "0");
    await updateMediaPhash(row.id, phash);
    return phash;
  } catch {
    return null;
  }
}

// Photos that look like `mediaId` (nearest-hash first). Empty when the anchor
// can't be hashed (video, missing thumbnail) or nothing is within threshold.
export async function findSimilarTo(mediaId: number, limit = 60): Promise<MediaRow[]> {
  const [anchor] = await getMediaByIds([mediaId]);
  if (!anchor) return [];
  const anchorHex = await ensurePhash(anchor);
  if (!anchorHex) return [];
  const anchorHash = hexToBigint(anchorHex);

  const candidates = await listPhashRows(anchor.id);
  const ranked = candidates
    .map((c) => ({ id: c.id, dist: hamming64(anchorHash, hexToBigint(c.phash)) }))
    .filter((c) => c.dist <= SIMILAR_HAMMING_MAX)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
  if (ranked.length === 0) return [];

  const rows = await getMediaByIds(ranked.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ranked.map((r) => byId.get(r.id)).filter((r): r is MediaRow => r !== undefined);
}

export interface DuplicateGroup {
  items: MediaRow[]; // leader (largest file) first
}

// Same-day near-duplicate groups across the whole library — the junk
// sweeper's clustering (union-find over pairwise Hamming distance within a
// day bucket) applied to the persisted hashes. Purely read-only: the review
// of what to DO with a group stays with the owner (junk sweep / trash).
export async function findDuplicateGroups(): Promise<DuplicateGroup[]> {
  const rows = await listPhashRows(0);
  const dayBuckets = new Map<number, { id: number; byteSize: number; hash: bigint }[]>();
  for (const row of rows) {
    const day = Math.floor(row.taken_at / DAY_MS);
    const bucket = dayBuckets.get(day) ?? [];
    bucket.push({ id: row.id, byteSize: row.byte_size, hash: hexToBigint(row.phash) });
    dayBuckets.set(day, bucket);
  }

  const groupIds: number[][] = [];
  for (const entries of dayBuckets.values()) {
    if (entries.length < 2) continue;
    const parent = entries.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (hamming64(entries[i].hash, entries[j].hash) <= DUP_HAMMING_MAX) union(i, j);
      }
    }
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const root = find(i);
      const list = clusters.get(root) ?? [];
      list.push(entries[i].id);
      clusters.set(root, list);
    }
    for (const members of clusters.values()) {
      if (members.length >= 2) groupIds.push(members);
    }
  }
  if (groupIds.length === 0) return [];

  const all = await getMediaByIds(groupIds.flat());
  const byId = new Map(all.map((r) => [r.id, r]));
  const groups: DuplicateGroup[] = [];
  for (const members of groupIds) {
    const items = members.map((id) => byId.get(id)).filter((r): r is MediaRow => r !== undefined);
    if (items.length < 2) continue;
    // Leader (largest file) first; groups ordered by the leader's date.
    items.sort((a, b) => b.byte_size - a.byte_size);
    groups.push({ items });
  }
  groups.sort((a, b) => b.items[0].taken_at - a.items[0].taken_at);
  return groups;
}

// Backfills phash for every not-yet-hashed photo in resumable chunks (the
// scanner only covers rows it re-encounters; this covers the existing
// library). A thumbnail that fails to decode is marked with the '' sentinel
// so it is never retried forever. Returns the number of photos hashed.
export async function hashMissingPhotos(
  onProgress?: (hashed: number) => void,
  cancelRef?: { cancelled: boolean }
): Promise<number> {
  let cursor = 0;
  let hashed = 0;
  for (;;) {
    if (cancelRef?.cancelled) return hashed;
    const batch = await listMissingPhash(cursor, HASH_CHUNK);
    if (batch.length === 0) return hashed;
    for (const row of batch) {
      cursor = row.id;
      let hex: string | null = null;
      try {
        hex = pHash64(await decodeThumbToGray(row.thumb_uri)).toString(16).padStart(16, "0");
      } catch {
        hex = null;
      }
      await updateMediaPhash(row.id, hex ?? "");
      if (hex) hashed++;
    }
    onProgress?.(hashed);
  }
}
