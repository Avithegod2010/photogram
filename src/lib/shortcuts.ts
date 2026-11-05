// v0.55 dynamic launcher shortcuts: gallery / albums / settings plus the
// auto-album that received the newest photo ("Camera", "Screenshots", …).
// expo-quick-actions writes real Android ShortcutManager entries, so no native
// bridge is needed; the ids are the only contract between writer and listener.
// Pure functions so the probe can check the cap and the id format.

export interface ShortcutItem {
  id: string;
  title: string;
  icon: string;
}

export type ShortcutTarget =
  | { kind: "gallery" }
  | { kind: "albums" }
  | { kind: "settings" }
  | { kind: "album"; albumKey: string };

// Android keeps at most 4 dynamic shortcuts per app on most launchers.
export const MAX_SHORTCUTS = 4;

export function buildShortcutItems(
  recent: { key: string; label: string } | null
): ShortcutItem[] {
  const items: ShortcutItem[] = [
    { id: "gallery", title: "Open gallery", icon: "search" },
    { id: "albums", title: "Albums", icon: "photo" },
    { id: "settings", title: "Settings", icon: "settings" },
  ];
  if (recent && recent.key.length > 0) {
    items.push({ id: `album:${recent.key}`, title: recent.label, icon: "photo" });
  }
  return items.slice(0, MAX_SHORTCUTS);
}

export function parseShortcutId(id: string | null | undefined): ShortcutTarget | null {
  if (!id) return null;
  if (id === "gallery") return { kind: "gallery" };
  if (id === "albums") return { kind: "albums" };
  if (id === "settings") return { kind: "settings" };
  if (id.startsWith("album:")) {
    const albumKey = id.slice("album:".length);
    return albumKey.length > 0 ? { kind: "album", albumKey } : null;
  }
  return null;
}
