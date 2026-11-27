// Reads Grotal (grotal.com) result pages and business pages. Grotal is a plain server-made site:
// every list page shows up to 20 businesses (".result-row" cards with name, area, address, phone
// and categories), and the next pages are the same address with P2, P3… Verified on grotal.com on
// 2026-11-28. Pure functions over a Document, so they are tested without a browser.

export interface GrListing {
  /** Grotal's number of the business ("338137") */
  id: string;
  name: string;
  /** "Karol Bagh" */
  area: string | null;
  address: string | null;
  phone: string | null;
  /** "Mobile Phone Dealers, Cell Phones" */
  categories: string | null;
  /** The business page on grotal.com */
  profileUrl: string | null;
}

export interface GrProfile {
  address: string | null;
  phone: string | null;
  contactPerson: string | null;
  email: string | null;
  website: string | null;
}

export type GrBlock = "captcha" | "access_denied";

export const GROTAL_ORIGIN = "https://www.grotal.com";

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t && !/^(na|n\/a|undefined|null|-)$/i.test(t) ? t : null;
};

/** The first phone number in a text ("09313410164, 011 2345 6789" → "09313410164"). */
export function phoneOf(text: string | null | undefined): string | null {
  for (const part of String(text ?? "").split(/[,/;|]/)) {
    const v = part.replace(/[^\d+]/g, "");
    if (v.replace(/\D/g, "").length >= 8 && v.replace(/\D/g, "").length <= 13) return v;
  }
  return null;
}

