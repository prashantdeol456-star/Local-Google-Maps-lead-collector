import { defaultCollectorSettings } from "@platform/shared";
import { describe, expect, it } from "vitest";
import type { ListEnd, MapsPage } from "../src/content/maps/page";
import { runFastCollection, type RunHooks, type RunOptions } from "../src/content/maps/runner";
import { parseSearchPayload, placeMapsUrl, sameQuery } from "../src/content/maps/searchData";
import { SearchStore } from "../src/content/maps/searchStore";
import type { ExtractedListing } from "../src/content/maps/types";

// A place shaped like Google Maps' search data (only the positions the parser reads are filled).
function place(i: number, extra: { phone?: string | null; site?: string | null } = {}) {
  const p: unknown[] = [];
  p[4] = [null, null, null, null, null, null, null, 4.5, 100 + i];
  p[7] = extra.site === null ? null : [extra.site ?? `https://clinic${i}.in/`, `clinic${i}.in`];
  p[9] = [null, null, Number((26.85 + i / 1000).toFixed(3)), 80.94];
  p[10] = `0x399bfd${i.toString(16).padStart(4, "0")}:0xabc${i}`;
  p[11] = `Clinic ${i}`;
  p[13] = ["Dentist", "Orthodontist"];
  p[39] = `${i} Park Rd, Hazratganj, Lucknow, Uttar Pradesh 226001`;
  p[78] = `ChIJplace${i}`;
  p[178] = extra.phone === null ? null : [[`0522 400 ${String(i).padStart(4, "0")}`, null, null, null, null, [`tel:${extra.phone ?? `0522400${String(i).padStart(4, "0")}`}`]]];
  return [null, p];
}
const payload = (query: string, from: number, count: number) =>
  `)]}'\n${JSON.stringify([[query, 1], ...Array(63).fill(null), Array.from({ length: count }, (_, k) => place(from + k))])}`;

describe("reading Maps' own search data", () => {
  it("reads every field of a result without opening it", () => {
    const parsed = parseSearchPayload(payload("dentist in Lucknow", 1, 2))!;
    expect(parsed.query).toBe("dentist in Lucknow");
    expect(parsed.places).toHaveLength(2);
    expect(parsed.places[0]).toEqual({
      featureId: "0x399bfd0001:0xabc1",
      placeId: "ChIJplace1",
      name: "Clinic 1",
      category: "Dentist",
      phone: "05224000001",
      website: "https://clinic1.in/",
      address: "1 Park Rd, Hazratganj, Lucknow, Uttar Pradesh 226001",
      latitude: 26.851,
      longitude: 80.94,
      rating: 4.5,
      reviewCount: 101,
    });
  });

  it("leaves missing values empty and ignores Google's own pages as websites", () => {
    const text = `)]}'\n${JSON.stringify([["q"], [place(3, { phone: null, site: "https://www.google.com/maps" })]])}`;
    expect(parseSearchPayload(text)!.places[0]).toMatchObject({ phone: null, website: null });
    expect(parseSearchPayload("not json")).toBeNull();
  });

  it("matches the search however it is written, and links to the place", () => {
    expect(sameQuery("Dentist  in lucknow", "dentist+in Lucknow")).toBe(true);
    expect(sameQuery("dentist", "bakery")).toBe(false);
    expect(placeMapsUrl({ placeId: "ChIJx", featureId: "0x1:0x2", name: "A" })).toBe("https://www.google.com/maps/place/?q=place_id:ChIJx");
  });

  it("keeps each search apart and drops repeats", () => {
    const store = new SearchStore();
    expect(store.add(payload("dentist in Lucknow", 1, 3))).toBe(3);
    expect(store.add(payload("dentist in Lucknow", 1, 3))).toBe(0); // replayed
    store.add(payload("bakery in Lucknow", 50, 2));
    expect(store.placesFor("Dentist in Lucknow")).toHaveLength(3);
    expect(store.placesFor("bakery in lucknow")).toHaveLength(2);
    expect(store.latestQuery()).toBe("bakery in Lucknow");
  });
});

/** Maps page for the fast mode: each scroll makes "Maps" load the next page into the store. */
class FakeListPage implements MapsPage {
  scrolls = 0;
  captchaAfterScrolls: number | null = null;
  constructor(
    private readonly store: SearchStore,
    private readonly pages: string[],
    private readonly end: ListEnd | null = "end_of_list",
  ) {}
  challenge() {
    return this.captchaAfterScrolls !== null && this.scrolls >= this.captchaAfterScrolls ? ("captcha" as const) : null;
  }
  hasResultsList() {
    return true;
  }
  async waitForResults() {
    return true;
  }
  cards() {
    return [];
  }
  listEnd() {
    return this.scrolls >= this.pages.length ? this.end : null;
  }
  async scrollResults() {
    const next = this.pages[this.scrolls++];
    if (next) setTimeout(() => this.store.add(next), 5);
  }
  async open(): Promise<never> {
    throw new Error("fast mode must not open listings");
  }
  async backToResults() {
    return true;
  }
  snapshot(): never {
    throw new Error("not used");
  }
  async perform() {}
}

