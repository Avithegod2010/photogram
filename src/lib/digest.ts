import { getDb } from "../db";
import { getDigestStats, type DigestStats } from "../db/queries";
import { formatBytes } from "./stats";
import { uploadsMmkv } from "../store/uploadStore";

export interface DigestBody {
  title: string;
  lines: string[];
}

// v0.39 monthly "Wrapped-style" health digest — a local notification that sums
// up the backup for the eligible audience (opt-in notifications master).
// Pure data, no warnings hidden: anything not verifiable prints "unknown".
export async function buildHealthDigest(): Promise<DigestBody | null> {
  const stats = await getDigestStats();
  if (stats.totalVisible === 0) return null;
  return composeDigest(stats);
}

export function composeDigest(stats: DigestStats): DigestBody {
  const lines: string[] = [];
  const total = stats.totalVisible;
  const backed = stats.syncedCount;
  const pct = total > 0 ? Math.round((backed / total) * 100) : 0;
  lines.push(`${backed}/${total} photos & videos backed up (${pct}%) — ${formatBytes(stats.syncedBytes)} in Telegram.`);
  if (stats.integrityBroken !== null) {
    lines.push(`Backup integrity: ${stats.integrityBroken === 0 ? "everything verified" : `${stats.integrityBroken} item(s) missing in Telegram — check Safety screen`}.`);
  } else {
    lines.push("Backup integrity: not checked yet this month.");
  }
  if (stats.junkDeleted30d > 0) lines.push(`Junk sweeper: ${stats.junkDeleted30d} item(s) removed in the last 30 days.`);
  if (stats.trashCount > 0) lines.push(`${stats.trashCount} item(s) waiting in Trash.`);
  if (stats.peopleCount > 0) lines.push(`${stats.peopleCount} people detected across your photos.`);
  if (stats.favoritesCount > 0) lines.push(`${stats.favoritesCount} favorite(s).`);
  return { title: "Photogram — monthly backup health", lines };
}

export function monthKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// The notify loop imports this: on the first in-app check of a new month,
// post the digest once (guild: notifications master gates everything).
export const DIGEST_LAST_KEY = "digest_last_month";

export async function maybeRunMonthlyDigest(): Promise<boolean> {
  const key = monthKey();
  let last: string | null = null;
  try {
    last = uploadsMmkv.getString(DIGEST_LAST_KEY) ?? null;
  } catch {}
  if (last === key) return false;
  try {
    const db = await getDb();
    await db.getFirstAsync("SELECT 1");
  } catch {
    return false; // db not ready — never crash the loop
  }
  const body = await buildHealthDigest();
  if (!body || digestPoster === null) return false;
  try {
    await digestPoster(body);
  } catch {
    return false;
  }
  try {
    uploadsMmkv.set(DIGEST_LAST_KEY, key);
  } catch {}
  return true;
}

// Hook set by lib/notify.ts — avoids a circular import.
export let digestPoster: ((body: DigestBody) => Promise<void>) | null = null;

export function setDigestPoster(fn: (body: DigestBody) => Promise<void>): void {
  digestPoster = fn;
}
