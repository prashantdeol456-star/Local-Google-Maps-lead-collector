// Facebook search results (facebook.com/search/pages|groups|people/?q=…) in the user's own
// logged-in tab: reads what each result shows (name, link, the "·"-separated details line).
// Groups are saved as groups (name, privacy, members); their member lists are never read.
// Facebook's class names are generated, so results are found by links and visible text.

import { normalizeFacebookUrl, parseCount } from "@platform/shared";
import { textChunks } from "./text";

export type FacebookKind = "page" | "group" | "profile";

export interface FacebookLead {
  platform: "facebook";
  kind: FacebookKind;
  url: string;
  handle: string | null;
  name: string;
  bio: string | null;
  category: string | null;
  followers: number | null;
  audienceText: string | null;
  privacy: string | null;
  location: string | null;
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const lines = (el: Element) => textChunks(el);

/** Which search the open page is: /search/pages, /search/groups, /search/people. */
export function searchKind(url: string): FacebookKind | null {
  try {
    const path = new URL(url).pathname;
    if (/^\/search\/pages/.test(path)) return "page";
    if (/^\/search\/groups/.test(path)) return "group";
    if (/^\/search\/people/.test(path)) return "profile";
  } catch {
    /* not a URL */
  }
  return null;
}

export function searchUrl(kind: FacebookKind, keyword: string): string {
  const path = kind === "page" ? "pages" : kind === "group" ? "groups" : "people";
  return `https://www.facebook.com/search/${path}/?q=${encodeURIComponent(keyword)}`;
}

/** Is this link the result's own entity link for the kind searched? */
function entityUrl(href: string, kind: FacebookKind): string | null {
  const url = normalizeFacebookUrl(href);
  if (!url) return null;
  const isGroup = url.includes("/groups/");
  if (kind === "group") return isGroup ? url : null;
  return isGroup ? null : url;
}

/** One result block per entity: the smallest element around its link that also holds its details. */
function resultBlocks(doc: Document): HTMLElement[] {
  const root = doc.querySelector<HTMLElement>("[role='main']") ?? doc.body;
  const feed = root.querySelector<HTMLElement>("[role='feed']");
  if (feed) return [...feed.children].filter((c): c is HTMLElement => c.nodeType === 1);
  // Without a feed role: articles, else list items.
  const articles = [...root.querySelectorAll<HTMLElement>("[role='article']")];
  if (articles.length) return articles;
  return [...root.querySelectorAll<HTMLElement>("[role='listitem']")];
}

/** Reads every result on the open search page. */
export function readSearchResults(doc: Document, pageUrl: string): FacebookLead[] {
  const kind = searchKind(pageUrl);
  if (!kind) return [];
  const out = new Map<string, FacebookLead>();
  for (const block of resultBlocks(doc)) {
    const link = [...block.querySelectorAll<HTMLAnchorElement>("a[href]")].find((a) => norm(a.textContent) && entityUrl(a.href || a.getAttribute("href") || "", kind));
    if (!link) continue;
    const url = entityUrl(link.href || link.getAttribute("href") || "", kind)!;
    const name = norm(link.textContent);
    const ls = lines(block).filter((l) => l !== name && !/^(like|follow|join|add friend|message|visit|joined|following|liked)$/i.test(l));
    // The details line: "Page · Bakery · 1.2K followers" / "Public · 45K members · 10 posts a day" / "Lives in Lucknow"
    const details = ls.find((l) => l.includes("·")) ?? ls[0] ?? "";
    const parts = details.split("·").map(norm).filter(Boolean);
    const audience = parts.find((p) => /followers?|members?|likes?|people like this/i.test(p)) ?? ls.find((l) => /followers?|members?/i.test(l)) ?? null;
    const privacy = kind === "group" ? (parts.find((p) => /^(public|private|visible|hidden)/i.test(p)) ?? null) : null;
    const category = kind === "page" ? (parts.find((p) => !/^page$/i.test(p) && p !== audience && !/^\d/.test(p)) ?? null) : null;
    const location = kind === "profile" ? (ls.find((l) => /^(lives in|from|works at)/i.test(l)) ?? null) : null;
    const bio = ls.filter((l) => l !== details).slice(0, 2).join("\n") || null;
    const handle = /facebook\.com\/(?!groups\/|profile\.php)([^/?]+)/.exec(url)?.[1] ?? null;
    if (!out.has(url)) {
      out.set(url, {
        platform: "facebook",
        kind,
        url,
        handle,
        name,
        bio,
        category,
        followers: parseCount(audience),
        audienceText: audience,
        privacy: privacy ? privacy.split(" ")[0]!.toLowerCase() : null,
        location: location?.replace(/^(lives in|from)\s+/i, "") ?? null,
      });
    }
  }
  return [...out.values()];
}
