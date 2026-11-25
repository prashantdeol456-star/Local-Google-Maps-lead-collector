// Runs a Justdial job from the background, in the job's own tab behind the user's:
//   1. list: opens the search and scrolls down, like a person, so Justdial keeps loading more
//      businesses (10 per scroll) until "Max records" are read or the list ends; then page-2…
//   2. per business: opens its profile (address, website, photos, timings), optionally presses
//      "Show Number" (daily limit), and looks it up on Google Maps in a second background tab
//   3. sends each lead to the backend (same outbox as Google Maps, so nothing is lost offline)
// Fixed pauses between pages; a security check, a block or a closed tab pauses the job and the
// user is notified. Nothing here solves CAPTCHAs, logs in or fills in forms.

import { isOn, JD_SHOW_NUMBER_DAILY_LIMIT, type CollectorFieldSelection } from "@platform/shared";
import { parseAddress } from "../content/maps/parser";
import { placeMapsUrl, type SearchPlace } from "../content/maps/searchData";
import type { JdListing } from "../content/justdial/listing";
import { justdialSearchUrl } from "../content/justdial/listing";
import type { JdBlock, JdProfile } from "../content/justdial/profile";
import type { ExtractedListing } from "../content/maps/types";
import type { JustdialPayload, OutboxPayload } from "../storage/outbox";
import { addProcessedKey, loadProcessedKeys, withLog, type CollectorState } from "../storage/state";
import { loadJdSpeed, paceOf } from "../utils/jdSpeed";
import { buildMapsSearchUrl } from "../utils/maps";
import type { MessageResponse } from "../utils/messages";
import { bestMapsMatch } from "./jdMatch";
import { applyListing } from "./jobController";

const PAGE_DELAY_MS = 3000;
/** One scroll request to the page (short, so the background stays awake between them). */
const SCROLL_CALL_MS = 25_000;
/** At most this many scroll requests on one list page (each brings ≈ 10–20 businesses). */
const MAX_SCROLL_CALLS = 300;
const MAX_LIST_PAGES = 50;
const TAB_LOAD_TIMEOUT_MS = 30_000;

export interface JustdialDeps {
  loadState(): Promise<CollectorState>;
  updateState(update: (s: CollectorState) => CollectorState | null | Promise<CollectorState | null>): Promise<CollectorState>;
  enqueue(payload: OutboxPayload): Promise<void>;
  statusUpdate(jobId: string | null, status: "running" | "paused" | "completed" | "stopped" | "failed", reason: string | null): Promise<void>;
  /** Called once the run ended (completed or paused): next queued keyword, notifications. */
  finished(state: CollectorState): Promise<void>;
}

interface StoredList {
  listings: JdListing[];
  nextUrl: string | null;
  pages: number;
  done: boolean;
  /** The list page being scrolled (opened again on resume) */
  url?: string | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const listKey = (runId: string) => `jd-list:${runId}`;
/** Remembers which run's list is stored, so an old one can be removed without reading all storage. */
const CURRENT_LIST_KEY = "jd-list-current";

/** Waits until the tab has finished loading (after a navigation). */
function waitForTab(tabId: number, timeoutMs = TAB_LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("The page did not load in time"));
    }, timeoutMs);
    const listener = (id: number, info: { status?: string }) => {
      if (id !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function open(tabId: number, url: string) {
  const loaded = waitForTab(tabId);
  await chrome.tabs.update(tabId, { url });
  await loaded;
}

/** Asks the content script on the tab; retries while it is still starting up. */
async function ask<T>(tabId: number, message: unknown, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, message)) as MessageResponse<T> | undefined;
      if (res?.ok) return res.data;
      throw new Error(res && !res.ok ? res.error : "No answer from the page");
    } catch (err) {
      if (i >= tries) throw err;
      await sleep(700);
    }
  }
}

