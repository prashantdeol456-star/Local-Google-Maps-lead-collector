// Contact Finder on the page you opened: reads the emails and phone numbers it shows and tells
// the extension. On LinkedIn it reads the profile (name, headline, company) and, when you open
// it, the "Contact info" dialog: only what LinkedIn shows you. It never clicks, types, scrolls
// or opens other pages.

import { normalizeLinkedInProfileUrl } from "@platform/shared";
import type { Sighting } from "../core/contacts";
import { contactPageLinks, findContacts, siteKey } from "../core/find";
import { findContactInfoDialog, parseContactInfo, parseTopCard } from "./linkedin";

export interface PageReading {
  sighting: Sighting | null;
  /** Same-site Contact/About pages, for the background to read when the page shows no email */
  contactLinks: string[];
  /** LinkedIn profile whose Contact info dialog is not open (the panel offers to open it) */
  contactInfoUrl: string | null;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim() || null;

function hrefs(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a) => a.getAttribute("href") ?? "").filter(Boolean).slice(0, 3000);
}

function readLinkedIn(url: URL): PageReading {
  const profileUrl = normalizeLinkedInProfileUrl(url.href);
  if (profileUrl) {
    const top = parseTopCard(document);
    const dialog = findContactInfoDialog(document);
    const info = dialog ? parseContactInfo(dialog) : null;
    const slug = /\/in\/([^/]+)/.exec(profileUrl)?.[1] ?? profileUrl;
    const company = info?.websites.find((w) => /company/i.test(w.label ?? ""))?.url ?? info?.websites[0]?.url ?? null;
    return {
      sighting: {
        id: `li:in/${slug.toLowerCase()}`,
        kind: "linkedin_profile",
        url: profileUrl,
        name: clean(top.name),
        title: top.headline,
        company: top.company,
        location: top.location,
        website: company,
        linkedinUrl: profileUrl,
        findings: {
          emails: (info?.emails ?? []).map((value) => ({ value, how: "link" as const })),
          phones: (info?.phones ?? []).map((value) => ({ value, how: "link" as const })),
          socials: [],
        },
        how: "contact_info",
      },
      contactLinks: [],
      contactInfoUrl: dialog ? null : `${profileUrl.replace(/\/+$/, "")}/overlay/contact-info/`,
    };
  }
  const company = /^\/(company|school)\/([^/]+)/.exec(url.pathname);
  if (company) {
    const main = document.querySelector("main") ?? document.body;
    const name = clean(main.querySelector("h1")?.textContent);
    // The company's own website link (About tab or the top card's "Visit website").
    const site = [...main.querySelectorAll<HTMLAnchorElement>("a[href^='http']")]
      .map((a) => a.href)
      .find((h) => !/linkedin\.com|lnkd\.in|bing\.com|microsoft\.com/i.test(h));
    const text = (main as HTMLElement).innerText ?? main.textContent ?? "";
    const findings = findContacts({ text, hrefs: hrefs(main) });
    const pageUrl = `https://www.linkedin.com/${company[1]}/${company[2]}/`;
    return {
      sighting: {
        id: `li:company/${company[2]!.toLowerCase()}`,
        kind: "linkedin_company",
        url: pageUrl,
        name,
        company: name,
        website: site ?? null,
        linkedinUrl: pageUrl,
        findings: { ...findings, socials: [] },
      },
      contactLinks: [],
      contactInfoUrl: null,
    };
  }
  return { sighting: null, contactLinks: [], contactInfoUrl: null };
}

function readWebsite(url: URL): PageReading {
  const key = siteKey(url.href);
  if (!key || !document.body) return { sighting: null, contactLinks: [], contactInfoUrl: null };
  const links = hrefs(document);
  const text = document.body.innerText ?? document.body.textContent ?? "";
  const findings = findContacts({ text, hrefs: links });
  const siteName = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;
  const name = clean(siteName) ?? clean(document.title.split(/\s[|–—-]\s/)[0]);
  return {
    sighting: { id: `site:${key}`, kind: "website", url: url.href.split("#")[0]!, name, company: name, website: url.origin, findings },
    contactLinks: findings.emails.length ? [] : contactPageLinks(links, url.href),
    contactInfoUrl: null,
  };
}

export function readPage(): PageReading {
  const url = new URL(location.href);
  if (/(^|\.)linkedin\.com$/i.test(url.hostname)) return readLinkedIn(url);
  return readWebsite(url);
}

// ---- Running on the page ----

const w = window as unknown as { __contactFinder?: boolean };
if (!w.__contactFinder && typeof chrome !== "undefined" && chrome.runtime?.id) {
  w.__contactFinder = true;
  let lastSent = "";

  const report = () => {
    let reading: PageReading;
    try {
      reading = readPage();
    } catch {
      return;
    }
    const s = reading.sighting;
    const signature = s ? `${s.id}|${s.name}|${s.findings.emails.length}|${s.findings.phones.length}|${reading.contactInfoUrl ? 0 : 1}` : `none|${location.href}`;
    if (signature === lastSent) return;
    lastSent = signature;
    void chrome.runtime.sendMessage({ type: "CF_FOUND", reading, pageUrl: location.href }).catch(() => {});
  };

  chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "CF_READ") return false;
    try {
      sendResponse({ ok: true, data: readPage() });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  });

  report();
  // Late content (single-page sites, LinkedIn): read again when the page changes, at most every 2 s.
  setTimeout(report, 3_000);
  // Ordinary websites: a few times only (some pages change all the time); LinkedIn keeps
  // changing pages without reloading, so it is followed for as long as the tab is open.
  const linkedIn = /(^|\.)linkedin\.com$/i.test(location.hostname);
  let rounds = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    timer ??= setTimeout(() => {
      timer = null;
      report();
      if (!linkedIn && ++rounds >= 5) observer.disconnect();
    }, 2_000);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
