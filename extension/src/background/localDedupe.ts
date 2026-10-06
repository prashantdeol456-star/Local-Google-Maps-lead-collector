import { dedupeKeys, findDuplicate, type MatchedBy } from "@platform/shared";
import type { ExtractedListing } from "../content/maps/types";

/** key "phone:+91…" → the first listing seen with it in this run. */
export type SeenIndex = Record<string, { name: string; placeId: string | null }>;

/**
 * Immediate, local duplicate hint within the current run, using the same rules as the backend.
 * Only used for feedback in the side panel; the backend decides what is saved.
 */
export async function checkLocalDuplicate(
  index: SeenIndex,
  listing: ExtractedListing,
): Promise<{ duplicateOf: { name: string; by: MatchedBy } | null; index: SeenIndex }> {
  const keys = dedupeKeys(listing);
  const match = await findDuplicate(keys, (by, value) => {
    const hit = index[`${by}:${value}`];
    return hit ? [hit] : [];
  });

  const next = { ...index };
  for (const [by, value] of Object.entries(keys)) {
    if (value && !next[`${by}:${value}`]) next[`${by}:${value}`] = { name: listing.name, placeId: keys.placeId };
  }
  return { duplicateOf: match ? { name: match.record.name, by: match.matchedBy } : null, index: next };
}
