// Decides whether a Google Maps place is the same business as a Justdial listing. Wrong
// matches are worse than none (the lead would get someone else's phone), so a place must
// share most of the name, and be close by when both sides have a position.

import type { SearchPlace } from "../content/maps/searchData";

const STOP = new Set(["the", "and", "&", "pvt", "ltd", "private", "limited", "llp", "in", "of", "co", "services", "service", "delhi", "india"]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** How much two names share (0–1): shared words over all words of both names. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return (2 * shared) / (ta.size + tb.size);
}

/** Distance in metres between two points. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface MatchTarget {
  name: string;
  latitude: number | null;
  longitude: number | null;
}

/** The best matching place, or null when none is convincing. */
export function bestMapsMatch(target: MatchTarget, places: SearchPlace[]): SearchPlace | null {
  let best: { place: SearchPlace; score: number } | null = null;
  for (const place of places) {
    const sim = nameSimilarity(target.name, place.name);
    const haveBoth = target.latitude !== null && target.longitude !== null && place.latitude !== null && place.longitude !== null;
    const dist = haveBoth ? distanceM(target.latitude!, target.longitude!, place.latitude!, place.longitude!) : null;
    // Close by: most of the name is enough. Far away or unknown position: almost all of it.
    const ok = dist !== null ? (dist <= 1500 && sim >= 0.65) || (dist <= 300 && sim >= 0.5) : sim >= 0.8;
    if (!ok) continue;
    const score = sim - (dist ?? 0) / 10_000;
    if (!best || score > best.score) best = { place, score };
  }
  return best?.place ?? null;
}