async function loadList(runId: string): Promise<StoredList> {
  const got = (await chrome.storage.local.get(listKey(runId)))[listKey(runId)] as StoredList | undefined;
  return got ?? { listings: [], nextUrl: null, pages: 0, done: false };
}

async function saveList(runId: string, list: StoredList) {
  // Only the list of the current run is kept (without loading everything else in storage).
  const current = (await chrome.storage.local.get(CURRENT_LIST_KEY))[CURRENT_LIST_KEY] as string | undefined;
  if (current && current !== runId) await chrome.storage.local.remove(listKey(current));
  await chrome.storage.local.set({ [listKey(runId)]: list, [CURRENT_LIST_KEY]: runId });
}

/** The finished run's list is not needed any more. */
export async function dropList(runId: string) {
  await chrome.storage.local.remove([listKey(runId), CURRENT_LIST_KEY]);
}

/** Adds the businesses not seen yet; returns how many were new. */
export function addListings(list: StoredList, incoming: JdListing[], known: Set<string>): number {
  let added = 0;
  for (const l of incoming) {
    if (known.has(l.docid)) continue;
    known.add(l.docid);
    list.listings.push(l);
    added++;
  }
  return added;
}

/** "Show Number" presses left today. */
async function revealsLeft(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const r = (await chrome.storage.local.get("jd-reveals"))["jd-reveals"] as { date: string; count: number } | undefined;
  return JD_SHOW_NUMBER_DAILY_LIMIT - (r?.date === today ? r.count : 0);
}

async function countReveal() {
  const today = new Date().toISOString().slice(0, 10);
  const r = (await chrome.storage.local.get("jd-reveals"))["jd-reveals"] as { date: string; count: number } | undefined;
  await chrome.storage.local.set({ "jd-reveals": { date: today, count: (r?.date === today ? r.count : 0) + 1 } });
}

const BLOCK_TEXT: Record<JdBlock, string> = {
  captcha: "Justdial is showing a security check (CAPTCHA). Complete it yourself in the Justdial tab, then press RESUME",
  access_denied: "Justdial blocked the page (access denied). Wait a while, open Justdial yourself, then press RESUME",
  login: "Justdial asked to log in for “Show Number”",
};

/** Lead + Justdial details for one business, applying the user's field choices. */
export function composeLead(
  l: JdListing,
  profile: JdProfile | null,
  maps: SearchPlace | null,
  ctx: { keyword: string; location: string; fields: CollectorFieldSelection },
): { lead: ExtractedListing; justdial: JustdialPayload } {
  const pick = <T>(field: keyof CollectorFieldSelection, value: T): T | null => (ctx.fields[field] ? value : null);
  const address = profile?.address ?? maps?.address ?? l.address ?? l.area;
  const parts = parseAddress(maps?.address ?? address, ctx.location);
  const jdCity = l.city ? l.city.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  const pin = l.pincode ?? address?.match(/\b\d{6}\b/)?.[0] ?? null;
  // Google Maps has the business's own number; Justdial's (on the list card or the profile) is
  // often a call-forwarding number, so it comes next, then the WhatsApp number Justdial lists.
  const phone = maps?.phone ?? profile?.phone ?? l.phone ?? l.whatsapp;
  const website = profile?.website ?? maps?.website ?? null;
  const lead: ExtractedListing = {
    name: l.name,
    category: pick("category", l.categories?.split(",")[0]?.trim() || maps?.category || null),
    phone: pick("phone", phone),
    email: profile?.email ?? null,
    website: pick("website", website),
    address: pick("address", address),
    city: pick("city", parts.city ?? jdCity ?? (ctx.location.trim() || null)),
    state: pick("state", parts.state),
    country: pick("country", parts.country ?? (parts.state ? "India" : null)),
    postalCode: pick("address", parts.postalCode ?? pin),
    latitude: l.latitude ?? maps?.latitude ?? null,
    longitude: l.longitude ?? maps?.longitude ?? null,
    rating: pick("rating", l.rating ?? maps?.rating ?? null),
    reviewCount: pick("reviewCount", l.reviewCount ?? maps?.reviewCount ?? null),
    mapsUrl: pick("mapsUrl", maps ? placeMapsUrl(maps) : null),
    placeId: maps?.placeId ?? null,
    searchKeyword: ctx.keyword,
    source: "justdial",
    clientKey: `jd:${l.docid}`,
  };
  const justdial: JustdialPayload = {
    docid: l.docid,
    jdUrl: l.profileUrl,
    jdPhone: profile?.phone ?? l.phone ?? l.whatsapp,
    jdRating: l.rating,
    jdReviewCount: l.reviewCount,
    categories: l.categories,
    area: l.area,
    established: profile?.established ?? null,
    hours: profile?.hours ?? null,
    photos: profile?.photos ?? (l.thumbnail && /^https:/.test(l.thumbnail) ? [l.thumbnail] : []),
    mapsMatched: !!maps,
    mapsName: maps?.name ?? null,
    mapsPhone: maps?.phone ?? null,
    mapsWebsite: maps?.website ?? null,
    mapsRating: maps?.rating ?? null,
    mapsReviewCount: maps?.reviewCount ?? null,
    mapsUrl: maps ? placeMapsUrl(maps) : null,
  };
  return { lead, justdial };
}

