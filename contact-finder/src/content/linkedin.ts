// Reads what is already on screen: the profile the user opened and, if the user opened it, the
// "Contact info" dialog. Nothing here clicks, scrolls, types or navigates.
//
// LinkedIn changes its class names often, so this reads by visible text labels ("Email",
// "Website", "Birthday", "Connected") and by link targets (mailto:, tel:, /in/…) instead.

import { normalizeLinkedInProfileUrl, type LinkedInEducation, type LinkedInExperience, type LinkedInLeadInput, type LinkedInWebsite } from "@platform/shared";

export interface ProfileReading {
  /** Canonical profile URL, or null when the tab is not a member profile */
  profileUrl: string | null;
  lead: Omit<LinkedInLeadInput, "profileUrl" | "tag" | "notes">;
  /** True when the Contact info dialog was open and was read */
  contactInfoOpen: boolean;
}

export interface ProfileLink {
  profileUrl: string;
  name: string | null;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LABEL_IN_PARENS = /^\(([^()]{1,60})\)$/;
const NOISE = /^(contact info|edit contact info|dismiss|close|edit|show all|see all|copy|copied|\d+ notifications?)$/i;

type Section = "profile" | "website" | "phone" | "address" | "email" | "im" | "birthday" | "connected";

function sectionOf(line: string): Section | null {
  const l = line.toLowerCase();
  if (/^(your profile|.+['’]s profile|profile)$/.test(l)) return "profile";
  if (/^websites?$/.test(l)) return "website";
  if (/^phones?$/.test(l)) return "phone";
  if (/^address$/.test(l)) return "address";
  if (/^emails?( address)?$/.test(l)) return "email";
  if (/^(im|ims|instant messag(e|ing|es))$/.test(l)) return "im";
  if (/^birthday$/.test(l)) return "birthday";
  if (/^connected( since)?$/.test(l)) return "connected";
  return null;
}

/** Visible text lines of an element, skipping duplicates LinkedIn adds for screen readers. */
export function textLines(root: Element): string[] {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = clean(node.textContent);
      if (t && out[out.length - 1] !== t) out.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "svg" || tag === "button") return;
    // Visible copy + hidden copy pattern: keep the hidden (complete) copy, skip aria-hidden.
    if (el.getAttribute("aria-hidden") === "true") return;
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(root);
  return out;
}

/** The open Contact info dialog, if any. */
export function findContactInfoDialog(doc: Document): Element | null {
  const dialogs = Array.from(doc.querySelectorAll('[role="dialog"], dialog, .artdeco-modal'));
  return dialogs.find((d) => /contact info/i.test(d.textContent ?? "")) ?? null;
}

export interface ContactInfo {
  profileUrl: string | null;
  emails: string[];
  phones: string[];
  websites: LinkedInWebsite[];
  ims: string[];
  birthday: string | null;
  address: string | null;
  connectedSince: string | null;
}

export function parseContactInfo(dialog: Element): ContactInfo {
  const info: ContactInfo = { profileUrl: null, emails: [], phones: [], websites: [], ims: [], birthday: null, address: null, connectedSince: null };
  const push = <T>(list: T[], value: T, key: (x: T) => string) => {
    if (!list.some((x) => key(x) === key(value))) list.push(value);
  };

  let section: Section | null = null;
  const addressParts: string[] = [];
  for (const line of textLines(dialog)) {
    const next = sectionOf(line);
    if (next) {
      section = next;
      continue;
    }
    if (NOISE.test(line) || !section) continue;
    const label = LABEL_IN_PARENS.exec(line)?.[1] ?? null;

    switch (section) {
      case "profile":
        info.profileUrl ??= normalizeLinkedInProfileUrl(line);
        break;
      case "website": {
        const last = info.websites[info.websites.length - 1];
        if (label) {
          if (last && !last.label) last.label = label;
          break;
        }
        const m = /^(\S+)\s*\(([^()]+)\)$/.exec(line);
        push(info.websites, m ? { url: m[1]!, label: m[2]! } : { url: line, label: null }, (w) => w.url.toLowerCase());
        break;
      }
      case "phone":
        if (!label && /\d{3}/.test(line)) push(info.phones, line.replace(/\s*\([^()]*\)$/, ""), (p) => p.replace(/\D/g, ""));
        break;
      case "email":
        if (EMAIL.test(line)) push(info.emails, line.toLowerCase(), (e) => e);
        break;
      case "im": {
        if (label && info.ims.length) info.ims[info.ims.length - 1] += ` (${label})`;
        else push(info.ims, line, (s) => s.toLowerCase());
        break;
      }
      case "birthday":
        info.birthday ??= line;
        break;
      case "connected":
        info.connectedSince ??= line;
        break;
      case "address":
        addressParts.push(line);
        break;
    }
  }
  if (addressParts.length) info.address = addressParts.join(", ");

  // Links are more reliable than text where present.
  for (const a of Array.from(dialog.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (/^mailto:/i.test(href)) {
      const email = decodeURIComponent(href.slice(7).split("?")[0]!).trim().toLowerCase();
      if (EMAIL.test(email)) push(info.emails, email, (e) => e);
    } else if (/^tel:/i.test(href)) {
      push(info.phones, decodeURIComponent(href.slice(4)).trim(), (p) => p.replace(/\D/g, ""));
    } else if (!info.profileUrl) {
      info.profileUrl = normalizeLinkedInProfileUrl(href.startsWith("/") ? `https://www.linkedin.com${href}` : href);
    }
  }
  return info;
}

/** "HR Executive at Fixtra" → "Fixtra" */
function companyFromHeadline(headline: string | null): string | null {
  const m = headline ? /\s(?:at|@)\s+([^|·,]+)/i.exec(headline) : null;
  return m ? clean(m[1]) || null : null;
}

/**
 * The top card: the older layout has an h1 inside a <section>; the 2026 layout has no h1 and
 * obfuscated class names, so it is found as the nearest ancestor of the "Contact info" link that
 * also contains the name.
 */
function findTopCard(doc: Document, name: string): Element | null {
  const h1 = doc.querySelector("main h1") ?? doc.querySelector("h1");
  const section = h1?.closest("section");
  if (section) return section;
  let el: Element | null = doc.querySelector('a[href*="/overlay/contact-info"]');
  for (let i = 0; el && i < 12; i++, el = el.parentElement) {
    if (name && textLines(el).includes(name)) return el;
  }
  return null;
}

const COMPANY_LABEL = /^(Current company|View company):\s*/i;

/** Name, headline, location and current company from the profile's top card. */
export function parseTopCard(doc: Document): { name: string; headline: string | null; company: string | null; location: string | null } {
  const h1 = doc.querySelector("main h1") ?? doc.querySelector("h1");
  const name = clean(h1?.textContent) || clean(doc.title.replace(/\s*\|\s*LinkedIn\s*$/i, "").replace(/^\(\d+\)\s*/, ""));
  const card = findTopCard(doc, name);

  let headline: string | null = clean(card?.querySelector(".text-body-medium")?.textContent) || null;
  let location: string | null = clean(card?.querySelector(".text-body-small.inline, .text-body-small[class*='inline']")?.textContent) || null;
  if (card && (!headline || !location)) {
    const lines = textLines(card).filter((l) => !/^(he\/him|she\/her|they\/them)$/i.test(l) && !/^[·•]?\s*(1st|2nd|3rd\+?)?$/i.test(l));
    const after = lines.slice(lines.indexOf(name) + 1);
    headline ??= after.find((l) => !NOISE.test(l)) ?? null;
    // Location is shown just before the "Contact info" link.
    const contactAt = after.findIndex((l) => /^contact info$/i.test(l));
    const beforeContact = contactAt > 0 ? after[contactAt - 1] : undefined;
    location ??= (beforeContact && beforeContact !== headline ? beforeContact : null) ?? after.find((l) => /,/.test(l) && l.length < 100 && l !== headline) ?? null;
  }

  const COMPANY_SELECTOR = '[aria-label^="Current company"], [aria-label^="View company:"]';
  const companyEl = card?.querySelector(COMPANY_SELECTOR) ?? doc.querySelector(COMPANY_SELECTOR);
  const company =
    clean(companyEl?.getAttribute("aria-label")?.replace(COMPANY_LABEL, "").replace(/\.\s*Click to skip.*$/i, "")) || companyFromHeadline(headline);

  return { name, headline, company: company || null, location };
}

// ---- Experience and Education sections ----

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";
/** "Jul 2024 - Sep 2026 · 2 yrs 3 mos", "2019 - 2021", "Jan 2021 - Present", "2021" */
const DATE_LINE = new RegExp(String.raw`^(?:${MONTH}\s)?(?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:${MONTH}\s)?(?:19|20)\d{2}|Present))?(?:\s*·.*)?$`, "i");
/** Header of several positions at one company: "Full-time · 2 yrs 3 mos" or "3 yrs" */
const DURATION_LINE = /^(?:[A-Za-z -]+\s·\s)?\d+\s+(?:yrs?|mos?)\b/i;
const EMPLOYMENT_TYPE = /^(Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Apprenticeship|Seasonal|Trainee)$/i;
const SECTION_NOISE = /^(show all.*|see more|… ?more|present|.*\bskills?)$/i;

const isDate = (l: string) => DATE_LINE.test(l);
const isLocation = (l: string) => !isDate(l) && l.length < 120 && (/,/.test(l) || /\b(remote|hybrid|on-site)\b/i.test(l)) && !/\bskills?\b/i.test(l);

/** The block under a heading such as "Experience" (the page loads these sections lazily). */
export function findSection(doc: Document, label: string): Element | null {
  const root = doc.querySelector("main") ?? doc.body;
  const heading = Array.from(root.querySelectorAll("h2, h3, [role='heading']")).find((h) => clean(h.textContent).toLowerCase() === label.toLowerCase());
  if (!heading) return null;
  let el: Element = heading;
  for (let i = 0; i < 10 && el.parentElement; i++) {
    el = el.parentElement;
    if (textLines(el).length > 3) return el;
  }
  return null;
}

/** Item blocks of a section: the element whose children each hold an entry. */
function sectionItems(section: Element, label: string): string[][] {
  let best: Element[] = [];
  for (const el of Array.from(section.querySelectorAll("*"))) {
    const kids = Array.from(el.children).filter((c) => textLines(c).length >= 2);
    if (kids.length > best.length) best = kids;
  }
  const blocks = best.length ? best.map((b) => textLines(b)) : [textLines(section)];
  return blocks.map((lines) => lines.filter((l) => l.toLowerCase() !== label.toLowerCase() && !SECTION_NOISE.test(l)));
}

function splitDot(line: string | undefined): [string | null, string | null] {
  if (!line) return [null, null];
  const [first, ...rest] = line.split(/\s·\s/);
  return [clean(first) || null, clean(rest.join(" · ")) || null];
}

export function parseExperienceItem(lines: string[]): LinkedInExperience[] {
  if (!lines.length) return [];
  const dates = lines.map((l, i) => (isDate(l) ? i : -1)).filter((i) => i >= 0);
  const location = (d: number) => (lines[d + 1] && isLocation(lines[d + 1]!) ? lines[d + 1]! : null);

  // Several positions at one company: company, "Full-time · 3 yrs", then title + dates per position.
  if (lines[1] && DURATION_LINE.test(lines[1]) && !isDate(lines[1]) && dates.length) {
    const company = lines[0]!;
    const type = splitDot(lines[1])[0];
    return dates
      .map((d) => {
        let t = d - 1;
        let employmentType = EMPLOYMENT_TYPE.test(type ?? "") ? type : null;
        if (t > 1 && EMPLOYMENT_TYPE.test(lines[t]!)) employmentType = lines[t--]!;
        const title = t > 1 ? lines[t]! : "";
        return { title, company, employmentType, dates: lines[d]!, location: location(d) };
      })
      .filter((e) => e.title);
  }

  const d = dates[0] ?? -1;
  const [company, employmentType] = d === 1 ? [null, null] : splitDot(lines[1]);
  return [{ title: lines[0]!, company, employmentType, dates: d >= 0 ? lines[d]! : null, location: d >= 0 ? location(d) : null }];
}

export function parseEducationItem(lines: string[]): LinkedInEducation[] {
  if (!lines.length) return [];
  const d = lines.findIndex(isDate);
  return [{ school: lines[0]!, degree: lines[1] && !isDate(lines[1]) ? lines[1] : null, dates: d >= 0 ? lines[d]! : null }];
}

export function readExperience(doc: Document): LinkedInExperience[] {
  const section = findSection(doc, "Experience");
  return section ? sectionItems(section, "Experience").flatMap(parseExperienceItem) : [];
}

export function readEducation(doc: Document): LinkedInEducation[] {
  const section = findSection(doc, "Education");
  return section ? sectionItems(section, "Education").flatMap(parseEducationItem) : [];
}

export function readProfile(doc: Document, pageUrl: string): ProfileReading {
  const top = parseTopCard(doc);
  const dialog = findContactInfoDialog(doc);
  const contact = dialog ? parseContactInfo(dialog) : null;
  return {
    profileUrl: normalizeLinkedInProfileUrl(pageUrl) ?? contact?.profileUrl ?? null,
    contactInfoOpen: !!dialog,
    lead: {
      name: top.name,
      headline: top.headline,
      company: top.company,
      location: top.location,
      emails: contact?.emails ?? [],
      phones: contact?.phones ?? [],
      websites: contact?.websites ?? [],
      ims: contact?.ims ?? [],
      experience: readExperience(doc),
      education: readEducation(doc),
      birthday: contact?.birthday ?? null,
      address: contact?.address ?? null,
      connectedSince: contact?.connectedSince ?? null,
    },
  };
}

/** Member profile links visible on the current page (e.g. search results the user opened). */
export function readProfileLinks(doc: Document): ProfileLink[] {
  const root = doc.querySelector("main") ?? doc.body;
  const byUrl = new Map<string, ProfileLink>();
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'))) {
    const href = a.getAttribute("href") ?? "";
    const url = normalizeLinkedInProfileUrl(href.startsWith("/") ? `https://www.linkedin.com${href}` : href);
    if (!url) continue;
    // "Asha & Bala are mutual connections" under a result links other people: not results.
    if (/mutual connections?\b/i.test(a.parentElement?.textContent ?? "") && textLines(a).length <= 1) continue;
    const text = textLines(a).find((l) => !/^view .+['’]s profile$/i.test(l) && !/^(1st|2nd|3rd\+?|•|·)/i.test(l)) ?? null;
    const existing = byUrl.get(url);
    if (!existing) byUrl.set(url, { profileUrl: url, name: text });
    else if (!existing.name && text) existing.name = text;
  }
  return [...byUrl.values()];
}
