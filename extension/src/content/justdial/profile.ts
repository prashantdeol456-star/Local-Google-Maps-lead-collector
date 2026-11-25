// Reads a Justdial business profile page (…_BZDET) and, only when the user turned it on, presses
// "Show Number". Layout verified on justdial.com on 2026-11-20 (labels are in the page text:
// "Address", "Year of Establishment", "Open until 7:00 pm", a "Visit our Website" link).

export interface JdProfile {
  name: string | null;
  address: string | null;
  website: string | null;
  established: string | null;
  hours: string | null;
  photos: string[];
  phone: string | null;
  /** Email shown on the page (most profiles show none: only an enquiry form, which is never used) */
  email: string | null;
}

export type JdBlock = "captcha" | "access_denied" | "login";

const NOT_WEBSITES = /(^|\.)(justdial\.com|jdmagicbox\.com|google\.[a-z.]+|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|apple\.com|whatsapp\.com|wa\.me)$/i;
const PHONE = /(?:\+91[\s-]?)?0?\d[\d\s-]{8,13}\d/;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
/** Addresses that belong to Justdial or are not real mailboxes. */
const NOT_EMAILS = /(@|\.)(justdial\.com|jdmagicbox\.com|jdsoftware\.com|example\.(com|in)|sentry\.io|wixpress\.com)$|\.(png|jpe?g|gif|webp|svg)$/i;

/** The business's email, when the page shows one (an email link, or an address in the text). */
export function emailOf(doc: Document): string | null {
  const candidates: string[] = [];
  for (const a of doc.querySelectorAll<HTMLAnchorElement>("a[href^='mailto:' i]")) {
    const raw = a.getAttribute("href")!.replace(/^mailto:/i, "").split("?")[0]!;
    try {
      candidates.push(decodeURIComponent(raw));
    } catch {
      candidates.push(raw);
    }
  }
  const text = (doc.body as HTMLElement | null)?.innerText ?? doc.body?.textContent ?? "";
  candidates.push(...(text.match(EMAIL) ?? []));
  for (const c of candidates) {
    const email = c.trim().toLowerCase();
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) && !NOT_EMAILS.test(email)) return email;
  }
  return null;
}

function lines(doc: Document): string[] {
  const text = (doc.body as HTMLElement | null)?.innerText ?? doc.body?.textContent ?? "";
  return text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** The line after a label ("Address" → "19 NWA, Club Road, …"). */
function after(ls: string[], label: string, accept: (l: string) => boolean = () => true): string | null {
  for (let i = 0; i < ls.length - 1; i++) {
    if (ls[i]!.toLowerCase() !== label.toLowerCase()) continue;
    for (const next of ls.slice(i + 1, i + 4)) if (accept(next)) return next;
  }
  return null;
}

export function digitsOf(text: string | null | undefined): string | null {
  const m = text?.match(PHONE);
  if (!m) return null;
  const d = m[0].replace(/[^\d+]/g, "");
  const n = d.replace(/\D/g, "").length;
  return n >= 10 && n <= 13 ? d : null;
}

/** A security check on screen. Justdial pages always carry a hidden reCAPTCHA frame (for its forms): only a visible one counts. */
export function detectBlock(doc: Document): JdBlock | null {
  const text = (doc.body?.textContent ?? "").slice(0, 4000).toLowerCase();
  const shown = (el: Element) => (el as HTMLElement).offsetWidth > 0 && (el as HTMLElement).offsetHeight > 0;
  if ([...doc.querySelectorAll('iframe[src*="captcha" i], iframe[title*="captcha" i], #px-captcha')].some(shown)) return "captcha";
  if (/access denied|you don't have permission to access|request blocked|unusual traffic/.test(text)) return "access_denied";
  return null;
}

export function readProfile(doc: Document): JdProfile {
  const ls = lines(doc);
  const address = after(ls, "Address", (l) => l.length > 8 && !/^(get directions|copy)$/i.test(l));
  const established = after(ls, "Year of Establishment", (l) => /^\d{4}$/.test(l));
  const hours = ls.find((l) => /^(open|closed|opens|closes)\b/i.test(l) && l.length <= 60) ?? null;

  let website: string | null = null;
  for (const a of doc.querySelectorAll<HTMLAnchorElement>("a[href^='http']")) {
    let url: URL;
    try {
      url = new URL(a.href);
    } catch {
      continue;
    }
    if (NOT_WEBSITES.test(url.hostname)) continue;
    const label = (a.textContent ?? "").trim();
    if (/website/i.test(label) || /website/i.test(a.closest("li, div")?.textContent?.slice(0, 80) ?? "")) {
      website = url.href;
      break;
    }
  }

  const photos: string[] = [];
  for (const img of doc.querySelectorAll<HTMLImageElement>("img")) {
    const src = img.currentSrc || img.src || img.getAttribute("data-src") || "";
    if (!/^https:\/\/[a-z0-9.-]*jdmagicbox\.com\//i.test(src)) continue;
    if (/\/(icon|icons|images\/icontent|mobile-t)\//i.test(src) || /\.svg(\?|$)/i.test(src)) continue;
    if (!photos.includes(src)) photos.push(src);
    if (photos.length >= 30) break;
  }

  // Only the business's own number box: the page's other tel: links belong to "People also
  // viewed" businesses and must never be taken.
  const shown = digitsOf(doc.getElementById("header_shownumber")?.textContent);

  return {
    name: doc.querySelector("h1")?.textContent?.trim() || null,
    address,
    website,
    established,
    hours,
    photos,
    phone: shown,
    email: emailOf(doc),
  };
}


const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Presses "Show Number" once and waits for the number. Justdial may ask you to log in first:
 * then nothing is typed, and "login" comes back so the job stops pressing it.
 */
export async function revealNumber(doc: Document, waitMs = 6000): Promise<{ phone: string | null; block: JdBlock | null }> {
  const button =
    doc.getElementById("header_shownumber") ??
    [...doc.querySelectorAll<HTMLElement>("button, [role='button'], li, div")].find((e) => e.childElementCount <= 2 && /^\s*show number\s*$/i.test(e.textContent ?? ""));
  if (!button) return { phone: null, block: null };
  (button as HTMLElement).click();
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    await sleep(300);
    const phone = digitsOf(doc.getElementById("header_shownumber")?.textContent) ?? readProfile(doc).phone;
    if (phone) return { phone, block: null };
    const dialog = doc.querySelector("[role='dialog'], .modal, [class*='login' i]");
    if (dialog && /otp|login|enter (your )?mobile/i.test(dialog.textContent ?? "")) return { phone: null, block: "login" };
  }
  return { phone: null, block: null };
}
