// Duplicate detection rules. Deterministic; when unsure, records are kept separate.
//
// Priority:
//   1. placeId                     (same Google place)
//   2. normalized phone            (not toll-free/shared numbers)
//   3. normalized website          (host + path, not redirectors/messaging links)
//   4. normalized name + address   (both required — a similar name alone never merges)
//
// Safety rule: two records with *different* placeIds are different Google listings,
// so they are never merged by phone / website / name+address.

import {
  isIdentifyingWebsite,
  isSharedPhone,
  normalizeAddress,
  normalizeName,
  normalizePhone,
  normalizeWebsite,
} from "./normalize.js";

export const MATCH_PRIORITY = ["placeId", "phone", "website", "nameAddress"] as const;
export type MatchedBy = (typeof MATCH_PRIORITY)[number];

export interface DedupeInput {
  placeId?: string | null;
  name: string;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
}

export interface NormalizedFields {
  normalizedName: string;
  normalizedPhone: string | null;
  normalizedWebsite: string | null;
  normalizedAddress: string | null;
}

/** Keys usable for matching; null when that signal is missing or not trustworthy. */
export interface DedupeKeys {
  placeId: string | null;
  phone: string | null;
  website: string | null;
  nameAddress: string | null;
}

export function normalizeLeadFields(input: DedupeInput): NormalizedFields {
  return {
    normalizedName: normalizeName(input.name) ?? "",
    normalizedPhone: normalizePhone(input.phone),
    normalizedWebsite: normalizeWebsite(input.website),
    normalizedAddress: normalizeAddress(input.address),
  };
}

export function nameAddressKey(normalizedName: string | null, normalizedAddress: string | null): string | null {
  return normalizedName && normalizedAddress ? `${normalizedName}|${normalizedAddress}` : null;
}

export function dedupeKeys(input: DedupeInput): DedupeKeys {
  const n = normalizeLeadFields(input);
  return {
    placeId: input.placeId?.trim() || null,
    phone: n.normalizedPhone && !isSharedPhone(n.normalizedPhone) ? n.normalizedPhone : null,
    website: n.normalizedWebsite && isIdentifyingWebsite(n.normalizedWebsite) ? n.normalizedWebsite : null,
    nameAddress: nameAddressKey(n.normalizedName || null, n.normalizedAddress),
  };
}

/**
 * The single strongest key, stored in a UNIQUE column as a database-level guard.
 * Returns null when there is no reliable key (the caller then stores a unique random key,
 * i.e. the record is never auto-merged).
 */
export function primaryDedupeKey(keys: DedupeKeys): string | null {
  if (keys.placeId) return `pid:${keys.placeId}`;
  if (keys.phone) return `ph:${keys.phone}`;
  if (keys.website) return `web:${keys.website}`;
  if (keys.nameAddress) return `na:${keys.nameAddress}`;
  return null;
}

/**
 * Whether a record found by `matchedBy` really is the same business.
 * Different placeIds always mean different listings.
 */
export function confirmsMatch(
  candidatePlaceId: string | null,
  existingPlaceId: string | null,
  matchedBy: MatchedBy,
): boolean {
  if (matchedBy === "placeId") return true;
  return !(candidatePlaceId && existingPlaceId && candidatePlaceId !== existingPlaceId);
}

/**
 * Finds the first matching record, checking keys in priority order.
 * `lookup` returns stored records having the given key (any storage: DB, memory).
 */
export async function findDuplicate<T extends { placeId: string | null }>(
  keys: DedupeKeys,
  lookup: (by: MatchedBy, value: string) => Promise<T[]> | T[],
): Promise<{ record: T; matchedBy: MatchedBy } | null> {
  for (const by of MATCH_PRIORITY) {
    const value = keys[by];
    if (!value) continue;
    for (const record of await lookup(by, value)) {
      if (confirmsMatch(keys.placeId, record.placeId, by)) return { record, matchedBy: by };
    }
  }
  return null;
}
