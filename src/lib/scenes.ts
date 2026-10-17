import { countScenePhotos, listScenePhotos, MediaRow } from "../db/queries";

// v0.36 scene auto-albums: fixed, curated virtual albums built directly on the
// on-device ML labels vibe search already stores (schema v12). No new ML, no
// migration — a scene is a small set of label tokens; counts and grids re-run
// live like the smart albums. Labels mirror what the default ML Kit image
// labeler emits (see scanner labelImage: lowercased, space-joined).
export interface Scene {
  key: string;
  title: string;
  sub: string;
  labels: string[];
}

export const SCENES: Scene[] = [
  {
    key: "beach",
    title: "Beach days",
    sub: "Sand, sea, waves and summer trips",
    labels: ["beach", "sea", "ocean", "coast", "tropical", "shoreline"],
  },
  {
    key: "food",
    title: "Food",
    sub: "Meals, menus and treats",
    labels: ["food", "dish", "meal", "cuisine", "recipe", "ingredient"],
  },
  {
    key: "animals",
    title: "Pets & animals",
    sub: "Dogs, cats, birds and wildlife",
    labels: ["dog", "cat", "puppy", "kitten", "pet", "animal", "bird", "wildlife"],
  },
  {
    key: "nature",
    title: "Nature",
    sub: "Mountains, forests, flowers and skies",
    labels: ["nature", "mountain", "forest", "landscape", "flower", "sky", "clouds", "fall leaves"],
  },
  {
    key: "city",
    title: "City life",
    sub: "Streets, buildings and traffic",
    labels: ["city", "street", "urban", "building", "architecture", "traffic", "car", "bridge"],
  },
  {
    key: "snow",
    title: "Snow & winter",
    sub: "Cold trips at their best",
    labels: ["snow", "winter", "ski", "frost", "ice", "glacier"],
  },
];

export async function getSceneOverview(): Promise<{ scene: Scene; count: number }[]> {
  const out: { scene: Scene; count: number }[] = [];
  for (const scene of SCENES) {
    out.push({ scene, count: await countScenePhotos(scene.labels) });
  }
  return out;
}

// Null = unknown scene key.
export async function getSceneMedia(key: string): Promise<MediaRow[] | null> {
  const scene = SCENES.find((s) => s.key === key);
  if (!scene) return null;
  return listScenePhotos(scene.labels);
}