function setup(pages: string[], end: ListEnd | null = "end_of_list", maxRecords = 500) {
  const store = new SearchStore();
  store.add(payload("dentist in Lucknow", 1, 20));
  const page = new FakeListPage(store, pages, end);
  const listings: ExtractedListing[] = [];
  const waits: number[] = [];
  const opts: RunOptions = {
    searchKeyword: "dentist",
    searchQuery: "dentist in Lucknow",
    location: "Lucknow",
    fields: defaultCollectorSettings().fields,
    maxRecords,
    processedKeys: [],
    delayMs: 1500,
    pageWaitMs: 100,
  };
  const hooks: RunHooks = {
    control: () => "run",
    onListing: (l) => void listings.push(l),
    onError: () => {},
    onProcessed: () => {},
    wait: async (ms) => void waits.push(ms),
  };
  return { store, page, listings, waits, run: () => runFastCollection(page, store, opts, hooks) };
}

describe("fast mode", () => {
  it("reads page after page by scrolling, never opening a listing", async () => {
    const t = setup([payload("dentist in Lucknow", 21, 20), payload("dentist in Lucknow", 41, 7)]);
    expect(await t.run()).toEqual({ reason: "end_of_list" });
    expect(t.listings).toHaveLength(47);
    expect(t.listings[0]).toMatchObject({ name: "Clinic 1", phone: "05224000001", city: "Lucknow", state: "Uttar Pradesh", postalCode: "226001", clientKey: "0x399bfd0001:0xabc1" });
    expect(t.waits.every((ms) => ms === 1500)).toBe(true); // the background keeps the time
  });

  it("stops at the maximum", async () => {
    const t = setup([payload("dentist in Lucknow", 21, 20)], "end_of_list", 25);
    expect(await t.run()).toEqual({ reason: "max_reached" });
    expect(t.listings).toHaveLength(25);
  });

  it("stops when scrolling brings nothing new", async () => {
    const t = setup([], null);
    expect(await t.run()).toEqual({ reason: "no_more_results" });
    expect(t.listings).toHaveLength(20);
    expect(t.page.scrolls).toBe(3);
  });

  it("pauses for a security check", async () => {
    const t = setup([payload("dentist in Lucknow", 21, 20)]);
    t.page.captchaAfterScrolls = 1;
    expect(await t.run()).toEqual({ reason: "challenge", kind: "captcha" });
    expect(t.listings).toHaveLength(20); // stops at once: nothing is read past a security check
  });

  it("ignores data from another search", async () => {
    const t = setup([payload("bakery in Lucknow", 900, 20)], null);
    expect(await t.run()).toEqual({ reason: "no_more_results" });
    expect(t.listings.every((l) => l.name !== "Clinic 900")).toBe(true);
  });
});

describe("fast mode with Maps showing results a few at a time", () => {
  it("keeps scrolling while new cards appear, even before the next 20 load", async () => {
    const store = new SearchStore();
    store.add(payload("dentist in Lucknow", 1, 20));
    let shown = 6;
    let scrolls = 0;
    const page = {
      ...new FakeListPage(store, []),
      challenge: () => null,
      hasResultsList: () => true,
      listEnd: () => (scrolls >= 6 ? ("end_of_list" as const) : null),
      cards: () => Array.from({ length: shown }, () => ({}) as never),
      async scrollResults() {
        scrolls++;
        if (shown < 20) shown += 6; // drawing what Maps already has
        else if (scrolls === 5) setTimeout(() => store.add(payload("dentist in Lucknow", 21, 20)), 5);
      },
    } as unknown as MapsPage;
    const listings: ExtractedListing[] = [];
    const outcome = await runFastCollection(
      page,
      store,
      { searchKeyword: "dentist", searchQuery: "dentist in Lucknow", fields: defaultCollectorSettings().fields, maxRecords: 500, processedKeys: [], delayMs: 0, pageWaitMs: 50, maxEmptyScrolls: 3 },
      { control: () => "run", onListing: (l) => void listings.push(l), onError: () => {}, onProcessed: () => {}, wait: async () => {} },
    );
    expect(outcome).toEqual({ reason: "end_of_list" });
    expect(listings).toHaveLength(40);
  });
});
