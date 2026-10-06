/** A result card in the list, before opening it. */
export interface ResultCard {
  /** Stable key for "already processed" tracking: featureId, else the place path. */
  key: string;
  name: string;
  href: string;
  placeId: string | null;
  featureId: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Raw values read from an opened place's detail panel. */
export interface DetailFields {
  name: string | null;
  category: string | null;
  ratingLabel: string | null;
  reviewsLabel: string | null;
  reviewsText: string | null;
  address: string | null;
  phoneItemId: string | null;
  websiteHref: string | null;
}

/** Structured listing produced by the extractor (fields not available are null). */
export interface ExtractedListing {
  name: string;
  category: string | null;
  phone: string | null;
  email: null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  placeId: string | null;
  searchKeyword: string;
  source: "google_maps";
  /** Internal: processed-tracking key (feature id). */
  clientKey: string;
}

export type ChallengeKind = "captcha" | "unusual_traffic" | "consent";
