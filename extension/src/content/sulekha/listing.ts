// Reads Sulekha (sulekha.com) category lists and business pages. Verified on sulekha.com on
// 2026-11-28:
//  - a list is /{category}/{city} (page 1: 20 businesses), then /{category}/{city}/page-2, -3…
//    (10 each); past the end Sulekha shows page 1 again or an empty list
//  - each list carries a schema.org ItemList (name, area, pincode, business page link)
//  - each business page (…-contact-address) carries a schema.org LocalBusiness with telephone,
//    full address, map position and rating, and shows "Contact Person" in the page
//  - Sulekha's own search box suggests categories from azsearch.sulekha.com (title + list link)
// Pure functions over a Document or text, so they are tested without a browser.

export interface SuListing {
  /** The business page's name in the address ("infotech-gallery-vikaspuri-delhi") */
  id: string;
  name: string;
  /** "Vikaspuri" */
  area: string | null;
  pincode: string | null;
  profileUrl: string;
}

export interface SuProfile {
  name: string | null;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
  contactPerson: string | null;
  website: string | null;
}

export interface SuCategory {
  title: string;
  /** First page of the list, e.g. https://www.sulekha.com/student-visa-consultants/ghaziabad */
  url: string;
}

export type SuBlock = "captcha" | "access_denied";

export const SULEKHA_ORIGIN = "https://www.sulekha.com";

const text = (v: unknown) => (typeof v === "string" && v.replace(/\s+/g, " ").trim() ? v.replace(/\s+/g, " ").trim() : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Every schema.org object in the page's JSON-LD blocks (nested ones too). */
export function jsonLdObjects(doc: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    const rec = o as Record<string, unknown>;
    if (rec["@type"]) out.push(rec);
    Object.values(rec).forEach(walk);
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(s.textContent ?? ""));
    } catch {
      // a broken block: skip it
    }
  }
  return out;
}

const isType = (o: Record<string, unknown>, t: string) => o["@type"] === t || (Array.isArray(o["@type"]) && (o["@type"] as unknown[]).includes(t));

