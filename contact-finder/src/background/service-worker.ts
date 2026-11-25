// Contact Finder background: keeps what each tab showed, saves it (when "Save by itself" is on),
// reads a site's Contact/About pages when the page itself shows no email, shows the count on the
// toolbar icon, and sends chosen contacts to the Lead Platform (Contacts → upload).
//
// Sites other than LinkedIn are read only after you allow it (all sites, or one site from the
// panel). Nothing is sent anywhere until you press "Send to Lead Platform".

import { contactsToPlatformCsv, hasSomething, type Sighting } from "../core/contacts";
import { findContacts, htmlToParts, siteKey } from "../core/find";
import type { PageReading } from "../content/index";
import type { PanelRequest, Response, SendResult, TabInfo } from "../messages";
import { loadAuthState } from "../storage/auth";
import { deleteContacts, loadContacts, loadSettings, markSent, saveSettings, saveSighting } from "../storage/contacts";
import { apiRequest } from "./apiClient";
import { checkBackend, login, logout } from "./backendSession";

const PAGE_FETCH_TIMEOUT_MS = 8_000;
const MAX_PAGE_BYTES = 1_500_000;
const CRAWL_GAP_MS = 24 * 60 * 60 * 1000;

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ---- What each tab showed (kept for the session only) ----

const tabKey = (tabId: number) => `tab:${tabId}`;

async function rememberTab(tabId: number, reading: PageReading, url: string) {
  await chrome.storage.session.set({ [tabKey(tabId)]: { reading, url } });
}

async function tabReading(tabId: number): Promise<{ reading: PageReading; url: string } | null> {
  return ((await chrome.storage.session.get(tabKey(tabId)))[tabKey(tabId)] as { reading: PageReading; url: string } | undefined) ?? null;
}

chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(tabKey(tabId)));

function badge(tabId: number, reading: PageReading | null) {
  const s = reading?.sighting;
  const n = s ? s.findings.emails.length + s.findings.phones.length : 0;
  void chrome.action.setBadgeBackgroundColor({ tabId, color: "#0f6e56" }).catch(() => {});
  void chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" }).catch(() => {});
  void chrome.action.setTitle({ tabId, title: n ? `Contact Finder: ${s!.findings.emails.length} email(s), ${s!.findings.phones.length} phone(s) on this page` : "Open Contact Finder" }).catch(() => {});
}

function skipped(url: string, skipSites: string[]) {
  const key = siteKey(url);
  return !!key && skipSites.some((s) => key === s || key.endsWith(`.${s}`));
}

async function canRead(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return await chrome.permissions.contains({ origins: [`${u.origin}/*`] });
  } catch {
    return false;
  }
}

/** A page the content script read: remember it for the panel, save it, look further if needed. */
async function onFound(tabId: number, reading: PageReading, pageUrl: string) {
  const settings = await loadSettings();
  if (skipped(pageUrl, settings.skipSites)) {
    badge(tabId, null);
    return;
  }
  await rememberTab(tabId, reading, pageUrl);
  badge(tabId, reading);
  const s = reading.sighting;
  if (!s) return;
  if (settings.autoSave && hasSomething(s)) await saveSighting(s);
  if (settings.contactPages && s.kind === "website" && !s.findings.emails.length && reading.contactLinks.length) {
    await crawlContactPages(tabId, reading, { save: settings.autoSave, force: false });
  }
}

// ---- A site's Contact / About pages ----

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "omit", redirect: "follow", signal: controller.signal, headers: { Accept: "text/html" } });
    if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) return null;
    // Same site only, even after redirects.
    if (new URL(res.url).origin !== new URL(url).origin) return null;
    const text = await res.text();
    return text.length > MAX_PAGE_BYTES ? text.slice(0, MAX_PAGE_BYTES) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads up to 4 same-site pages (once a day per site, unless asked from the panel). */
async function crawlContactPages(tabId: number, reading: PageReading, opts: { save: boolean; force: boolean }): Promise<number> {
  const s = reading.sighting;
  if (!s || s.kind !== "website") return 0;
  const key = `crawled:${s.id}`;
  const last = (await chrome.storage.local.get(key))[key] as number | undefined;
  if (!opts.force && last && Date.now() - last < CRAWL_GAP_MS) return 0;
  const links = reading.contactLinks.filter((u) => u.startsWith(new URL(s.url).origin));
  if (!links.length || !(await canRead(links[0]!))) return 0;
  await chrome.storage.local.set({ [key]: Date.now() });

  let found = 0;
  const merged: Sighting = { ...s, findings: { ...s.findings, emails: [...s.findings.emails], phones: [...s.findings.phones] } };
  for (const link of links) {
    const html = await fetchPage(link);
    if (!html) continue;
    const parts = htmlToParts(html);
    const f = findContacts(parts);
    if (!f.emails.length && !f.phones.length) continue;
    const page: Sighting = { ...s, url: link, findings: f, how: "contact_page" };
    if (opts.save) await saveSighting(page);
    for (const e of f.emails) if (!merged.findings.emails.some((x) => x.value === e.value)) merged.findings.emails.push(e), found++;
    for (const p of f.phones) if (!merged.findings.phones.some((x) => x.value === p.value)) merged.findings.phones.push(p), found++;
  }
  const next: PageReading = { ...reading, sighting: merged, contactLinks: [] };
  await rememberTab(tabId, next, s.url);
  badge(tabId, next);
  return found;
}

