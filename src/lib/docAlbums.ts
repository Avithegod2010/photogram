import { countDocPhotos, listDocPhotos, type MediaRow } from "../db/queries";

// v0.39 smarter albums: receipts & documents auto-albums from the OCR text the
// scanner already saves (media.ocr_text, opt-in "Read text in photos"). Same
// universe rules as scenes: visible, not edited copies, not shared rows,
// newest-first. Keyword matching is boundary-safe ("' phrase '") inside a
// newline-drained, space-padded copy of the text.
export interface DocAlbumDef {
  key: string;
  label: string;
  sub: string;
  keywords: string[];
}

export const DOC_ALBUMS: DocAlbumDef[] = [
  {
    key: "receipts",
    label: "Receipts",
    sub: "Receipts, invoices & bills found by OCR",
    keywords: ["receipt", "invoice", "amount paid", "amount due", "total due", "subtotal", "cash tendered", "change due"],
  },
  {
    key: "documents",
    label: "Documents",
    sub: "Certificates, IDs & licences found by OCR",
    keywords: ["certificate", "passport", "identity card", "id card", "aadhaar", "pan card", "driving licence", "driver's license", "date of birth", "license no"],
  },
];

export function docAlbumDef(key: string): DocAlbumDef | null {
  return DOC_ALBUMS.find((d) => d.key === key) ?? null;
}

export interface DocOverviewEntry {
  def: DocAlbumDef;
  count: number;
}

export async function getDocOverview(): Promise<DocOverviewEntry[]> {
  return Promise.all(
    DOC_ALBUMS.map(async (def) => ({ def, count: await countDocPhotos(def.keywords) }))
  );
}

export async function getDocMedia(key: string, limit = 600): Promise<MediaRow[] | null> {
  const def = docAlbumDef(key);
  if (!def) return null;
  return listDocPhotos(def.keywords, limit);
}