/** 'javascript:Navigate("Website-of-Sri-Sai-Telecom-in-Delhi-338137/");' → page address and id */
function profileOf(onclick: string | null): { url: string; id: string } | null {
  const m = onclick?.match(/Navigate\(\s*["']([^"']+)["']/);
  if (!m) return null;
  try {
    const url = new URL(m[1]!.replace(/^\/*/, "/"), GROTAL_ORIGIN);
    const id = url.pathname.match(/-(\d+)\/?$/)?.[1];
    return url.hostname === "www.grotal.com" && id ? { url: url.href, id } : null;
  } catch {
    return null;
  }
}

/** A stable id when a card has no business page link (name + address). */
function fallbackId(name: string, address: string | null) {
  let h = 0;
  for (const c of `${name}|${address ?? ""}`.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `n${(h >>> 0).toString(36)}`;
}

/** The businesses on a Grotal result page (advertisement rows are skipped). */
export function readListings(doc: Document): GrListing[] {
  const out: GrListing[] = [];
  const seen = new Set<string>();
  for (const row of doc.querySelectorAll<HTMLElement>(".result-row")) {
    const header = row.querySelector<HTMLElement>(".glListingHeader");
    if (!header) continue;
    const nameEl = header.querySelector<HTMLElement>(".cursor") ?? header;
    const name = clean(nameEl.textContent);
    if (!name) continue;
    const address = clean(row.querySelector(".address")?.textContent);
    const page = profileOf(nameEl.getAttribute("onclick") ?? header.getAttribute("onclick"));
    const id = page?.id ?? fallbackId(name, address);
    if (seen.has(id)) continue;
    seen.add(id);
    const cats: string[] = [];
    for (const e of row.querySelectorAll(".desc b, .desc a")) {
      const c = clean(e.textContent);
      if (c && c.toLowerCase() !== name.toLowerCase() && !cats.some((x) => x.toLowerCase() === c.toLowerCase())) cats.push(c);
    }
    out.push({
      id,
      name,
      area: clean(row.querySelector(".area")?.textContent),
      address,
      phone: phoneOf(row.querySelector(".ph-no")?.textContent),
      categories: cats.length ? cats.join(", ") : null,
      profileUrl: page?.url ?? null,
    });
  }
  return out;
}

/** Page number in a Grotal list address (…-C44A267P3A0/ → 3), or null when it is not one. */
export function pageNumberOf(url: string): number | null {
  const m = url.match(/-C\d+A\d+P(\d+)A\d+\/?(?:[?#].*)?$/i);
  return m ? Number(m[1]) : null;
}

/** The same list one page further (…P3A0/ → …P4A0/). */
export function nextPageUrl(url: string): string | null {
  const n = pageNumberOf(url);
  if (n === null) return null;
  return url.replace(/(-C\d+A\d+P)(\d+)(A\d+\/?)(?:[?#].*)?$/i, (_m, a: string, _p: string, b: string) => `${a}${n + 1}${b}`);
}

/** Whether the page links to the next page of the list (the numbers under the list). */
export function hasNextPage(doc: Document, url: string): boolean {
  const next = nextPageUrl(url);
  if (!next) return false;
  const want = new URL(next).pathname.replace(/\/$/, "").toLowerCase();
  return [...doc.querySelectorAll<HTMLAnchorElement>("a[href]")].some((a) => {
    try {
      return new URL(a.getAttribute("href")!, GROTAL_ORIGIN).pathname.replace(/\/$/, "").toLowerCase() === want;
    } catch {
      return false;
    }
  });
}

const slugWords = (s: string) =>
  s
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** Grotal's search address: "Mobile Phone Dealers", Mumbai (45) → /Mumbai/mobile-phone-dealers-C45A0P1A0/ */
export function grotalSearchUrl(keyword: string, city: { name: string; id: string }): string {
  const cityPart = slugWords(city.name).join("-");
  const kw = slugWords(keyword).join("-").toLowerCase();
  return `${GROTAL_ORIGIN}/${encodeURIComponent(cityPart)}/${encodeURIComponent(kw)}-C${city.id}A0P1A0/`;
}

/** A Grotal list address the user pasted instead of a keyword. */
export function isGrotalListUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.hostname === "www.grotal.com" && pageNumberOf(u.href) !== null;
  } catch {
    return false;
  }
}

/** "Mobile Phone Dealers" and "Delhi" from a pasted list address (…/Delhi/Mobile-Phone-Dealers-C44A267P1A0/). */
export function searchOfUrl(url: string): { keyword: string; city: string } | null {
  try {
    const parts = new URL(url.trim()).pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const words = (s: string) => decodeURIComponent(s).replace(/-C\d+A\d+P\d+A\d+$/i, "").replace(/-/g, " ").replace(/\s+/g, " ").trim().replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase());
    const keyword = words(parts[1]!);
    return keyword ? { keyword, city: words(parts[0]!) } : null;
  } catch {
    return null;
  }
}

/** Grotal's city list (/Handler/ajax.ashx?CountryId=1): <City name="Agra" id="85" /> … */
export function parseCities(xml: string): { name: string; id: string }[] {
  const out: { name: string; id: string }[] = [];
  for (const m of xml.matchAll(/<City\b([^>]*)\/?>/gi)) {
    const name = m[1]!.match(/\bname\s*=\s*"([^"]*)"/i)?.[1]?.trim();
    const id = m[1]!.match(/\bid\s*=\s*"(\d+)"/i)?.[1];
    if (name && id) out.push({ name, id });
  }
  return out;
}

const CITY_ALIASES: Record<string, string> = {
  "new delhi": "delhi",
  bengaluru: "bangalore",
  gurugram: "gurgaon",
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  "navi mumbai": "navi mumbai",
  prayagraj: "allahabad",
  mysuru: "mysore",
  vadodara: "baroda",
};

/** The city the user typed, in Grotal's list (exact name, a common other name, or the start of one). */
export function findCity(cities: { name: string; id: string }[], typed: string): { name: string; id: string } | null {
  const want = typed.trim().replace(/\s+/g, " ").toLowerCase();
  if (!want) return null;
  const by = (n: string) => cities.find((c) => c.name.toLowerCase() === n);
  return by(want) ?? (CITY_ALIASES[want] ? by(CITY_ALIASES[want]!) : undefined) ?? cities.find((c) => c.name.toLowerCase().startsWith(want)) ?? null;
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const NOT_WEBSITES = /(^|\.)(grotal\.com|google\.[a-z.]+|googlesyndication\.com|doubleclick\.net|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|whatsapp\.com|wa\.me)$/i;

/** The value under a label on a business page ("Email Id:" → next line). */
function after(lines: string[], label: RegExp): string | null {
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return null;
  const same = lines[i]!.replace(label, "").replace(/^[\s:]+/, "");
  return clean(same) ?? clean(lines[i + 1]);
}

/** Address, phone, contact person, email and website from a Grotal business page. */
export function readProfile(doc: Document): GrProfile {
  const text = (doc.body as HTMLElement | null)?.innerText || doc.body?.textContent || "";
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const emailText = after(lines, /^email\s*id\s*:?/i);
  const mailto = doc.querySelector<HTMLAnchorElement>("a[href^='mailto:' i]")?.getAttribute("href")?.replace(/^mailto:/i, "").split("?")[0];
  const email = [emailText, mailto].map((e) => e?.trim().toLowerCase()).find((e) => !!e && EMAIL.test(e) && !/grotal\.com$/.test(e)) ?? null;
  let website: string | null = null;
  const siteText = after(lines, /^website\s*:?/i);
  for (const candidate of [siteText, ...[...doc.querySelectorAll<HTMLAnchorElement>("a[href^='http']")].filter((a) => /website/i.test(a.textContent ?? "")).map((a) => a.href)]) {
    if (!candidate) continue;
    try {
      const u = new URL(/^https?:\/\//i.test(candidate) ? candidate : `http://${candidate}`);
      if (u.hostname.includes(".") && !NOT_WEBSITES.test(u.hostname)) {
        website = u.href;
        break;
      }
    } catch {
      // not an address
    }
  }
  return {
    address: after(lines, /^address\s*:?/i),
    phone: phoneOf(after(lines, /^phone\s*no\.?\s*:?/i)),
    contactPerson: after(lines, /^contact\s*person\s*:?/i),
    email,
    website,
  };
}

/** A security check or a block page instead of Grotal's content. */
export function detectBlock(doc: Document): GrBlock | null {
  // Grotal keeps an invisible reCAPTCHA on normal pages (for its forms): a check only counts when
  // the page shows no listings and no business details.
  const content = !!doc.querySelector(".result-row, .glListingHeader") || /Phone No|Email Id|Business Information/i.test(doc.body?.textContent ?? "");
  if (!content && doc.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], #challenge-form, .cf-challenge")) return "captcha";
  // Only the page's own words (business pages have a picture code for reviews, which is not a block).
  const body = ((doc.body as HTMLElement | null)?.innerText || doc.body?.textContent || "").slice(0, 1500);
  const text = `${doc.title} ${body}`;
  if (/verify you are (a )?human|are you a robot|checking your browser/i.test(text)) return "captcha";
  if (/^\s*(access denied|403 forbidden)/i.test(doc.title) || /^\s*(access denied|403 forbidden)/i.test(body) || /you have been blocked|too many requests/i.test(text)) return "access_denied";
  return null;
}
