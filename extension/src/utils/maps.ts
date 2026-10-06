// Google Maps URL helpers. Keep host list in sync with manifest.json content_scripts.matches.
export const MAPS_HOSTS = ["www.google.com", "www.google.co.in"] as const;

export interface MapsPageState {
  isMaps: boolean;
  isSearch: boolean;
  isPlace: boolean;
  query: string | null;
  url: string;
  updatedAt: number;
}

function decodeSegment(segment: string): string {
  const spaced = segment.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced).trim();
  } catch {
    return spaced.trim();
  }
}

export function parseMapsPage(rawUrl: string, now = Date.now()): MapsPageState {
  const base: MapsPageState = { isMaps: false, isSearch: false, isPlace: false, query: null, url: rawUrl, updatedAt: now };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return base;
  }
  if (!(MAPS_HOSTS as readonly string[]).includes(url.hostname) || !url.pathname.startsWith("/maps")) return base;

  const parts = url.pathname.split("/").filter(Boolean); // ["maps", "search", "<query>", ...]
  const kind = parts[1];
  const segment = parts[2] && !parts[2].startsWith("@") ? decodeSegment(parts[2]) : null;
  return {
    ...base,
    isMaps: true,
    isSearch: kind === "search" && !!segment,
    isPlace: kind === "place",
    query: kind === "search" ? segment : null,
  };
}

export function buildMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(query.trim()).replace(/%20/g, "+")}`;
}
