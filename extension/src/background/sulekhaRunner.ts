// Runs a Sulekha job from the background, in the job's own tab, like Justdial and Grotal jobs:
//   1. category: asks Sulekha's own search suggestions for the keyword in the city and takes the
//      closest category (or uses a pasted Sulekha list link)
//   2. list: reads page 1, page-2, page-3… until "Max records" or the end of the list
//   3. per business: opens its Sulekha page (phone, full address, map position, rating, contact
//      person) and, if turned on, looks it up on Google Maps for the website
//   4. sends each lead to the backend (same outbox as Google Maps, so nothing is lost offline)
// Calm pauses (the Slow ↔ Fast slider). A block page or a closed tab pauses the job and the user
// is notified. Nothing here sends enquiries, asks for quotes, writes reviews or logs in.

import { isOn, type CollectorFieldSelection } from "@platform/shared";
import { parseAddress } from "../content/maps/parser";
import { placeMapsUrl, type SearchPlace } from "../content/maps/searchData";
import type { ExtractedListing } from "../content/maps/types";
import type { SuBlock, SuCategory, SuListing, SuProfile } from "../content/sulekha/listing";
import { isSulekhaListUrl, keywordWords, listBase, pageNumberOf, pageUrl, sameWords, searchOfUrl, SULEKHA_ORIGIN } from "../content/sulekha/listing";
import type { OutboxPayload } from "../storage/outbox";
import { addProcessedKey, loadProcessedKeys, withLog, type CollectorState } from "../storage/state";
import { loadJdSpeed, paceOf } from "../utils/jdSpeed";
import { buildMapsSearchUrl } from "../utils/maps";
import type { MessageResponse } from "../utils/messages";
import { bestMapsMatch } from "./jdMatch";
import { applyListing } from "./jobController";

const MAX_LIST_PAGES = 200;
const TAB_LOAD_TIMEOUT_MS = 30_000;

export interface SulekhaDeps {
  loadState(): Promise<CollectorState>;
  updateState(update: (s: CollectorState) => CollectorState | null | Promise<CollectorState | null>): Promise<CollectorState>;
  enqueue(payload: OutboxPayload): Promise<void>;
  statusUpdate(jobId: string | null, status: "running" | "paused" | "completed" | "stopped" | "failed", reason: string | null): Promise<void>;
  finished(state: CollectorState): Promise<void>;
}

export interface SuStoredList {
  listings: SuListing[];
  /** First page of the list being read (null until the category is known) */
  base: string | null;
  category: string | null;
  /** Next page number to read (0 = list finished) */
  nextPage: number;
  pages: number;
  done: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const listKey = (runId: string) => `su-list:${runId}`;
const CURRENT_LIST_KEY = "su-list-current";

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

async function loadList(runId: string): Promise<SuStoredList> {
  const got = (await chrome.storage.local.get(listKey(runId)))[listKey(runId)] as SuStoredList | undefined;
  return got ?? { listings: [], base: null, category: null, nextPage: 1, pages: 0, done: false };
}

async function saveList(runId: string, list: SuStoredList) {
  const current = (await chrome.storage.local.get(CURRENT_LIST_KEY))[CURRENT_LIST_KEY] as string | undefined;
  if (current && current !== runId) await chrome.storage.local.remove(listKey(current));
  await chrome.storage.local.set({ [listKey(runId)]: list, [CURRENT_LIST_KEY]: runId });
}

async function dropList(runId: string) {
  await chrome.storage.local.remove([listKey(runId), CURRENT_LIST_KEY]);
}

/** Adds the businesses not seen yet; returns how many were new. */
export function addSuListings(list: SuStoredList, incoming: SuListing[], known: Set<string>): number {
  let added = 0;
  for (const l of incoming) {
    if (known.has(l.id)) continue;
    known.add(l.id);
    list.listings.push(l);
    added++;
  }
  return added;
}

/** Whether the page that opened is the one asked for (past the end Sulekha shows page 1 again). */
export function landedOnPage(landedUrl: string, wanted: number): boolean {
  return (pageNumberOf(landedUrl) ?? 1) === wanted;
}

const BLOCK_TEXT: Record<SuBlock, string> = {
  captcha: "Sulekha is showing a security check. Complete it yourself in the Sulekha tab, then press RESUME",
  access_denied: "Sulekha blocked the page. Wait a while, open Sulekha yourself, then press RESUME",
};

/** One lead from a Sulekha business (+ its Sulekha page and Google Maps match), with the user's field choices. */
export function composeSulekhaLead(
  l: SuListing,
  profile: SuProfile | null,
  maps: SearchPlace | null,
  ctx: { keyword: string; location: string; category: string | null; fields: CollectorFieldSelection },
): ExtractedListing {
  const pick = <T>(field: keyof CollectorFieldSelection, value: T): T | null => (ctx.fields[field] ? value : null);
  const address = profile?.address ?? maps?.address ?? ([l.area, ctx.location, l.pincode].filter(Boolean).join(", ") || null);
  const parts = parseAddress(address, ctx.location);
  return {
    name: profile?.name ?? l.name,
    category: pick("category", ctx.category?.replace(/\/.*$/, "").trim() || maps?.category || null),
    // Sulekha shows the business's own mobile on its page; Google Maps only when it has none.
    phone: pick("phone", profile?.phone ?? maps?.phone ?? null),
    email: null,
    website: pick("website", profile?.website ?? maps?.website ?? null),
    address: pick("address", address),
    city: pick("city", parts.city ?? (ctx.location.trim() || null)),
    state: pick("state", parts.state),
    country: pick("country", parts.country ?? "India"),
    postalCode: pick("address", parts.postalCode ?? l.pincode ?? address?.match(/\b\d{6}\b/)?.[0] ?? null),
    latitude: profile?.latitude ?? maps?.latitude ?? null,
    longitude: profile?.longitude ?? maps?.longitude ?? null,
    rating: pick("rating", profile?.rating ?? maps?.rating ?? null),
    reviewCount: pick("reviewCount", profile?.rating != null ? profile.reviewCount : maps?.reviewCount ?? null),
    mapsUrl: pick("mapsUrl", maps ? placeMapsUrl(maps) : null),
    placeId: maps?.placeId ?? null,
    searchKeyword: ctx.keyword,
    source: "sulekha",
    clientKey: `su:${l.id}`,
  };
}

export class SulekhaRunner {
  private activeRun: string | null = null;
  private mapsTabId: number | null = null;

