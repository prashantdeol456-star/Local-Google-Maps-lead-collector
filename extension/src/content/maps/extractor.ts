// Reads result cards and the opened detail panel from the Maps DOM, and builds
// the structured listing. No clicking/scrolling here (see page.ts).

import type { CollectorFieldSelection } from "@platform/shared";
import {
  canonicalMapsUrl,
  cleanText,
  parseAddress,
  parsePhoneItemId,
  parsePlaceUrl,
  parseRating,
  parseReviewCount,
  parseWebsite,
} from "./parser";
import { SELECTORS } from "./selectors";
import type { DetailFields, ExtractedListing, ResultCard } from "./types";

export function readResultCards(root: ParentNode): ResultCard[] {
  const feed = root.querySelector(SELECTORS.resultsFeed);
  if (!feed) return [];
  const seen = new Set<string>();
  const cards: ResultCard[] = [];
  for (const a of feed.querySelectorAll<HTMLAnchorElement>(SELECTORS.resultLink)) {
    const name = cleanText(a.getAttribute("aria-label"));
    const href = a.href || a.getAttribute("href") || "";
    if (!name || !href) continue;
    const ids = parsePlaceUrl(href);
    const key = ids.featureId ?? canonicalMapsUrl(href) ?? href;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ key, name, href, ...ids });
  }
  return cards;
}

/** Returns the detail panel element if an opened place is showing, else null. */
export function findDetailPanel(root: ParentNode): Element | null {
  return root.querySelector(SELECTORS.detailPanel);
}

export function readDetailFields(panel: ParentNode): DetailFields {
  const attr = (selector: string, name: string) => panel.querySelector(selector)?.getAttribute(name) ?? null;
  const text = (selector: string) => cleanText(panel.querySelector(selector)?.textContent);
  const reviews = panel.querySelector(SELECTORS.detailReviews);
  return {
    name: text(SELECTORS.detailName),
    category: text(SELECTORS.detailCategory),
    ratingLabel: attr(SELECTORS.detailRating, "aria-label"),
    reviewsLabel: reviews?.getAttribute("aria-label") ?? null,
    reviewsText: cleanText(reviews?.textContent),
    address: text(SELECTORS.detailAddress),
    phoneItemId: attr(SELECTORS.detailPhone, "data-item-id"),
    websiteHref: attr(SELECTORS.detailWebsite, "href"),
  };
}

/** Combines card + detail into a listing, applying the user's field selection. */
export function buildListing(
  card: ResultCard,
  detail: DetailFields,
  searchKeyword: string,
  fields: CollectorFieldSelection,
  location?: string | null,
): ExtractedListing {
  const address = detail.address;
  const parts = parseAddress(address, location);
  const pick = <T>(field: keyof CollectorFieldSelection, value: T): T | null => (fields[field] ? value : null);

  return {
    name: detail.name ?? card.name,
    category: pick("category", detail.category),
    phone: pick("phone", parsePhoneItemId(detail.phoneItemId)),
    email: null, // Google Maps does not show emails; enrichment is a future module
    website: pick("website", parseWebsite(detail.websiteHref)),
    address: pick("address", address),
    city: pick("city", parts.city),
    state: pick("state", parts.state),
    country: pick("country", parts.country),
    postalCode: pick("address", parts.postalCode),
    latitude: card.latitude,
    longitude: card.longitude,
    rating: pick("rating", parseRating(detail.ratingLabel)),
    reviewCount: pick("reviewCount", parseReviewCount(detail.reviewsText) ?? parseReviewCount(detail.reviewsLabel)),
    mapsUrl: pick("mapsUrl", canonicalMapsUrl(card.href)),
    placeId: card.placeId,
    searchKeyword,
    source: "google_maps",
    clientKey: card.key,
  };
}
