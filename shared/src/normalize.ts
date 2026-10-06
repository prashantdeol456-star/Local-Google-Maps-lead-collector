// Deterministic normalization used for duplicate detection (no AI, no guessing).
// The same code runs in the extension and the backend so both make the same decision.

/** Trims and collapses all whitespace; empty → null. */
export function normalizeWhitespace(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.replace(/\s+/g, " ").trim();
  return v || null;
}

/** Lowercase, accents removed, "&" → "and", punctuation removed, single spaces. */
function normalizeWords(value: string | null | undefined): string | null {
  const v = normalizeWhitespace(value);
  if (!v) return null;
  const out = v
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "") // "St. Xavier's" → "st xaviers"
    // Any other punctuation/symbol → space. \p{M} keeps Indic vowel signs (matras), so Hindi names survive.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out || null;
}

export function normalizeName(name: string | null | undefined): string | null {
  return normalizeWords(name);
}

export function normalizeAddress(address: string | null | undefined): string | null {
  const words = normalizeWords(address);
  return words ? words.replace(/ india$/, "").trim() || null : null;
}

// ---- Phone ----

const DEFAULT_COUNTRY_CODE = "91"; // India

/**
 * Normalizes a phone number to E.164 ("+918957926677"), or null if it does not look valid.
 * Indian rules: 10-digit mobiles (6–9…), trunk "0" + 10 digits (mobile or STD landline),
 * "91" + 10 digits, "0091"/"+91". Other countries are accepted only with an explicit "+" or "00".
 */
export function normalizePhone(raw: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const v = normalizeWhitespace(raw);
  if (!v) return null;
  const hasPlus = v.startsWith("+");
  let digits = v.replace(/\D/g, "");
  if (!digits) return null;

  let e164: string;
  if (hasPlus) e164 = digits;
  else if (digits.startsWith("00")) e164 = digits.slice(2);
  else if (countryCode === "91" && INDIAN_TOLL_FREE.test(digits)) e164 = `91${digits}`;
  else if (countryCode === "91") {
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 12 && digits.startsWith("91")) e164 = digits;
    else if (digits.length === 10) e164 = `91${digits}`;
    else return null;
  } else {
    e164 = digits.startsWith(countryCode) ? digits : `${countryCode}${digits.replace(/^0/, "")}`;
  }

  if (e164.length < 8 || e164.length > 15 || e164.startsWith("0")) return null;
  // Indian numbers: 91 + 10 digits (toll-free/shared service numbers are 10–11 digits).
  // The 10 digits never start with 0 (that is the trunk prefix, e.g. 0522… → +91 522…).
  if (e164.startsWith("91") && e164.length !== 12 && !INDIAN_TOLL_FREE.test(e164.slice(2))) return null;
  if (e164.startsWith("910")) return null;
  return `+${e164}`;
}

/** 1800 / 1860 / 1600 service numbers, 10–11 digits. */
const INDIAN_TOLL_FREE = /^1(800|860|600)\d{6,7}$/;

/**
 * Toll-free / shared service numbers are used by many unrelated branches,
 * so they must never be used to decide two listings are the same business.
 */
export function isSharedPhone(e164: string): boolean {
  return e164.startsWith("+91") && INDIAN_TOLL_FREE.test(e164.slice(3));
}

// ---- Website ----

/** Hosts whose URLs do not identify one business (redirectors, Google, messaging). */
const NON_IDENTIFYING_HOSTS = [
  "google.com",
  "google.co.in",
  "goo.gl",
  "maps.app.goo.gl",
  "bit.ly",
  "tinyurl.com",
  "wa.me",
  "whatsapp.com",
  "api.whatsapp.com",
  "linktr.ee",
];

/** Links that are not web pages ("mailto:x@y.com" would otherwise parse as host "y.com"). */
const NON_WEB_SCHEME = /^(mailto|tel|sms|javascript|data|whatsapp|intent|file|ftp):/i;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Normalizes a website to "host/path" for comparison: lowercase host without "www."/"m.",
 * no scheme, query, fragment, trailing slash or index page.
 * The path is kept on purpose: "amity.edu/lucknow" and "amity.edu/noida" are different campuses.
 */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const v = normalizeWhitespace(raw);
  if (!v) return null;
  if (NON_WEB_SCHEME.test(v)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^(www\d*|m)\./, "").replace(/\.$/, "");
  if (!host.includes(".")) return null;
  let path = safeDecode(url.pathname)
    .toLowerCase()
    .replace(/\/(index|default|home)\.(html?|php|aspx?)$/, "/")
    .replace(/\/+$/, "");
  if (path === "/") path = "";
  return `${host}${path}`;
}

/** False for links that cannot identify a single business. */
export function isIdentifyingWebsite(normalized: string): boolean {
  const host = normalized.split("/")[0]!;
  return !NON_IDENTIFYING_HOSTS.some((d) => hostMatches(host, d));
}
