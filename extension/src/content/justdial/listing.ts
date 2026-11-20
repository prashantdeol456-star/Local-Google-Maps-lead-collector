// Reads Justdial's own result-list answers (/api/resultsPageListing: { results: { columns, data } }).
// Verified on justdial.com on 2026-11-20. Pure functions, no DOM access.

export interface JdListing {
  docid: string;
  name: string;
  /** "Tilak Nagar" */
  area: string | null;
  /** Short address shown in the list */
  address: string | null;
  pincode: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
  /** "Visa Assistance, Visa Assistance For Dubai" */
  categories: string | null;
  /** Profile page on justdial.com */
  profileUrl: string | null;
  thumbnail: string | null;
  /** Number Justdial shows in the list (usually empty: shown only after "Show Number") */
  phone: string | null;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "11 Ratings" → 11 */
function count(v: unknown): number | null {
  const m = String(v ?? "").replace(/,/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

function phoneOf(v: unknown): string | null {
  const raw = Array.isArray(v) ? v[0] : v;
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 8 ? digits : null;
}

function profileUrl(v: unknown): string | null {
  const path = text(v);
  if (!path) return null;
  try {
    const url = new URL(path.replace(/^\/*/, "/"), "https://www.justdial.com");
    return url.hostname.endsWith("justdial.com") ? url.href : null;
  } catch {
    return null;
  }
}

/** Listings in one answer, or [] if it is not a result list. */
export function parseListingResponse(body: string): JdListing[] {
  let json: { results?: { columns?: unknown; data?: unknown } };
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const cols = json?.results?.columns;
  const rows = json?.results?.data;
  if (!Array.isArray(cols) || !Array.isArray(rows)) return [];
  const at = (row: unknown[], name: string) => row[cols.indexOf(name)];
  const out: JdListing[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const docid = text(at(row, "docid"));
    const name = text(at(row, "name"));
    if (!docid || !name) continue;
    const lat = num(at(row, "lat"));
    const lon = num(at(row, "lon"));
    const rating = num(at(row, "compRating"));
    const area = text(at(row, "area"));
    out.push({
      docid,
      name,
      area,
      address: text(at(row, "NewAddress")) ?? area,
      pincode: text(at(row, "pincode")),
      city: text(at(row, "city")),
      latitude: lat !== null && Math.abs(lat) <= 90 && lat !== 0 ? lat : null,
      longitude: lon !== null && Math.abs(lon) <= 180 && lon !== 0 ? lon : null,
      rating: rating !== null && rating > 0 && rating <= 5 ? rating : null,
      reviewCount: count(at(row, "totJdReviews")) ?? count(at(row, "totalReviews")),
      categories: text(at(row, "type")),
      profileUrl: profileUrl(at(row, "weburl")),
      thumbnail: text(at(row, "thumbnail")),
      phone: phoneOf(at(row, "VNumber")),
    });
  }
  return out;
}

/** Justdial search page for a keyword in a city: "Study Visa Consultants", "New Delhi" → /New-Delhi/Study-Visa-Consultants */
export function justdialSearchUrl(keyword: string, city: string): string {
  const slug = (s: string) =>
    s
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join("-");
  return `https://www.justdial.com/${encodeURIComponent(slug(city))}/${encodeURIComponent(slug(keyword))}`;
}