function profileId(url: string): string | null {
  try {
    const u = new URL(url, SULEKHA_ORIGIN);
    if (u.hostname !== "www.sulekha.com") return null;
    const m = u.pathname.match(/^\/(?:profile\/)?([a-z0-9-]+?)(?:-contact-address)?\/?$/i);
    return m ? m[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The businesses of a Sulekha list page (from its ItemList). */
export function readListings(doc: Document): SuListing[] {
  const out: SuListing[] = [];
  const seen = new Set<string>();
  for (const list of jsonLdObjects(doc).filter((o) => isType(o, "ItemList"))) {
    const items = Array.isArray(list.itemListElement) ? (list.itemListElement as Record<string, unknown>[]) : [];
    for (const el of items) {
      const item = (el?.item ?? el) as Record<string, unknown> | undefined;
      const name = text(item?.name);
      const url = text(item?.url);
      const id = url ? profileId(url) : null;
      if (!name || !url || !id || seen.has(id)) continue;
      seen.add(id);
      const addr = (item?.address ?? {}) as Record<string, unknown>;
      out.push({ id, name, area: text(addr.addressLocality), pincode: text(addr.postalCode), profileUrl: new URL(url, SULEKHA_ORIGIN).href });
    }
  }
  return out;
}

const SOCIAL = /(^|\.)(sulekha\.com|slkimgs\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|pinterest\.com|google\.[a-z.]+|goo\.gl|whatsapp\.com|wa\.me|justdial\.com|indiamart\.com)$/i;

/** "+919811607608" → "+919811607608"; Sulekha's own call-centre numbers are not on the business. */
function phoneOf(v: unknown): string | null {
  const raw = Array.isArray(v) ? v[0] : v;
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  const n = digits.replace(/\D/g, "").length;
  return n >= 8 && n <= 13 ? digits : null;
}

/** Phone, full address, map position, rating, contact person and website from a business page. */
export function readProfile(doc: Document): SuProfile | null {
  const biz = jsonLdObjects(doc).find((o) => isType(o, "LocalBusiness") && (o.telephone || o.address) && text(o.name) !== "Sulekha.com");
  if (!biz) return null;
  const addr = (biz.address ?? {}) as Record<string, unknown>;
  const geo = (biz.geo ?? {}) as Record<string, unknown>;
  const rating = (biz.aggregateRating ?? {}) as Record<string, unknown>;
  const contact = (biz.contactPoint ?? {}) as Record<string, unknown>;
  const lat = num(geo.latitude);
  const lon = num(geo.longitude);
  const stars = num(rating.ratingValue);
  const same = (Array.isArray(biz.sameAs) ? biz.sameAs : [biz.sameAs]).filter((s): s is string => typeof s === "string");
  let website: string | null = null;
  for (const s of [text(biz.website), ...same]) {
    if (!s) continue;
    try {
      const u = new URL(s);
      if (/^https?:$/.test(u.protocol) && !SOCIAL.test(u.hostname)) {
        website = u.href;
        break;
      }
    } catch {
      // not an address
    }
  }
  // "Contact Information · Contact Person · Ravideep Singh · Address …"
  const lines = ((doc.body as HTMLElement | null)?.innerText || doc.body?.textContent || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => /^contact person$/i.test(l));
  let contactPerson = at >= 0 ? text(lines[at + 1]) : null;
  if (!contactPerson) contactPerson = text(((doc.body?.textContent ?? "").match(/Contact Person\s*:?\s*([A-Z][A-Za-z.' ]{1,40}?)(?=\s*(?:Address|Opening|Phone|Mobile|$))/) ?? [])[1]);
  return {
    name: text(biz.name),
    address: text(addr.streetAddress) ?? ([text(addr.addressLocality), text(addr.postalCode)].filter(Boolean).join(" - ") || null),
    phone: phoneOf(biz.telephone) ?? phoneOf(contact.telephone),
    latitude: lat !== null && lat !== 0 && Math.abs(lat) <= 90 ? lat : null,
    longitude: lon !== null && lon !== 0 && Math.abs(lon) <= 180 ? lon : null,
    rating: stars !== null && stars > 0 && stars <= 5 ? stars : null,
    reviewCount: num(rating.reviewCount),
    contactPerson,
    website,
  };
}

// ---- Addresses ----

/** Page number of a list address (/x/delhi → 1, /x/delhi/page-3 → 3), null when it is not a list. */
export function pageNumberOf(url: string): number | null {
  try {
    const u = new URL(url, SULEKHA_ORIGIN);
    if (u.hostname !== "www.sulekha.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && !/-contact-address$/i.test(parts[1]!) && parts[0] !== "profile") return 1;
    if (parts.length === 3 && /^page-\d+$/i.test(parts[2]!)) return Number(parts[2]!.slice(5));
    return null;
  } catch {
    return null;
  }
}

/** The first page of a list address (/x/delhi/page-3 → /x/delhi). */
export function listBase(url: string): string {
  const u = new URL(url, SULEKHA_ORIGIN);
  const parts = u.pathname.split("/").filter(Boolean).slice(0, 2);
  return `${SULEKHA_ORIGIN}/${parts.join("/")}`;
}

/** Page n of a list (1 = the list itself). */
export function pageUrl(base: string, n: number): string {
  const b = listBase(base);
  return n <= 1 ? b : `${b}/page-${n}`;
}

/** A Sulekha list address the user pasted instead of a keyword. */
export function isSulekhaListUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) && pageNumberOf(value.trim()) !== null;
}

const title = (slug: string) =>
  decodeURIComponent(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase());

/** "Student Visa Consultants" and "Ghaziabad" from a pasted list address. */
export function searchOfUrl(url: string): { keyword: string; city: string } | null {
  if (!isSulekhaListUrl(url)) return null;
  const [cat, city] = new URL(url.trim()).pathname.split("/").filter(Boolean);
  return { keyword: title(cat!), city: title(city!) };
}

const CITY_ALIASES: Record<string, string> = {
  "new delhi": "delhi",
  "delhi ncr": "delhi",
  bengaluru: "bangalore",
  gurugram: "gurgaon",
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  greaternoida: "greater noida",
  mysuru: "mysore",
  prayagraj: "allahabad",
  vizag: "visakhapatnam",
};

/** The city name Sulekha uses ("Bengaluru" → "bangalore", "New Delhi" → "delhi"). */
export function sulekhaCity(typed: string): string {
  const c = typed.trim().replace(/\s+/g, " ").toLowerCase();
  return CITY_ALIASES[c] ?? c;
}

/** Sulekha's search suggestions address for a keyword in a city. */
export function suggestUrl(keyword: string, city: string): string {
  return `https://azsearch.sulekha.com/api/search/home-common-search-v2?cityName=${encodeURIComponent(sulekhaCity(city))}&query=${encodeURIComponent(keyword.trim())}&wt=json`;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !["and", "&", "in", "for", "the", "of", "services", "service"].includes(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(?<=[a-z]{3})s$/, ""));

/**
 * The best category for a keyword among Sulekha's suggestions: same words first (all of the
 * keyword's words, fewest others), a main category before a sub-category. Business suggestions
 * and categories on other Sulekha sites (packersandmovers.sulekha.com…) are skipped.
 */
export function chooseCategory(body: string, keyword: string, city: string): { best: SuCategory | null; exact: boolean; others: string[] } {
  let json: { result?: { title?: unknown; url?: unknown; docType?: unknown }[] };
  try {
    json = JSON.parse(body);
  } catch {
    return { best: null, exact: false, others: [] };
  }
  const want = words(keyword);
  const citySlug = sulekhaCity(city).replace(/\s+/g, "-");
  const scored: { cat: SuCategory; score: number }[] = [];
  for (const r of json.result ?? []) {
    const t = text(Array.isArray(r.title) ? r.title[0] : r.title);
    const url = text(r.url);
    if (!t || !url || String(r.docType) === "5") continue;
    let u: URL;
    try {
      u = new URL(url, SULEKHA_ORIGIN);
    } catch {
      continue;
    }
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.hostname !== "www.sulekha.com" || parts.length !== 2 || /-contact-address$/.test(parts[1]!)) continue;
    const have = words(t.replace(/\/.*$/, ""));
    const matched = want.filter((w) => have.includes(w)).length;
    if (matched === 0) continue;
    const score = matched / want.length - 0.1 * Math.max(0, have.length - matched) + (String(r.docType) === "2" ? 0.05 : 0);
    scored.push({ cat: { title: t, url: `${SULEKHA_ORIGIN}/${parts[0]}/${citySlug}` }, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.cat ?? null;
  return { best, exact: !!best && sameWords(best.title, keyword), others: scored.slice(1, 6).map((s) => s.cat.title) };
}

/** "Mobile Phone Dealers/Services" and "mobile phone dealer" name the same category. */
export function sameWords(categoryTitle: string, keyword: string): boolean {
  const a = new Set(words(categoryTitle.replace(/\/.*$/, "")));
  const b = new Set(words(keyword));
  return a.size > 0 && a.size === b.size && [...a].every((w) => b.has(w));
}

/** Number of words Sulekha cares about in a keyword ("Mobile" → 1). */
export const keywordWords = (keyword: string) => words(keyword).length;

/** Other category lists the page links to (breadcrumb, related categories) in the same city. */
export function relatedCategories(doc: Document, pageUrl: string): SuCategory[] {
  const city = new URL(pageUrl, SULEKHA_ORIGIN).pathname.split("/").filter(Boolean)[1]?.toLowerCase();
  const out: SuCategory[] = [];
  const seen = new Set<string>();
  for (const a of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const t = text(a.textContent);
    if (!t || t.length > 80) continue;
    let u: URL;
    try {
      u = new URL(a.getAttribute("href")!, SULEKHA_ORIGIN);
    } catch {
      continue;
    }
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.hostname !== "www.sulekha.com" || u.search || parts.length !== 2 || parts[1]!.toLowerCase() !== city || pageNumberOf(u.href) !== 1) continue;
    const url = `${SULEKHA_ORIGIN}/${parts[0]}/${parts[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title: t, url });
  }
  return out;
}

/** A security check or a block page instead of Sulekha's content. */
export function detectBlock(doc: Document): SuBlock | null {
  const body = ((doc.body as HTMLElement | null)?.innerText || doc.body?.textContent || "").slice(0, 1500);
  const all = `${doc.title} ${body}`;
  const content = jsonLdObjects(doc).some((o) => isType(o, "ItemList") || isType(o, "LocalBusiness"));
  if (!content && (doc.querySelector("#challenge-form, .cf-challenge, iframe[src*='challenges.cloudflare.com']") || /just a moment|verify you are (a )?human|checking your browser|are you a robot/i.test(all))) return "captcha";
  if (/^\s*(access denied|403 forbidden)/i.test(doc.title) || /^\s*(access denied|403 forbidden)/i.test(body) || /you have been blocked|too many requests/i.test(all)) return "access_denied";
  return null;
}
