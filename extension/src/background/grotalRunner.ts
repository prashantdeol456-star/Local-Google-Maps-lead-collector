// Runs a Grotal job from the background, in the job's own tab, the same way as Justdial jobs:
//   1. list: finds the city in Grotal's own city list, opens the search and reads every page
//      (20 businesses each, page 2, 3…) until "Max records" or the list ends
//   2. per business: opens its Grotal page (full address, email) and, if turned on, looks it up
//      on Google Maps in a second background tab for website, rating and map link
//   3. sends each lead to the backend (same outbox as Google Maps, so nothing is lost offline)
// Calm pauses between pages (the Slow ↔ Fast slider). A block page or a closed tab pauses the job
// and the user is notified. Nothing here fills in forms, writes reviews or logs in.

import { isOn, type CollectorFieldSelection } from "@platform/shared";
import { parseAddress } from "../content/maps/parser";
import { placeMapsUrl, type SearchPlace } from "../content/maps/searchData";
import type { ExtractedListing } from "../content/maps/types";
import type { GrBlock, GrListing, GrProfile } from "../content/grotal/listing";
import { GROTAL_ORIGIN, grotalSearchUrl, isGrotalListUrl, nextPageUrl, searchOfUrl } from "../content/grotal/listing";
import type { OutboxPayload } from "../storage/outbox";
import { addProcessedKey, loadProcessedKeys, withLog, type CollectorState } from "../storage/state";
import { loadJdSpeed, paceOf } from "../utils/jdSpeed";
import { buildMapsSearchUrl } from "../utils/maps";
import type { MessageResponse } from "../utils/messages";
import { bestMapsMatch } from "./jdMatch";
import { applyListing } from "./jobController";

const MAX_LIST_PAGES = 100;
const TAB_LOAD_TIMEOUT_MS = 30_000;

export interface GrotalDeps {
  loadState(): Promise<CollectorState>;
  updateState(update: (s: CollectorState) => CollectorState | null | Promise<CollectorState | null>): Promise<CollectorState>;
  enqueue(payload: OutboxPayload): Promise<void>;
  statusUpdate(jobId: string | null, status: "running" | "paused" | "completed" | "stopped" | "failed", reason: string | null): Promise<void>;
  finished(state: CollectorState): Promise<void>;
}

export interface GrStoredList {
  listings: GrListing[];
  /** The next list page to read (null = none) */
  nextUrl: string | null;
  pages: number;
  done: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const listKey = (runId: string) => `gr-list:${runId}`;
const CURRENT_LIST_KEY = "gr-list-current";

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

async function loadList(runId: string): Promise<GrStoredList> {
  const got = (await chrome.storage.local.get(listKey(runId)))[listKey(runId)] as GrStoredList | undefined;
  return got ?? { listings: [], nextUrl: null, pages: 0, done: false };
}

async function saveList(runId: string, list: GrStoredList) {
  const current = (await chrome.storage.local.get(CURRENT_LIST_KEY))[CURRENT_LIST_KEY] as string | undefined;
  if (current && current !== runId) await chrome.storage.local.remove(listKey(current));
  await chrome.storage.local.set({ [listKey(runId)]: list, [CURRENT_LIST_KEY]: runId });
}

async function dropList(runId: string) {
  await chrome.storage.local.remove([listKey(runId), CURRENT_LIST_KEY]);
}

/** Adds the businesses not seen yet; returns how many were new. */
export function addGrListings(list: GrStoredList, incoming: GrListing[], known: Set<string>): number {
  let added = 0;
  for (const l of incoming) {
    if (known.has(l.id)) continue;
    known.add(l.id);
    list.listings.push(l);
    added++;
  }
  return added;
}

const BLOCK_TEXT: Record<GrBlock, string> = {
  captcha: "Grotal is showing a security check. Complete it yourself in the Grotal tab, then press RESUME",
  access_denied: "Grotal blocked the page. Wait a while, open Grotal yourself, then press RESUME",
};

/** One lead from a Grotal business (+ its Grotal page and Google Maps match), with the user's field choices. */
export function composeGrotalLead(
  l: GrListing,
  profile: GrProfile | null,
  maps: SearchPlace | null,
  ctx: { keyword: string; location: string; fields: CollectorFieldSelection },
): ExtractedListing {
  const pick = <T>(field: keyof CollectorFieldSelection, value: T): T | null => (ctx.fields[field] ? value : null);
  const address = profile?.address ?? l.address ?? maps?.address ?? l.area;
  const parts = parseAddress(address, ctx.location);
  // Grotal shows the business's own number (not a forwarding number), so it comes first.
  const phone = l.phone ?? profile?.phone ?? maps?.phone ?? null;
  return {
    name: l.name,
    category: pick("category", l.categories?.split(",")[0]?.trim() || maps?.category || null),
    phone: pick("phone", phone),
    email: profile?.email ?? null,
    website: pick("website", profile?.website ?? maps?.website ?? null),
    address: pick("address", address),
    city: pick("city", parts.city ?? (ctx.location.trim() || null)),
    state: pick("state", parts.state),
    country: pick("country", parts.country ?? "India"),
    postalCode: pick("address", parts.postalCode ?? address?.match(/\b\d{6}\b/)?.[0] ?? null),
    latitude: maps?.latitude ?? null,
    longitude: maps?.longitude ?? null,
    rating: pick("rating", maps?.rating ?? null),
    reviewCount: pick("reviewCount", maps?.reviewCount ?? null),
    mapsUrl: pick("mapsUrl", maps ? placeMapsUrl(maps) : null),
    placeId: maps?.placeId ?? null,
    searchKeyword: ctx.keyword,
    source: "grotal",
    clientKey: `gr:${l.id}`,
  };
}

export class GrotalRunner {
  private activeRun: string | null = null;
  private mapsTabId: number | null = null;