// ---- Reading other websites (after you allowed it) ----

/** Built content script files (the manifest's LinkedIn entry), injected into other sites. */
const contentFiles = () => chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];

async function inject(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: contentFiles() });
    return true;
  } catch {
    return false;
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url || /^https:\/\/www\.linkedin\.com\//.test(tab.url)) return;
  void (async () => {
    const settings = await loadSettings();
    if (!settings.allSites || skipped(tab.url!, settings.skipSites) || !(await canRead(tab.url!))) return;
    await inject(tabId);
  })();
});

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

async function readTab(): Promise<TabInfo> {
  const tab = await activeTab();
  if (!tab?.id) return { tabId: null, url: null, readable: false, needsAccess: null, reading: null, saved: null };
  const tabId = tab.id;
  let reading: PageReading | null = null;
  const ask = async () => {
    const res = (await chrome.tabs.sendMessage(tabId, { type: "CF_READ" })) as Response<PageReading> | undefined;
    return res?.ok ? res.data : null;
  };
  try {
    reading = await ask();
  } catch {
    // No content script yet: add it (works with site access or right after the toolbar click).
    if (await inject(tabId)) reading = await ask().catch(() => null);
  }
  const url = tab.url ?? (await tabReading(tabId))?.url ?? null;
  if (reading) {
    const remembered = await tabReading(tabId);
    // Keep what the Contact/About pages added for this page.
    if (remembered?.reading.sighting && reading.sighting && remembered.reading.sighting.id === reading.sighting.id) {
      const r = remembered.reading.sighting.findings;
      for (const e of r.emails) if (!reading.sighting.findings.emails.some((x) => x.value === e.value)) reading.sighting.findings.emails.push(e);
      for (const p of r.phones) if (!reading.sighting.findings.phones.some((x) => x.value === p.value)) reading.sighting.findings.phones.push(p);
    }
    await rememberTab(tabId, reading, url ?? "");
    badge(tabId, reading);
  }
  const saved = reading?.sighting ? ((await loadContacts())[reading.sighting.id] ?? null) : null;
  let needsAccess: string | null = null;
  if (!reading && url && /^https?:/.test(url)) {
    try {
      needsAccess = `${new URL(url).origin}/*`;
    } catch {
      /* not a web page */
    }
  }
  return { tabId, url, readable: !!reading, needsAccess, reading, saved };
}

// ---- Lead Platform ----

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function sendToPlatform(ids: string[], listName: string | null): Promise<SendResult> {
  const auth = await loadAuthState();
  if (!auth.token) throw new Error("Log in to your Lead Platform first (Settings)");
  const all = await loadContacts();
  const chosen = ids.map((id) => all[id]).filter((c): c is NonNullable<typeof c> => !!c);
  const { csv, rows } = contactsToPlatformCsv(chosen);
  if (!rows) throw new Error("None of these has an email, a phone or a LinkedIn profile to send");
  const res = await apiRequest<{ created: number; updated: number }>({ baseUrl: auth.backendUrl, token: auth.token, timeoutMs: 30_000 }, "/api/contacts/import", {
    method: "POST",
    body: { fileName: "contact-finder.csv", data: base64Utf8(csv), listName: listName?.trim() || "Contact Finder" },
  });
  if (!res.ok) throw new Error(res.error.message);
  await markSent(chosen.map((c) => c.id));
  return { sent: rows, created: res.data.created, updated: res.data.updated };
}

// ---- Messages ----

async function handle(req: PanelRequest): Promise<unknown> {
  switch (req.type) {
    case "CF_STATUS":
      return checkBackend();
    case "CF_LOGIN":
      return login(req.backendUrl, req.email, req.password);
    case "CF_LOGOUT":
      return logout();
    case "CF_TAB":
      return readTab();
    case "CF_SAVE":
      return saveSighting(req.sighting);
    case "CF_CRAWL": {
      const tab = await activeTab();
      const remembered = tab?.id ? await tabReading(tab.id) : null;
      if (!tab?.id || !remembered) throw new Error("Open a website first");
      const settings = await loadSettings();
      return crawlContactPages(tab.id, remembered.reading, { save: settings.autoSave, force: true });
    }
    case "CF_LIST":
      return Object.values(await loadContacts()).sort((a, b) => b.lastSeen - a.lastSeen);
    case "CF_DELETE":
      return deleteContacts(req.ids);
    case "CF_SETTINGS":
      return loadSettings();
    case "CF_SET_SETTINGS":
      return saveSettings(req.patch);
    case "CF_SEND":
      return sendToPlatform(req.ids, req.listName);
  }
}

chrome.runtime.onMessage.addListener((message: (PanelRequest & { reading?: PageReading; pageUrl?: string }) | { type: "CF_FOUND"; reading: PageReading; pageUrl: string }, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message.type === "CF_FOUND") {
    if (sender.tab?.id !== undefined) void onFound(sender.tab.id, (message as { reading: PageReading }).reading, (message as { pageUrl: string }).pageUrl);
    return false;
  }
  // Only the side panel (an extension page, not a web page) may ask for these.
  if (sender.tab) return false;
  handle(message as PanelRequest).then(
    (data) => sendResponse({ ok: true, data }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
