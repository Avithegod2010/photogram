// Upload format shared markers. The preview-then-reply upload scheme
// (uploader.ts) sends a small preview photo whose caption carries this suffix,
// then sends the original file as a REPLY to that preview. Anything that walks
// Saved Messages history and extracts media (restorer filename fallback, the
// F1 rehydrate inventory) must skip preview captions so previews never become
// library rows.
export const PREVIEW_CAPTION_SUFFIX = " · preview";

export function isPreviewCaption(caption: string | null | undefined): boolean {
  return typeof caption === "string" && caption.endsWith(PREVIEW_CAPTION_SUFFIX);
}
