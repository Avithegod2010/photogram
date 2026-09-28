// v0.21 Place-name search: fully OFFLINE nearest-city lookup over a bundled
// GeoNames-derived dataset (24,323 cities with population ≥ 15,000 —
// generated from the `all-the-cities` npm package, GeoNames data, CC-BY-4.0).
// Accuracy trade-offs (accepted in the owner-approved plan): rural photos
// resolve to the nearest city which may be 50+ km away; towns under the
// population cutoff inherit their nearest big city. Dataset swap stays behind
// this module's interface.

type CityEntry = [name: string, country: string, lat: number, lon: number];

const CELL = 0.5; // degrees per grid cell
const MAX_DISTANCE_KM = 50;

interface CityIndex {
  buckets: Map<string, CityEntry[]>;
}

let index: CityIndex | null = null;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadIndex(): CityIndex {
  if (index) return index;
  // Lazy require keeps the ~1 MB dataset out of the startup path until the
  // first GPS row needs it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cities = require("../../assets/geo/cities.json") as CityEntry[];
  const buckets = new Map<string, CityEntry[]>();
  for (const city of cities) {
    const key = `${Math.floor(city[2] / CELL)}:${Math.floor(city[3] / CELL)}`;
    const list = buckets.get(key);
    if (list) list.push(city);
    else buckets.set(key, [city]);
  }
  index = { buckets };
  return index;
}

// Returns "Name, Country" for the nearest city within 50 km, else null.
export function nearestCity(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const { buckets } = loadIndex();
  const cellLat = Math.floor(lat / CELL);
  const cellLon = Math.floor(lon / CELL);

  let best: { distance: number; entry: CityEntry } | null = null;
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const list = buckets.get(`${cellLat + dLat}:${cellLon + dLon}`);
      if (!list) continue;
      for (const entry of list) {
        const distance = haversineKm(lat, lon, entry[2], entry[3]);
        if (!best || distance < best.distance) best = { distance, entry };
      }
    }
  }
  if (!best || best.distance > MAX_DISTANCE_KM) return null;
  return `${best.entry[0]}, ${best.entry[1]}`;
}
