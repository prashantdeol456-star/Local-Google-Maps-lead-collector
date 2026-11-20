// Finds a business's public email on its own website: the home page, then up to two
// "contact" / "about" pages it links to. Only what the site itself publishes.
//
// Safety: the server only fetches public http(s) sites (never localhost or private networks,
// checked after DNS), follows at most 3 redirects, reads at most 400 KB per page and gives up
// after 8 seconds per page.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type FetchText = (url: string) => Promise<{ url: string; html: string } | null>;

const MAX_BYTES = 400_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

/** The URL is http(s) on a public host (resolved through DNS). */
export async function isPublicWebUrl(
  raw: string,
  resolve: (host: string) => Promise<{ address: string }[]> = (h) => lookup(h, { all: true }),
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && !["80", "443"].includes(url.port)) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  try {
    const addrs = isIP(host) ? [{ address: host }] : await resolve(host);
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** Fetches a public page as text (redirects checked one by one). */
export const fetchPublicPage: FetchText = async (start) => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isPublicWebUrl(url))) return null;
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadPlatform/1.0; contact-page check)", Accept: "text/html" },
    }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return null;
      url = new URL(next, url).href;
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "text/html").includes("html")) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size >= MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return { url, html: new TextDecoder().decode(Buffer.concat(chunks)) };
  }
  return null;
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
/** Addresses that are never a business's contact address. */
const JUNK = /(example\.|sentry|wixpress|domain\.com|email\.com|yourdomain|@2x\.|\.(png|jpe?g|gif|webp|svg|css|js)$|godaddy|cloudflare|schema\.org|w3\.org)/i;

/** Emails on a page: mailto links first, then addresses in the text. Lower-case, junk removed. */
export function emailsIn(html: string): string[] {
  const decoded = html
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/\s*(?:\[at\]|\(at\))\s*/gi, "@")
    .replace(/%40/g, "@");
  const fromMailto = [...decoded.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => decodeURIComponent(m[1]!));
  const fromText = decoded.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").match(EMAIL_RE) ?? [];
  const out: string[] = [];
  for (const e of [...fromMailto, ...fromText]) {
    const email = e.trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(email) || JUNK.test(email)) continue;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

/** Links on the page that look like a contact or about page on the same site. */
export function contactLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const host = new URL(base).hostname.replace(/^www\./, "");
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!;
    const label = m[2]!.replace(/<[^>]+>/g, " ");
    if (!/contact|about|reach|enquir|get-in-touch/i.test(`${href} ${label}`)) continue;
    try {
      const url = new URL(href, base);
      if (url.hostname.replace(/^www\./, "") !== host || !/^https?:$/.test(url.protocol)) continue;
      url.hash = "";
      if (!out.includes(url.href) && url.href !== base) out.push(url.href);
    } catch {
      /* skip */
    }
    if (out.length >= 2) break;
  }
  return out;
}

/** Best email for a website: one on the site's own domain first, else the first one found. */
export async function findWebsiteEmail(website: string, fetchText: FetchText = fetchPublicPage): Promise<string | null> {
  let home: { url: string; html: string } | null;
  try {
    home = await fetchText(website);
  } catch {
    return null;
  }
  if (!home) return null;
  const found = emailsIn(home.html);
  for (const link of contactLinks(home.html, home.url)) {
    if (found.length > 0 && found.some((e) => e.endsWith(new URL(home.url).hostname.replace(/^www\./, "")))) break;
    const page = await fetchText(link).catch(() => null);
    if (page) for (const e of emailsIn(page.html)) if (!found.includes(e)) found.push(e);
  }
  const domain = new URL(home.url).hostname.replace(/^www\./, "");
  return found.find((e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`)) ?? found[0] ?? null;
}