export class JustdialRunner {
  private activeRun: string | null = null;
  private mapsTabId: number | null = null;

  constructor(private readonly deps: JustdialDeps) {}

  isActive(runId: string | null) {
    return !!runId && this.activeRun === runId;
  }

  /** Runs (or resumes) the current Justdial job. Safe to call twice: only one loop per run. */
  async run(): Promise<void> {
    const state = await this.deps.loadState();
    if (state.status !== "running" || state.jobSettings?.source !== "justdial" || !state.runId || state.tabId === null) return;
    if (this.activeRun === state.runId) return;
    const runId = state.runId;
    this.activeRun = runId;
    try {
      const outcome = await this.loop(state);
      if (outcome === "completed") {
        const done = await this.deps.updateState((s) =>
          s.runId === runId ? withLog(withLog({ ...s, status: "completed" }, "success", "Reached the end of the Justdial list"), "success", `Job completed: ${s.counters.found} businesses read`) : null,
        );
        await this.deps.statusUpdate(done.backendJobId, "completed", "end_of_list");
        await this.closeMapsTab();
        await dropList(runId);
        await this.deps.finished(done);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const paused = await this.pause(runId, `Justdial job stopped: ${message}. Check the Justdial tab, then press RESUME`, "justdial_error");
      if (paused) await this.deps.finished(paused);
    } finally {
      if (this.activeRun === runId) this.activeRun = null;
    }
  }

  private async pause(runId: string, text: string, reason: string): Promise<CollectorState | null> {
    let changed = false;
    const s = await this.deps.updateState((st) => {
      if (st.runId !== runId || st.status !== "running") return null;
      changed = true;
      return withLog({ ...st, status: "paused" }, "error", text);
    });
    if (!changed) return null;
    await this.deps.statusUpdate(s.backendJobId, "paused", reason);
    return s;
  }

  private async blocked(runId: string, block: JdBlock): Promise<"paused"> {
    const paused = await this.pause(runId, BLOCK_TEXT[block], `${block}_detected`);
    if (paused) await this.deps.finished(paused);
    return "paused";
  }

  private async stillRunning(runId: string) {
    const s = await this.deps.loadState();
    return s.runId === runId && s.status === "running";
  }

  private async log(runId: string, level: "info" | "success" | "warning" | "error", text: string) {
    await this.deps.updateState((s) => (s.runId === runId ? withLog({ ...s, lastHeartbeatAt: Date.now() }, level, text) : null));
  }

  private async ensureMapsTab(): Promise<number> {
    if (this.mapsTabId !== null) {
      const alive = await chrome.tabs.get(this.mapsTabId).then(() => true, () => false);
      if (alive) return this.mapsTabId;
    }
    const tab = await chrome.tabs.create({ url: "about:blank", active: false, index: 9999 });
    this.mapsTabId = tab.id ?? null;
    if (this.mapsTabId === null) throw new Error("Could not open a Google Maps tab");
    return this.mapsTabId;
  }

  private async closeMapsTab() {
    if (this.mapsTabId !== null) await chrome.tabs.remove(this.mapsTabId).catch(() => {});
    this.mapsTabId = null;
  }

  private async lookUpOnMaps(l: JdListing, location: string): Promise<SearchPlace | null> {
    const tabId = await this.ensureMapsTab();
    const query = [l.name, l.area, location].filter(Boolean).join(" ");
    await open(tabId, buildMapsSearchUrl(query));
    const res = await ask<{ places: SearchPlace[] }>(tabId, { type: "MAPS_PLACES" }).catch(() => ({ places: [] as SearchPlace[] }));
    return bestMapsMatch({ name: l.name, latitude: l.latitude, longitude: l.longitude }, res.places);
  }

  private async loop(start: CollectorState): Promise<"completed" | "paused"> {
    const runId = start.runId!;
    const tabId = start.tabId!;
    const settings = start.jobSettings!;
    const keyword = settings.keyword.trim();
    const location = settings.location.trim();
    const max = settings.maxRecords;

    // 1. The list: scroll down on each page until Max records, then the next page if any.
    const list = await loadList(runId);
    if (!list.done) {
      const known = new Set(list.listings.map((l) => l.docid));
      let url = list.url ?? list.nextUrl ?? justdialSearchUrl(keyword, location);
      if (list.pages === 0) await this.log(runId, "info", `Opening Justdial: ${keyword} in ${location} (scrolls down until ${max} businesses)`);
      let stopReason: string | null = null;
      while (list.pages < MAX_LIST_PAGES) {
        if (!(await this.stillRunning(runId))) return "paused";
        let pageAdded = 0;
        try {
          await open(tabId, url);
          const page = await ask<{ listings: JdListing[]; total: number; nextUrl: string | null; block: JdBlock | null }>(tabId, { type: "JD_PAGE" });
          if (page.block) return this.blocked(runId, page.block);
          const first = addListings(list, page.listings, known);
          pageAdded += first;
          list.pages++;
          list.url = url;
          list.nextUrl = page.nextUrl;
          await saveList(runId, list);
          await this.log(runId, "info", `List page ${list.pages}: ${first} businesses (${list.listings.length} so far)`);

          // Scroll for more on this page.
          let shown = page.total;
          for (let call = 0; list.listings.length < max && call < MAX_SCROLL_CALLS; call++) {
            if (!(await this.stillRunning(runId))) return "paused";
            const more = await ask<{ listings: JdListing[]; total: number; ended: boolean; nextUrl: string | null; block: JdBlock | null }>(tabId, {
              type: "JD_SCROLL",
              since: shown,
              want: shown + (max - list.listings.length),
              maxMs: SCROLL_CALL_MS,
            });
            if (more.block) return this.blocked(runId, more.block);
            const added = addListings(list, more.listings, known);
            pageAdded += added;
            shown = more.total;
            if (more.nextUrl) list.nextUrl = more.nextUrl;
            if (added > 0) {
              await saveList(runId, list);
              await this.log(runId, "info", `Scrolled down: +${added} businesses (${list.listings.length} of ${max})`);
            }
            // The page decides when the list ended (several calm rounds with nothing new).
            if (more.ended) break;
          }
        } catch (err) {
          // The list stopped loading (page did not answer, tab trouble…): carry on with what was
          // read, unless nothing was read at all.
          if (list.listings.length === 0) throw err;
          stopReason = `the Justdial list stopped loading (${err instanceof Error ? err.message : String(err)})`;
          break;
        }

        if (list.listings.length >= max) break;
        if (!list.nextUrl || list.nextUrl === url || pageAdded === 0) {
          stopReason = "Justdial shows no more businesses for this search";
          break;
        }
        // This page has no more: Justdial's next page (businesses already read are skipped).
        url = list.nextUrl;
        list.url = null;
        await sleep(PAGE_DELAY_MS);
      }
      if (list.listings.length > 0 && list.listings.length < max) {
        await this.log(runId, "warning", `${stopReason ?? "Justdial shows no more businesses"}: ${list.listings.length} of ${max} found. Moving on to the business pages.`);
      }
      list.done = true;
      list.url = null;
      await saveList(runId, list);
      if (list.listings.length === 0) await this.log(runId, "warning", "Justdial showed no businesses for this search");
      else await this.log(runId, "success", `List ready: ${Math.min(list.listings.length, max)} businesses to read`);
    }

    // 2. Each business.
    if (isOn(settings.jdMatchMaps)) await this.log(runId, "info", "Reading each business; Google Maps opens in a background tab only to find phone and website");
    const processed = new Set(await loadProcessedKeys(runId));
    let reveal = settings.jdShowNumber === true;
    for (const l of list.listings.slice(0, max)) {
      const key = `jd:${l.docid}`;
      if (processed.has(key)) continue;
      if (!(await this.stillRunning(runId))) return "paused";

      let profile: JdProfile | null = null;
      if (isOn(settings.jdOpenProfiles) && l.profileUrl) {
        const pressShowNumber = reveal && !l.phone && (await revealsLeft()) > 0;
        let res: { profile: JdProfile | null; block: JdBlock | null };
        try {
          await open(tabId, l.profileUrl);
          res = await ask<{ profile: JdProfile | null; block: JdBlock | null }>(tabId, { type: "JD_PROFILE", reveal: pressShowNumber });
        } catch (err) {
          // The job's tab is gone: that stops the job. One page that did not load: keep what the
          // list showed for this business and go on with the next one.
          if (!(await chrome.tabs.get(tabId).then(() => true, () => false))) throw err;
          await this.log(runId, "warning", `${l.name}: business page did not load (${err instanceof Error ? err.message : String(err)}); saved with the list details`);
          res = { profile: null, block: null };
        }
        if (pressShowNumber) await countReveal();
        if (res.block === "login") {
          reveal = false;
          await this.log(runId, "warning", "Justdial asks to log in for “Show Number”: not pressing it again in this job");
        } else if (res.block) {
          const paused = await this.pause(runId, BLOCK_TEXT[res.block], `${res.block}_detected`);
          if (paused) await this.deps.finished(paused);
          return "paused";
        }
        profile = res.profile;
      }

      let maps: SearchPlace | null = null;
      if (isOn(settings.jdMatchMaps)) maps = await this.lookUpOnMaps(l, location).catch(() => null);

      const { lead, justdial } = composeLead(l, profile, maps, { keyword, location, fields: settings.fields });
      const s = await this.deps.loadState();
      if (s.runId !== runId) return "paused";
      if (s.backendJobId) {
        const { clientKey, ...payload } = lead;
        await this.deps.enqueue({ kind: "lead", jobId: s.backendJobId, clientKey, lead: payload, justdial });
      }
      processed.add(key);
      await addProcessedKey(runId, key);
      await this.deps.updateState((st) => (st.runId === runId ? applyListing({ ...st, lastHeartbeatAt: Date.now() }, lead) : null));
      if (maps) await this.log(runId, "info", `↳ Google Maps: ${maps.name}${maps.phone ? " (phone)" : ""}${maps.website ? " (website)" : ""}`);
      // Pause before the next business page: from the Slow ↔ Fast slider (can change mid-job).
      await sleep(paceOf(await loadJdSpeed().catch(() => undefined)).profileDelay);
    }
    return "completed";
  }
}
