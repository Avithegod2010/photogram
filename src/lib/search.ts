import { searchByDateRange, searchMediaRaw, MediaRow } from "../db/queries";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export interface ParsedDateRange {
  fromMs: number;
  toMs: number;
  label: string;
}

export function parseDateQuery(raw: string): ParsedDateRange | null {
  const q = raw.trim().toLowerCase();
  if (q.length === 0) return null;

  const monthYear = q.match(/^([a-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const mIdx = MONTHS.findIndex((m) => m.startsWith(monthYear[1].slice(0, 3)));
    if (mIdx >= 0) {
      const y = parseInt(monthYear[2], 10);
      return buildMonth(y, mIdx);
    }
  }

  const slash = q.match(/^(\d{1,2})[/\-](\d{4})$/);
  if (slash) {
    const m = parseInt(slash[1], 10);
    const y = parseInt(slash[2], 10);
    if (m >= 1 && m <= 12) return buildMonth(y, m - 1);
  }

  const yearOnly = q.match(/^\d{4}$/);
  if (yearOnly) {
    const y = parseInt(q, 10);
    return { fromMs: Date.UTC(y, 0, 1), toMs: Date.UTC(y + 1, 0, 1), label: q };
  }

  const today = new Date();
  if (/^today$/.test(q)) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return { fromMs: start, toMs: start + 86_400_000, label: "Today" };
  }
  if (/^(this|current) month$/.test(q)) {
    return buildMonth(today.getFullYear(), today.getMonth());
  }
  if (/^(last|previous) month$/.test(q)) {
    const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return buildMonth(lm.getFullYear(), lm.getMonth());
  }

  return null;
}

function buildMonth(year: number, monthIndex: number): ParsedDateRange {
  const from = new Date(year, monthIndex, 1).getTime();
  const to = new Date(year, monthIndex + 1, 1).getTime();
  const label = new Date(year, monthIndex, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  return { fromMs: from, toMs: to, label };
}

export async function runSearch(query: string): Promise<MediaRow[]> {
  const dateRange = parseDateQuery(query);
  if (dateRange) return searchByDateRange(dateRange.fromMs, dateRange.toMs);
  return searchMediaRaw(query);
}