  constructor(private readonly deps: GrotalDeps) {}

  isActive(runId: string | null) {
    return !!runId && this.activeRun === runId;
  }

  /** Runs (or resumes) the current Grotal job. Safe to call twice: only one loop per run. */
  async run(): Promise<void> {
    const state = await this.deps.loadState();
    if (state.status !== "running" || state.jobSettings?.source !== "grotal" || !state.runId || state.tabId === null) return;
    if (this.activeRun === state.runId) return;
    const runId = state.runId;
    this.activeRun = runId;
    try {
      const outcome = await this.loop(state);
      if (outcome === "completed") {
        const done = await this.deps.updateState((s) =>
          s.runId === runId ? withLog(withLog({ ...s, status: "completed" }, "success", "Reached the end of the Grotal list"), "success", `Job completed: ${s.counters.found} businesses read`) : null,
        );
        await this.deps.statusUpdate(done.backendJobId, "completed", "end_of_list");
        await this.closeMapsTab();
        await dropList(runId);
        await this.deps.finished(done);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const paused = await this.pause(runId, `Grotal job stopped: ${message}. Check the Grotal tab, then press RESUME`, "grotal_error");
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

  private async blocked(runId: string, block: GrBlock): Promise<"paused"> {
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

  private async lookUpOnMaps(l: GrListing, location: string): Promise<SearchPlace | null> {
    const tabId = await this.ensureMapsTab();
    const query = [l.name, l.area, location].filter(Boolean).join(" ");
    await open(tabId, buildMapsSearchUrl(query));
    const res = await ask<{ places: SearchPlace[] }>(tabId, { type: "MAPS_PLACES" }).catch(() => ({ places: [] as SearchPlace[] }));
    return bestMapsMatch({ name: l.name, latitude: null, longitude: null }, res.places);
  }

  /** The first list page: the search built from Grotal's own city list. */
  private async firstUrl(tabId: number, keyword: string, location: string): Promise<string> {
    await open(tabId, `${GROTAL_ORIGIN}/`);
    const { city } = await ask<{ city: { name: string; id: string } | null }>(tabId, { type: "GR_CITY", city: location });
    if (!city) throw new Error(`Grotal does not list the city "${location}". Try a nearby big city, or paste a Grotal list address as the keyword`);
    return grotalSearchUrl(keyword, city);
  }

  private async loop(start: CollectorState): Promise<"completed" | "paused"> {
    const runId = start.runId!;
    const tabId = start.tabId!;
    const settings = start.jobSettings!;
    const typed = settings.keyword.trim();
    // A pasted list address: keyword and city come from the address itself.
    const fromUrl = isGrotalListUrl(typed) ? searchOfUrl(typed) : null;
    const keyword = fromUrl?.keyword ?? typed;
    const location = settings.location.trim() || fromUrl?.city || "";
    const max = settings.maxRecords;

    // 1. The list, page by page.
    const list = await loadList(runId);
    if (!list.done) {
      const known = new Set(list.listings.map((l) => l.id));
      let url = list.nextUrl;
      if (list.pages === 0) {
        await this.log(runId, "info", `Opening Grotal: ${keyword} in ${location}`);
        url = fromUrl ? typed : await this.firstUrl(tabId, keyword, location);
      }
      let stopReason: string | null = null;
      while (url && list.pages < MAX_LIST_PAGES && list.listings.length < max) {
        if (!(await this.stillRunning(runId))) return "paused";
        let page: { listings: GrListing[]; hasNext: boolean; block: GrBlock | null };
        try {
          await open(tabId, url);
          page = await ask(tabId, { type: "GR_PAGE" });
        } catch (err) {
          if (list.listings.length === 0) throw err;
          stopReason = `the Grotal list stopped loading (${err instanceof Error ? err.message : String(err)})`;
          break;
        }
        if (page.block) return this.blocked(runId, page.block);
        const added = addGrListings(list, page.listings, known);
        list.pages++;
        list.nextUrl = page.hasNext ? nextPageUrl(url) : null;
        await saveList(runId, list);
        await this.log(runId, "info", `List page ${list.pages}: ${added} businesses (${list.listings.length} so far)`);
        if (added === 0) {
          stopReason = "Grotal shows no more businesses for this search";
          list.nextUrl = null;
          break;
        }
        if (!list.nextUrl) stopReason = "Grotal shows no more businesses for this search";
        url = list.nextUrl;
        if (url && list.listings.length < max) await sleep(paceOf(await loadJdSpeed().catch(() => undefined)).profileDelay);
      }
      if (list.listings.length > 0 && list.listings.length < max) {
        await this.log(runId, "warning", `${stopReason ?? "Grotal shows no more businesses"}: ${list.listings.length} of ${max} found. Moving on to the business pages.`);
      }
      list.done = true;
      await saveList(runId, list);
      if (list.listings.length === 0) await this.log(runId, "warning", "Grotal showed no businesses for this search");
      else await this.log(runId, "success", `List ready: ${Math.min(list.listings.length, max)} businesses to read`);
    }

    // 2. Each business.
    if (isOn(settings.grMatchMaps)) await this.log(runId, "info", "Reading each business; Google Maps opens in a background tab only to find website and rating");
    const processed = new Set(await loadProcessedKeys(runId));
    for (const l of list.listings.slice(0, max)) {
      const key = `gr:${l.id}`;
      if (processed.has(key)) continue;
      if (!(await this.stillRunning(runId))) return "paused";

      let profile: GrProfile | null = null;
      if (isOn(settings.grOpenProfiles) && l.profileUrl) {
        let res: { profile: GrProfile | null; block: GrBlock | null };
        try {
          await open(tabId, l.profileUrl);
          res = await ask(tabId, { type: "GR_PROFILE" });
        } catch (err) {
          if (!(await chrome.tabs.get(tabId).then(() => true, () => false))) throw err;
          await this.log(runId, "warning", `${l.name}: business page did not load (${err instanceof Error ? err.message : String(err)}); saved with the list details`);
          res = { profile: null, block: null };
        }
        if (res.block) return this.blocked(runId, res.block);
        profile = res.profile;
      }

      let maps: SearchPlace | null = null;
      if (isOn(settings.grMatchMaps)) maps = await this.lookUpOnMaps(l, location).catch(() => null);

      const lead = composeGrotalLead(l, profile, maps, { keyword, location, fields: settings.fields });
      const s = await this.deps.loadState();
      if (s.runId !== runId) return "paused";
      if (s.backendJobId) {
        const { clientKey, ...payload } = lead;
        await this.deps.enqueue({ kind: "lead", jobId: s.backendJobId, clientKey, lead: payload });
      }
      processed.add(key);
      await addProcessedKey(runId, key);
      await this.deps.updateState((st) => (st.runId === runId ? applyListing({ ...st, lastHeartbeatAt: Date.now() }, lead) : null));
      if (maps) await this.log(runId, "info", `↳ Google Maps: ${maps.name}${maps.website ? " (website)" : ""}`);
      // Only pause when a page was opened for this business.
      if (profile || maps) await sleep(paceOf(await loadJdSpeed().catch(() => undefined)).profileDelay);
    }
    return "completed";
  }
}
