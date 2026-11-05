// v0.25 manual tags, shared by the viewer and the bulk editor.
// v0.55: moved out of ViewerScreen so the gallery's multi-select can reuse the
// exact same normalisation (the static check pins this function's source).

// Comma-separated input → trimmed tags (each capped at 50 chars), ", "-joined
// for storage/display. Null = no tags (clears).
export function normalizeUserTags(raw: string): string | null {
  const tags = raw
    .split(",")
    .map((t) => t.trim().slice(0, 50))
    .filter((t) => t.length > 0);
  return tags.length > 0 ? tags.join(", ") : null;
}

export const MAX_TAGS_PER_PHOTO = 20;

// Merge new tags into an existing list without duplicating (case-insensitive),
// keeping the owner's original order and cap finite so a bulk tag over a huge
// selection can never grow a row without bound.
export function mergeTagList(existing: string | null, added: string | null): string | null {
  const parse = (raw: string | null): string[] =>
    (raw ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...parse(existing), ...parse(added)]) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_PHOTO) break;
  }
  return out.length > 0 ? out.join(", ") : null;
}
