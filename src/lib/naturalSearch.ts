import { searchMediaFiltered, type MediaRow } from "../db/queries";

// v0.55 natural-language search: "beach at sunset 2024", "favorite videos",
// "may 2023". The parser is deliberately small and predictable - it only
// understands things it can prove (years, month+year, today/this/last month,
// photo/video, favorites) and leaves every other word as free text, so a typo
// can never silently turn into the wrong filter.

export interface NaturalDateRange {
  fromMs: number;
  toMs: number;
  label: string;
}

function buildMonthRange(year: number, monthIndex: number): NaturalDateRange {
  const from = new Date(year, monthIndex, 1).getTime();
  const to = new Date(year, monthIndex + 1, 1).getTime();
  const label = new Date(year, monthIndex, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  return { fromMs: from, toMs: to, label };
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const FAVORITE_WORDS = new Set(["favorite", "favorites", "favourite", "favourites", "fav", "favs"]);
const VIDEO_WORDS = new Set(["video", "videos", "clip", "clips"]);
const PHOTO_WORDS = new Set(["photo", "photos", "picture", "pictures", "pic", "pics", "image", "images"]);

export type MediaKind = "photo" | "video";

export interface NaturalSearch {
  text: string;
  dateRange: NaturalDateRange | null;
  kind: MediaKind | null;
  favoritesOnly: boolean;
}

function monthIndex(token: string): number {
  const t = token.toLowerCase();
  if (t.length < 3) return -1;
  return MONTHS.findIndex((m) => m === t || m.startsWith(t));
}

function isYear(token: string): number | null {
  if (!/^\d{4}$/.test(token)) return null;
  const y = parseInt(token, 10);
  return y >= 1990 && y <= 2100 ? y : null;
}

export function parseNaturalSearch(raw: string, now = new Date()): NaturalSearch {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const result: NaturalSearch = { text: "", dateRange: null, kind: null, favoritesOnly: false };
  if (tokens.length === 0) return result;

  const lower = tokens.map((t) => t.toLowerCase());
  const consumed = new Set<number>();

  // "last month" / "this month" / "today" only as the entire remaining phrase -
  // otherwise "today" inside "today's throwback" would lose its meaning.
  const whole = lower.join(" ");
  if (whole === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { ...result, dateRange: { fromMs: start, toMs: start + 86_400_000, label: "Today" } };
  }
  if (whole === "this month" || whole === "current month") {
    return { ...result, dateRange: buildMonthRange(now.getFullYear(), now.getMonth()) };
  }
  if (whole === "last month" || whole === "previous month") {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { ...result, dateRange: buildMonthRange(lm.getFullYear(), lm.getMonth()) };
  }

  // Year, optionally preceded by a month name ("may 2024").
  for (let i = 0; i < tokens.length; i++) {
    const year = isYear(tokens[i]);
    if (year === null) continue;
    const prev = i > 0 ? monthIndex(tokens[i - 1]) : -1;
    if (prev >= 0) {
      result.dateRange = buildMonthRange(year, prev);
      consumed.add(i - 1);
    } else {
      result.dateRange = { fromMs: Date.UTC(year, 0, 1), toMs: Date.UTC(year + 1, 0, 1), label: String(year) };
    }
    consumed.add(i);
    break;
  }

  for (let i = 0; i < lower.length; i++) {
    if (consumed.has(i)) continue;
    const t = lower[i];
    if (FAVORITE_WORDS.has(t)) {
      result.favoritesOnly = true;
      consumed.add(i);
    } else if (VIDEO_WORDS.has(t)) {
      result.kind = "video";
      consumed.add(i);
    } else if (PHOTO_WORDS.has(t)) {
      result.kind = "photo";
      consumed.add(i);
    }
  }

  result.text = tokens.filter((_, i) => !consumed.has(i)).join(" ").trim();
  return result;
}

export async function runNaturalSearch(raw: string, limit = 300): Promise<MediaRow[]> {
  const parsed = parseNaturalSearch(raw);
  const hasFilters =
    parsed.text.length > 0 ||
    parsed.dateRange !== null ||
    parsed.kind !== null ||
    parsed.favoritesOnly;
  if (!hasFilters) return [];
  return searchMediaFiltered({
    text: parsed.text || null,
    fromMs: parsed.dateRange?.fromMs ?? null,
    toMs: parsed.dateRange?.toMs ?? null,
    kind: parsed.kind,
    favoritesOnly: parsed.favoritesOnly,
    limit,
  });
}
