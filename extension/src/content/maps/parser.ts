// Pure string parsers for values read from Maps. No DOM access here.
// Rule: if a value cannot be parsed confidently, return null — never guess.

import { PLACE_URL_PATTERNS } from "./selectors";

/** Trims, collapses whitespace and strips invisible/private-use glyphs (Maps icon fonts). */
export function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value
    .replace(/[-​-‏‪-‮⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function toNumber(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parsePlaceUrl(href: string): {
  placeId: string | null;
  featureId: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  const lat = toNumber(href.match(PLACE_URL_PATTERNS.latitude)?.[1]);
  const lng = toNumber(href.match(PLACE_URL_PATTERNS.longitude)?.[1]);
  const validCoords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    placeId: href.match(PLACE_URL_PATTERNS.placeId)?.[1] ?? null,
    featureId: href.match(PLACE_URL_PATTERNS.featureId)?.[1]?.toLowerCase() ?? null,
    latitude: validCoords ? lat : null,
    longitude: validCoords ? lng : null,
  };
}

/** Place URL without tracking/query parameters. */
export function canonicalMapsUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (!url.pathname.startsWith("/maps/place/")) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/** "4.2 stars " → 4.2 (must be within 0–5). */
export function parseRating(label: string | null): number | null {
  const m = label?.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  return n >= 0 && n <= 5 ? n : null;
}

/** "1,262 reviews" or "(1,262)" → 1262. */
export function parseReviewCount(label: string | null): number | null {
  const m = label?.match(/(\d[\d,.\s]*)/);
  if (!m) return null;
  const digits = m[1]!.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

/** data-item-id "phone:tel:08957926677" → "08957926677" (formatting is normalized in Phase 5). */
export function parsePhoneItemId(itemId: string | null): string | null {
  const m = itemId?.match(/^phone:tel:([+\d][\d\s-]{4,})$/);
  return m ? m[1]!.replace(/[\s-]/g, "") : null;
}

/** Website link; unwraps Google redirect links (/url?q=...). Only http(s). */
export function parseWebsite(href: string | null): string | null {
  if (!href) return null;
  try {
    let url = new URL(href, "https://www.google.com");
    if (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname === "/url") {
      const target = url.searchParams.get("q") ?? url.searchParams.get("url");
      if (!target) return null;
      url = new URL(target);
    }
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// ---- Address ----

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  // Union territories
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];
const STATE_BY_LOWER = new Map(INDIAN_STATES.map((s) => [s.toLowerCase(), s]));

export interface AddressParts {
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

const EMPTY_ADDRESS: AddressParts = { city: null, state: null, postalCode: null, country: null };

/**
 * Splits an Indian-format address: "..., Sarfarazganj, Lucknow, Uttar Pradesh 226003[, India]".
 * The country is only set when the state is a known Indian state/UT. Other formats are left
 * unparsed (address is still stored in full).
 *
 * City: if `cityHint` (the job's location, e.g. "Lucknow") is exactly one of the address parts,
 * that part is the city. Otherwise the part before the state is used. This matters for addresses
 * like "..., Lucknow, Nijampur Malhaur, Uttar Pradesh 226028" where a locality follows the city.
 */
export function parseAddress(address: string | null, cityHint?: string | null): AddressParts {
  const text = cleanText(address);
  if (!text) return EMPTY_ADDRESS;

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.at(-1)?.toLowerCase() === "india") parts.pop();
  if (parts.length < 2) return EMPTY_ADDRESS;

  const last = parts.at(-1)!;
  const m = last.match(/^(.*?)\s*(\d{6})?$/);
  const state = STATE_BY_LOWER.get((m?.[1] ?? "").trim().toLowerCase());
  if (!state) return EMPTY_ADDRESS;

  const postalCode = m?.[2] ?? null;
  const hint = cleanText(cityHint)?.toLowerCase();
  const hinted = hint ? parts.slice(0, -1).find((p) => p.toLowerCase() === hint) : undefined;
  if (hinted) return { city: hinted, state, postalCode, country: "India" };

  const cityCandidate = parts.at(-2)!;
  // Plus codes ("VVGC+H8") and bare numbers are not city names.
  const city = /\+|^\d+$/.test(cityCandidate) ? null : cityCandidate;
  return { city, state, postalCode, country: "India" };
}
