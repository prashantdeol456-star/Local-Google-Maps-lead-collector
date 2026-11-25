// Finds the emails and phone numbers a page shows: email/phone links (mailto:, tel:, wa.me) and
// what is written in the text, including the usual "info [at] shop [dot] com" spellings.
// Pure functions on text and link targets: used on the open page (content script) and on a
// site's Contact/About pages read in the background. Nothing is guessed: only what is written.

export type FoundHow = "link" | "text" | "whatsapp";

export interface FoundValue {
  value: string;
  how: FoundHow;
  /** Hunter's confidence 0–100 (emails from the email finder) */
  score?: number | null;
  /** Deliverability: valid | invalid | accept_all | unknown … */
  verified?: string | null;
}

export interface PageFindings {
  emails: FoundValue[];
  phones: FoundValue[];
  /** LinkedIn, Facebook, Instagram, X, YouTube pages the site links to */
  socials: string[];
}

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const EMAIL_EXACT = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/;
/** Not real mailboxes: file names, placeholders, tracking and platform addresses. */
const NOT_EMAIL =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|pdf)$|@(example|domain|email|yoursite|yourdomain|website|test|sentry|wixpress|sentry-next|mysite)\.|^(name|your\.?name|yourname|user|username|email|someone|john\.?doe)@|@\d+x\.|^no-?reply@|^noreply/i;

/** "info [at] shop [dot] com", "info(at)shop(dot)com", "info at shop dot com" → "info@shop.com" */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({<]\s*(?:at|@)\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*(?:dot|\.)\s*[\])}>]\s*/gi, ".")
    .replace(/\b([a-z0-9._%+-]+)\s+at\s+([a-z0-9-]+)\s+dot\s+([a-z]{2,24})(?:\s+dot\s+([a-z]{2,24}))?\b/gi, (_m, u, d, t1, t2) => `${u}@${d}.${t1}${t2 ? `.${t2}` : ""}`);
}

export function cleanEmail(raw: string): string | null {
  const email = raw.trim().replace(/^mailto:/i, "").split("?")[0]!.replace(/[.,;:]+$/, "").toLowerCase();
  return EMAIL_EXACT.test(email) && !NOT_EMAIL.test(email) ? email : null;
}

/** Digits of a phone number with a leading + kept, e.g. "+91 98100-12345" → "+919810012345". */
export function phoneDigits(raw: string): string {
  const plus = raw.trim().startsWith("+");
  return (plus ? "+" : "") + raw.replace(/\D/g, "");
}

/** A number written in the text looks like a phone (not an order id, a date or a price). */
export function looksLikePhone(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return false;
  if (/^(\d)\1+$/.test(d) || "01234567890123".includes(d) || "98765432109876".includes(d)) return false;
  const plus = raw.trim().startsWith("+");
  if (plus) return true;
  if (d.length === 10) return /^[6-9]/.test(d); // Indian mobile
  if (d.length === 11) return /^0/.test(d) || /^1800/.test(d); // 0 + STD code, toll-free
  if (d.length === 12) return /^91[6-9]/.test(d) || /^0091/.test(d);
  return /^0091/.test(d);
}

const PHONE_IN_TEXT = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d{2,5}(?:[\s.-]?\d{2,5}){1,4}/g;

/** Formats for display: "+91 98100 12345", "011 4501 2345"; otherwise as written. */
export function displayPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 12 && /^91[6-9]/.test(d)) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return raw.replace(/\s+/g, " ").trim();
}

const SOCIAL = /^https?:\/\/(?:[a-z]+\.)?(linkedin\.com\/(?:company|in|school)\/|facebook\.com\/|instagram\.com\/|x\.com\/|twitter\.com\/|youtube\.com\/)/i;

/** Emails, phones and social links in a page's text and link targets. */
export function findContacts(input: { text: string; hrefs: string[] }): PageFindings {
  const emails = new Map<string, FoundValue>();
  const phones = new Map<string, FoundValue>();
  const socials = new Set<string>();
  const addEmail = (raw: string, how: FoundHow) => {
    const e = cleanEmail(raw);
    if (e && !emails.has(e)) emails.set(e, { value: e, how });
  };
  const addPhone = (raw: string, how: FoundHow) => {
    const key = raw.replace(/\D/g, "").replace(/^(0091|91|0)(?=[6-9]\d{9}$)/, "");
    if (key.length < 7 || phones.has(key)) return;
    phones.set(key, { value: displayPhone(raw), how });
  };

  for (const href of input.hrefs) {
    if (/^mailto:/i.test(href)) {
      let raw = href.slice(7);
      try {
        raw = decodeURIComponent(raw);
      } catch {
        /* as written */
      }
      raw.split(/[,;]/).forEach((e) => addEmail(e, "link"));
    } else if (/^tel:/i.test(href)) {
      let raw = href.slice(4);
      try {
        raw = decodeURIComponent(raw);
      } catch {
        /* as written */
      }
      const d = raw.replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 15) addPhone(raw, "link");
    } else {
      const wa = /^https?:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|(?:web\.)?whatsapp\.com\/send\/?\?phone=)\+?(\d{10,15})/i.exec(href);
      if (wa) addPhone(`+${wa[1]}`, "whatsapp");
      else if (SOCIAL.test(href)) socials.add(href.split(/[?#]/)[0]!.replace(/\/+$/, ""));
    }
  }

  const text = deobfuscate(input.text);
  for (const m of text.match(EMAIL) ?? []) addEmail(m, "text");
  for (const m of input.text.match(PHONE_IN_TEXT) ?? []) if (looksLikePhone(m)) addPhone(m, "text");

  return { emails: [...emails.values()], phones: [...phones.values()], socials: [...socials].slice(0, 20) };
}

const CONTACT_PAGE = /(contact|about|reach|get-in-touch|getintouch|support|enquir|inquir|connect|team|office|location)/i;

/** Up to `max` pages of the same site that usually carry contact details. */
export function contactPageLinks(hrefs: string[], pageUrl: string, max = 4): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin || !/^https?:$/.test(url.protocol)) continue;
    if (!CONTACT_PAGE.test(url.pathname) || /\.(pdf|jpe?g|png|zip|docx?)$/i.test(url.pathname)) continue;
    url.hash = "";
    if (url.href === base.href.split("#")[0]) continue;
    out.add(url.href);
    if (out.size >= max) break;
  }
  return [...out];
}

/** Text and link targets of an HTML document read in the background (no DOM there). */
export function htmlToParts(html: string): { text: string; hrefs: string[]; title: string | null } {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"'<>]+)["']/gi)].map((m) => m[1]!.replace(/&amp;/g, "&"));
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || null;
  const text = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#64;|&commat;/g, "@")
    .replace(/&#46;|&period;/g, ".")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { text, hrefs, title };
}

/** "www.Shop.co.in" → "shop.co.in" */
export function siteKey(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}
