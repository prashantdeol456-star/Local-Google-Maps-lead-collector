// Sanitized page summary for the optional AI assist. Only what is needed to find the way
// back to the results list: page kind, a short list of clickable elements (by index; the AI
// never sees selectors), and the main panel's text with emails and long numbers masked.
// No cookies, form values, account details or page chrome are included.

import { AI_LIMITS, type PageCandidate, type PageSnapshot } from "@platform/shared";
import { MAPS_HOSTS, parseMapsPage } from "../../utils/maps";
import { cleanText } from "./parser";
import { SELECTORS } from "./selectors";

/**
 * Elements the AI may never pick, whatever the page says: sign-in, consent, sharing,
 * calling, reviews, settings, filters (they would change the search), leaving Maps…
 */
const DENIED_LABEL =
  /\b(sign ?in|sign ?up|log ?in|log ?out|account|consent|accept|agree|reject|cookies?|captcha|privacy|terms|legal|feedback|report|share|save|saved|directions?|route|call|phone|website|send to|reviews?|ratings?|suggest an edit|claim|own this|menu|apps|filters?|hours|price|update results|settings|download|install|print|copy|delete|edit|language|add a missing place|your places|timeline|contribute|photos?|street view|layers|zoom|traffic|book|order|reserve|buy)\b/i;
/** Map scale ("2 km") and bare numbers carry no meaning for navigation. */
const NOISE_LABEL = /^(\d+([.,]\d+)?\s?(km|m|mi|ft)|\d+)$/i;

const CLICKABLE = 'button, [role="button"], [role="tab"], a[href]';

export interface BuiltSnapshot {
  snapshot: PageSnapshot;
  /** elements[i] is candidate i (kept in the page; only the index leaves it). */
  elements: Element[];
}

const defaultVisible = (el: Element) => el.getClientRects().length > 0;

function roleOf(el: Element): PageCandidate["role"] | null {
  const role = el.getAttribute("role");
  if (role === "tab") return "tab";
  if (el.tagName === "A") return role && role !== "link" ? null : "link";
  if (role && role !== "button") return null; // checkbox, switch, menuitem…
  return "button";
}

/** Same-site Maps link that is not a place (opening places does not bring the list back). */
function allowedLink(el: Element, base: string): boolean {
  try {
    const url = new URL(el.getAttribute("href") ?? "", base);
    return (MAPS_HOSTS as readonly string[]).includes(url.hostname) && url.pathname.startsWith("/maps") && !url.pathname.startsWith("/maps/place/");
  } catch {
    return false;
  }
}

/** Masks emails and long digit runs (phone numbers) before page text leaves the browser. */
export function maskText(text: string): string {
  return text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]").replace(/\+?\d[\d\s()-]{6,}\d/g, "[number]");
}

export function buildSnapshot(doc: Document, href: string, isVisible: (el: Element) => boolean = defaultVisible): BuiltSnapshot {
  const page = parseMapsPage(href);
  const candidates: PageCandidate[] = [];
  const elements: Element[] = [];
  const seen = new Set<string>();

  for (const el of doc.querySelectorAll(CLICKABLE)) {
    if (candidates.length >= AI_LIMITS.maxCandidates) break;
    if (el.closest(SELECTORS.aiExcludedRegions)) continue;
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.closest('[aria-hidden="true"]')) continue;
    const role = roleOf(el);
    if (!role || (role === "link" && !allowedLink(el, href))) continue;
    const label = cleanText(el.getAttribute("aria-label") || el.textContent)?.slice(0, AI_LIMITS.maxLabelLength);
    if (!label || label.length < 2 || DENIED_LABEL.test(label) || NOISE_LABEL.test(label)) continue;
    if (seen.has(`${role}:${label}`) || !isVisible(el)) continue;
    seen.add(`${role}:${label}`);
    candidates.push({ i: elements.length, role, label: maskText(label) });
    elements.push(el);
  }

  const main = doc.querySelector('[role="main"]') ?? doc.body;
  const text = maskText(cleanText((main as HTMLElement | null)?.innerText ?? main?.textContent) ?? "").slice(0, AI_LIMITS.maxTextLength);
  const feed = doc.querySelector(SELECTORS.resultsFeed);

  return {
    snapshot: {
      pageKind: page.isSearch ? "search" : page.isPlace ? "place" : page.isMaps ? "maps" : "other",
      urlQuery: page.query,
      title: (cleanText(doc.title) ?? "").slice(0, AI_LIMITS.maxTitleLength),
      hasResultsList: !!feed,
      placeLinks: doc.querySelectorAll(SELECTORS.resultLink).length,
      hasSearchBox: !!doc.querySelector(SELECTORS.searchBox),
      candidates,
      text,
    },
    elements,
  };
}