  constructor(private readonly deps: SulekhaDeps) {}

  isActive(runId: string | null) {
    return !!runId && this.activeRun === runId;
  }

  /** Runs (or resumes) the current Sulekha job. Safe to call twice: only one loop per run. */
  async run(): Promise<void> {
    const state = await this.deps.loadState();
    if (state.status !== "running" || state.jobSettings?.source !== "sulekha" || !state.runId || state.tabId === null) return;
    if (this.activeRun === state.runId) return;
    const runId = state.runId;
    this.activeRun = runId;
    try {
      const outcome = await this.loop(state);
      if (outcome === "completed") {
        const done = await this.deps.updateState((s) =>
          s.runId === runId ? withLog(withLog({ ...s, status: "completed" }, "success", "Reached the end of the Sulekha list"), "success", `Job completed: ${s.counters.found} businesses read`) : null,
        );
        await this.deps.statusUpdate(done.backendJobId, "completed", "end_of_list");
        await this.closeMapsTab();
        await dropList(runId);
        await this.deps.finished(done);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const paused = await this.pause(runId, `Sulekha job stopped: ${message}. Check the Sulekha tab, then press RESUME`, "sulekha_error");
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

  private async blocked(runId: string, block: SuBlock): Promise<"paused"> {
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

  private async lookUpOnMaps(l: SuListing, profile: SuProfile | null, location: string): Promise<SearchPlace | null> {
    const tabId = await this.ensureMapsTab();
    const query = [profile?.name ?? l.name, l.area, location].filter(Boolean).join(" ");
    await open(tabId, buildMapsSearchUrl(query));
    const res = await ask<{ places: SearchPlace[] }>(tabId, { type: "MAPS_PLACES" }).catch(() => ({ places: [] as SearchPlace[] }));
    return bestMapsMatch({ name: profile?.name ?? l.name, latitude: profile?.latitude ?? null, longitude: profile?.longitude ?? null }, res.places);
  }

  private async loop(start: CollectorState): Promise<"completed" | "paused"> {
    const runId = start.runId!;
    const tabId = start.tabId!;
    const settings = start.jobSettings!;
    const typed = settings.keyword.trim();
    const fromUrl = isSulekhaListUrl(typed) ? searchOfUrl(typed) : null;
    const keyword = fromUrl?.keyword ?? typed;
    const location = settings.location.trim() || fromUrl?.city || "";
    const max = settings.maxRecords;

    // 1. The category and its list, page by page.
    const list = await loadList(runId);
    if (!list.done) {
      if (!list.base) {
        await this.log(runId, "info", `Opening Sulekha: ${keyword} in ${location}`);
        if (fromUrl) {
          list.base = listBase(typed);
          list.category = keyword;
        } else {
          await open(tabId, `${SULEKHA_ORIGIN}/`);
          const found = await ask<{ best: SuCategory | null; exact: boolean; others: string[] }>(tabId, { type: "SU_SEARCH", keyword, city: location });
          if (!found.best) {
            throw new Error(`Sulekha has no category for "${keyword}" in "${location}". Try other words (e.g. "Visa Consultants"), a big city nearby, or paste a Sulekha list link as the keyword`);
          }
          let chosen: SuCategory = found.best;
          if (!found.exact) {
            // Sulekha's suggestions may miss the main category ("Mobile Phone Dealers" suggests only
            // "CDMA Mobile Phone Dealers"…): the suggested list links to it in its breadcrumb.
            await open(tabId, found.best.url);
            const first = await ask<{ related: SuCategory[]; block: SuBlock | null }>(tabId, { type: "SU_PAGE" });
            if (first.block) return this.blocked(runId, first.block);
            const exact = first.related.find((c) => sameWords(c.title, keyword));
            if (exact) chosen = exact;
            else if (keywordWords(keyword) <= 1) {
              const names = [found.best.title, ...found.others].slice(0, 5).join(", ");
              throw new Error(`Sulekha has no category called "${keyword}" in ${location}; the closest are: ${names}. Type the full service name (e.g. "Mobile Phone Dealers") and start again`);
            }
          }
          list.base = chosen.url;
          list.category = chosen.title;
          const also = found.others.filter((o) => o !== chosen.title);
          await this.log(runId, "info", `Sulekha category: ${chosen.title}${also.length ? ` (also on Sulekha: ${also.join(", ")})` : ""}`);
        }
        list.nextPage = 1;
        await saveList(runId, list);
      }
      const known = new Set(list.listings.map((l) => l.id));
      let stopReason: string | null = null;
      while (list.nextPage > 0 && list.pages < MAX_LIST_PAGES && list.listings.length < max) {
        if (!(await this.stillRunning(runId))) return "paused";
        const n = list.nextPage;
        let page: { listings: SuListing[]; landedUrl: string; block: SuBlock | null };
        try {
          await open(tabId, pageUrl(list.base!, n));
          page = await ask(tabId, { type: "SU_PAGE" });
        } catch (err) {
          if (list.listings.length === 0) throw err;
          stopReason = `the Sulekha list stopped loading (${err instanceof Error ? err.message : String(err)})`;
          break;
        }
        if (page.block) return this.blocked(runId, page.block);
        const added = landedOnPage(page.landedUrl, n) ? addSuListings(list, page.listings, known) : 0;
        list.pages++;
        list.nextPage = added > 0 ? n + 1 : 0;
        await saveList(runId, list);
        if (added === 0) {
          stopReason = "Sulekha shows no more businesses in this category";
          break;
        }
        await this.log(runId, "info", `List page ${n}: ${added} businesses (${list.listings.length} so far)`);
        if (list.listings.length < max) await sleep(paceOf(await loadJdSpeed().catch(() => undefined)).profileDelay);
      }
      if (list.listings.length > 0 && list.listings.length < max) {
        await this.log(runId, "warning", `${stopReason ?? "Sulekha shows no more businesses"}: ${list.listings.length} of ${max} found. Moving on to the business pages.`);
      }
      list.done = true;
      await saveList(runId, list);
      if (list.listings.length === 0) await this.log(runId, "warning", "Sulekha showed no businesses for this search");
      else await this.log(runId, "success", `List ready: ${Math.min(list.listings.length, max)} businesses to read`);
    }

    // 2. Each business.
    if (isOn(settings.suMatchMaps)) await this.log(runId, "info", "Reading each business; Google Maps opens in a background tab only to find the website");
    const processed = new Set(await loadProcessedKeys(runId));
    for (const l of list.listings.slice(0, max)) {
      const key = `su:${l.id}`;
      if (processed.has(key)) continue;
      if (!(await this.stillRunning(runId))) return "paused";

      let profile: SuProfile | null = null;
      if (isOn(settings.suOpenProfiles)) {
        let res: { profile: SuProfile | null; block: SuBlock | null };
        try {
          await open(tabId, l.profileUrl);
          res = await ask(tabId, { type: "SU_PROFILE" });
        } catch (err) {
          if (!(await chrome.tabs.get(tabId).then(() => true, () => false))) throw err;
          await this.log(runId, "warning", `${l.name}: business page did not load (${err instanceof Error ? err.message : String(err)}); saved with the list details`);
          res = { profile: null, block: null };
        }
        if (res.block) return this.blocked(runId, res.block);
        profile = res.profile;
      }

      let maps: SearchPlace | null = null;
      if (isOn(settings.suMatchMaps)) maps = await this.lookUpOnMaps(l, profile, location).catch(() => null);

      const lead = composeSulekhaLead(l, profile, maps, { keyword, location, category: list.category, fields: settings.fields });
      const s = await this.deps.loadState();
      if (s.runId !== runId) return "paused";
      if (s.backendJobId) {
        const { clientKey, ...payload } = lead;
        await this.deps.enqueue({ kind: "lead", jobId: s.backendJobId, clientKey, lead: payload });
      }
      processed.add(key);
      await addProcessedKey(runId, key);
      await this.deps.updateState((st) => (st.runId === runId ? applyListing({ ...st, lastHeartbeatAt: Date.now() }, lead) : null));
      if (profile?.contactPerson) await this.log(runId, "info", `↳ ${l.name}: contact person ${profile.contactPerson}`);
      if (maps) await this.log(runId, "info", `↳ Google Maps: ${maps.name}${maps.website ? " (website)" : ""}`);
      if (isOn(settings.suOpenProfiles) || maps) await sleep(paceOf(await loadJdSpeed().catch(() => undefined)).profileDelay);
    }
    return "completed";
  }
}
