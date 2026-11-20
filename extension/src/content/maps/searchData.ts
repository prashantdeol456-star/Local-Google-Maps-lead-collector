// Reads the result data Google Maps itself loads for a search (the first page is embedded in
// the page, each further page arrives when the list is scrolled). Every result in that data
// already carries its phone, website, full address, rating and position, so the fast mode
// never has to open a listing. Pure functions, no DOM access.
//
// The data is an undocumented nested array. Positions verified on google.com/maps on 2026-11-20:
//   place[10] feature id "0x…:0x…"   place[11] name          place[13][0] main category
//   place[4][7] rating               place[4][8] review count
//   place[7][0] website              place[9][2]/[3] latitude/longitude
//   place[39] full address           place[78] place id      place[178][0][5][0] "tel:…"
// If Google moves a field, it comes back null (never a wrong value) and the runner falls back
// to opening that listing.

import { cleanText, parsePhoneItemId, parseWebsite } from "./parser";

export interface SearchPlace {
  featureId: string;
  placeId: string | null;
  name: string;
  category: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
}

export interface SearchPayload {
  /** The search the data answers, e.g. "dentist in Lucknow" (null if not found). */
  query: string | null;
  places: SearchPlace[];
}

const FEATURE_ID = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

/** Safe nested read: at(v, 4, 7) is v[4][7], or undefined. */
function at(v: unknown, ...path: number[]): unknown {
  let cur = v;
  for (const i of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[i];
  }
  return cur;
}

const str = (v: unknown) => (typeof v === "string" ? cleanText(v) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function isPlace(v: unknown): v is unknown[] {
  return Array.isArray(v) && typeof v[10] === "string" && FEATURE_ID.test(v[10]) && typeof v[11] === "string" && v[11].trim() !== "";
}

function readPhone(place: unknown[]): string | null {
  const tel = str(at(place, 178, 0, 5, 0));
  if (tel?.startsWith("tel:")) return parsePhoneItemId(`phone:${tel}`);
  const shown = str(at(place, 178, 0, 0));
  return shown ? parsePhoneItemId(`phone:tel:${shown}`) : null;
}

function readPlace(place: unknown[]): SearchPlace {
  const lat = num(at(place, 9, 2));
  const lng = num(at(place, 9, 3));
  const validCoords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const rating = num(at(place, 4, 7));
  const reviews = num(at(place, 4, 8));
  const site = str(at(place, 7, 0));
  return {
    featureId: (place[10] as string).toLowerCase(),
    placeId: str(place[78]),
    name: cleanText(place[11] as string)!,
    category: str(at(place, 13, 0)),
    phone: readPhone(place),
    // Only the business's own site: Google's own pages are not a website.
    website: site && !/^https?:\/\/(www\.)?google\./i.test(site) ? parseWebsite(site) : null,
    address: str(place[39]),
    latitude: validCoords ? lat : null,
    longitude: validCoords ? lng : null,
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    reviewCount: reviews !== null && reviews >= 0 ? Math.round(reviews) : null,
  };
}

/** Parses one Maps search response (")]}'" + JSON). Returns null if it is not search data. */
export function parseSearchPayload(text: string): SearchPayload | null {
  const body = text.replace(/^\)\]\}'\s*/, "").replace(/\/\*""\*\/\s*$/, "");
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const places: SearchPlace[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (!Array.isArray(v) || depth > 8) return;
    if (isPlace(v)) {
      const p = readPlace(v);
      if (!seen.has(p.featureId)) {
        seen.add(p.featureId);
        places.push(p);
      }
      return; // a place never contains the next result
    }
    for (const x of v) walk(x, depth + 1);
  };
  walk(data, 0);

  return { query: str(at(data, 0, 0)), places };
}

/** "Dentist  in lucknow" and "dentist in Lucknow" are the same search. */
export function sameQuery(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\+/g, " ").replace(/\s+/g, " ").trim();
  return norm(a) !== "" && norm(a) === norm(b);
}

/** Link that opens the place in Maps (stable: built from the place id, else the feature id). */
export function placeMapsUrl(p: Pick<SearchPlace, "placeId" | "featureId" | "name">): string {
  return p.placeId
    ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.placeId)}`
    : `https://www.google.com/maps/place/${encodeURIComponent(p.name)}/data=!4m2!3m1!1s${p.featureId}`;
}
