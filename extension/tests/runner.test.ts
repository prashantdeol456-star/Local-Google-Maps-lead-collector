import { defaultCollectorSettings, type AiAction, type AiStep, type PageSnapshot } from "@platform/shared";
import { describe, expect, it } from "vitest";
import type { ListEnd, MapsPage } from "../src/content/maps/page";
import { runCollection, type RunHooks, type RunOptions } from "../src/content/maps/runner";
import type { ChallengeKind, DetailFields, ExtractedListing, ResultCard } from "../src/content/maps/types";

/** In-memory Maps page: results load in batches as you scroll. */
class FakePage implements MapsPage {
  loaded: number;
  opened: string[] = [];
  challengeAfterOpens: number | null = null;
  failing = new Set<string>();
  end: ListEnd | null;
  /** false = the results list is not on screen yet (e.g. a search still loading). */
  listVisible = true;
  listAppearsOnWait = true;
  backCalls = 0;
  waits = 0;
  performed: AiAction[] = [];
  /** What an AI step does to the page (default: nothing). */
  onPerform: (a: AiAction) => void = () => {};
  snapshotTitle = "Google Maps";

  constructor(
    private readonly all: ResultCard[],
    private readonly batch: number,
    end: ListEnd | null = "end_of_list",
  ) {
    this.loaded = Math.min(batch, all.length);
    this.end = end;
  }

  challenge(): ChallengeKind | null {
    return this.challengeAfterOpens !== null && this.opened.length >= this.challengeAfterOpens ? "captcha" : null;
  }
  hasResultsList() {
    return this.listVisible;
  }
  async waitForResults() {
    this.waits++;
    this.listVisible = this.listAppearsOnWait;
    return this.listVisible;
  }
  cards() {
    return this.all.slice(0, this.loaded);
  }
  listEnd() {
    return this.loaded >= this.all.length ? this.end : null;
  }
  async scrollResults() {
    this.loaded = Math.min(this.loaded + this.batch, this.all.length);
  }
  async open(card: ResultCard): Promise<DetailFields> {
    this.opened.push(card.key);
    if (this.failing.has(card.key)) throw new Error("Details did not load in time");
    return {
      name: card.name,
      category: "University",
      ratingLabel: "4.0 stars",
      reviewsLabel: "10 reviews",
      reviewsText: "(10)",
      address: null,
      phoneItemId: null,
      websiteHref: null,
    };
  }
  async backToResults() {
    this.backCalls++;
    this.listVisible = true;
    return true;
  }
  snapshot(): PageSnapshot {
    return {
      pageKind: "maps",
      urlQuery: null,
      title: this.snapshotTitle,
      hasResultsList: this.listVisible,
      placeLinks: 0,
      hasSearchBox: true,
      candidates: [
        { i: 0, role: "button", label: "Expand side panel" },
        { i: 1, role: "button", label: "Close" },
      ],
      text: "",
    };
  }
  async perform(action: AiAction) {
    this.performed.push(action);
    this.onPerform(action);
  }
}

const step = (action: AiAction["action"], extra: Partial<AiAction> = {}): AiAction => ({ action, target: -1, seconds: 0, stopReason: "none", note: "", ...extra });

/** Fake AI: answers in order; records what it was shown. */
function fakeAssist(answers: (AiAction | { error: string })[]) {
  const seen: { snapshot: PageSnapshot; history: AiStep[] }[] = [];
  const assist = async (snapshot: PageSnapshot, history: AiStep[]) => {
    seen.push({ snapshot, history: [...history] });
    const next = answers.shift() ?? step("stop", { stopReason: "unknown_layout" });
    return "error" in next ? ({ ok: false, error: next.error } as const) : ({ ok: true, action: next } as const);
  };
  return { assist, seen };
}

const cards = (n: number): ResultCard[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `0x${i}:0x${i}`,
    name: `Place ${i}`,
    href: `https://www.google.com/maps/place/P${i}`,
    placeId: null,
    featureId: `0x${i}:0x${i}`,
    latitude: null,
    longitude: null,
  }));

function setup(overrides: Partial<RunOptions> = {}) {
  const listings: ExtractedListing[] = [];
  const errors: string[] = [];
  const processed: string[] = [];
  let control: "run" | "pause" | "stop" = "run";
  const hooks: RunHooks = {
    control: () => control,
    onListing: (l) => void listings.push(l),
    onError: (_k, name) => void errors.push(name),
    onProcessed: (k) => void processed.push(k),
  };
  const opts: RunOptions = {
    searchKeyword: "University",
    fields: defaultCollectorSettings().fields,
    maxRecords: 100,
    processedKeys: [],
    delayMs: 0,
    ...overrides,
  };
  return { listings, errors, processed, hooks, opts, setControl: (c: typeof control) => (control = c) };
}

describe("runCollection", () => {
  it("reads every result across scroll batches until the end of the list", async () => {
    const page = new FakePage(cards(7), 3);
    const { listings, hooks, opts, processed } = setup();
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "end_of_list" });
    expect(listings.map((l) => l.name)).toEqual(cards(7).map((c) => c.name));
    expect(processed).toHaveLength(7);
    expect(listings[0]).toMatchObject({ rating: 4, reviewCount: 10, searchKeyword: "University", phone: null });
  });

  it("stops at maxRecords", async () => {
    const page = new FakePage(cards(10), 4);
    const { listings, hooks, opts } = setup({ maxRecords: 5 });
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "max_reached" });
    expect(listings).toHaveLength(5);
  });

  it("reports the signed-out limited view as its own outcome", async () => {
    const page = new FakePage(cards(2), 2, "limited_view");
    const { hooks, opts } = setup();
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "limited_view" });
  });

  it("gives up after repeated scrolls load nothing new", async () => {
    const page = new FakePage(cards(2), 2, null);
    const { hooks, opts } = setup({ maxEmptyScrolls: 2 });
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "no_more_results" });
  });

  it("skips listings processed before a pause/resume", async () => {
    const page = new FakePage(cards(5), 5);
    const { listings, hooks, opts } = setup({ processedKeys: ["0x0:0x0", "0x1:0x1"] });
    await runCollection(page, opts, hooks);
    expect(listings.map((l) => l.name)).toEqual(["Place 2", "Place 3", "Place 4"]);
    expect(page.opened).not.toContain("0x0:0x0");
  });

  it("counts previously processed listings toward maxRecords", async () => {
    const page = new FakePage(cards(5), 5);
    const { listings, hooks, opts } = setup({ processedKeys: ["0x0:0x0", "0x1:0x1"], maxRecords: 3 });
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "max_reached" });
    expect(listings).toHaveLength(1);
  });

  it("stops immediately when a CAPTCHA appears and never retries past it", async () => {
    const page = new FakePage(cards(6), 6);
    page.challengeAfterOpens = 2;
    const { listings, hooks, opts } = setup();
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "challenge", kind: "captcha" });
    expect(listings).toHaveLength(2);
    expect(page.opened).toHaveLength(2);
  });

  it("records an error for a listing that fails, marks it processed, and continues", async () => {
    const page = new FakePage(cards(3), 3);
    page.failing.add("0x1:0x1");
    const { listings, errors, processed, hooks, opts } = setup();
    await runCollection(page, opts, hooks);
    expect(errors).toEqual(["Place 1"]);
    expect(listings.map((l) => l.name)).toEqual(["Place 0", "Place 2"]);
    expect(processed).toContain("0x1:0x1");
  });

  it("honours pause and stop between listings", async () => {
    const page = new FakePage(cards(5), 5);
    const s = setup();
    const hooks: RunHooks = {
      ...s.hooks,
      onListing: (l) => {
        s.listings.push(l);
        if (s.listings.length === 2) s.setControl("pause");
      },
    };
    expect(await runCollection(page, s.opts, hooks)).toEqual({ reason: "paused" });
    expect(s.listings).toHaveLength(2);

    const t = setup();
    t.setControl("stop");
    expect(await runCollection(new FakePage(cards(3), 3), t.opts, t.hooks)).toEqual({ reason: "stopped" });
    expect(t.listings).toHaveLength(0);
  });
});

describe("runCollection start-up", () => {
  it("waits for a still-loading results list instead of navigating back", async () => {
    const page = new FakePage(cards(2), 2);
    page.listVisible = false;
    const { listings, hooks, opts } = setup();
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "end_of_list" });
    expect(page.waits).toBe(1);
    expect(listings).toHaveLength(2);
  });

  it("reports no_results_list when the list never appears, without going back", async () => {
    const page = new FakePage(cards(2), 2);
    page.listVisible = false;
    page.listAppearsOnWait = false;
    const { hooks, opts } = setup();
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "no_results_list" });
    expect(page.backCalls).toBe(0);
  });
});

describe("AI assist (optional)", () => {
  function hiddenList() {
    const page = new FakePage(cards(2), 5);
    page.listVisible = false;
    page.listAppearsOnWait = false;
    return page;
  }

  it("is not used unless the user turned it on", async () => {
    const page = hiddenList();
    const { hooks, opts } = setup();
    expect(await runCollection(page, opts, hooks)).toEqual({ reason: "no_results_list" });
    expect(page.performed).toEqual([]);
  });

  it("takes AI steps until the list is back, then collects deterministically", async () => {
    const page = hiddenList();
    page.onPerform = (a) => {
      if (a.action === "click" && a.target === 0) page.listVisible = true;
    };
    const ai = fakeAssist([step("click", { target: 1 }), step("click", { target: 0, note: "panel was collapsed" })]);
    const { hooks, opts, listings } = setup();
    expect(await runCollection(page, opts, { ...hooks, assist: ai.assist })).toEqual({ reason: "end_of_list" });
    expect(listings).toHaveLength(2);
    expect(page.performed.map((a) => a.target)).toEqual([1, 0]);
    expect(ai.seen[1]!.history).toEqual([{ action: "click", label: "Close", result: "no_change" }]);
  });

  it("never runs an answer that does not match the page, and stops on AI stop / errors", async () => {
    let page = hiddenList();
    let ai = fakeAssist([step("click", { target: 9 })]);
    let r = await runCollection(page, setup().opts, { ...setup().hooks, assist: ai.assist });
    expect(r).toMatchObject({ reason: "ai_stopped", stopReason: "unknown_layout", note: expect.stringContaining("not one of the listed") });
    expect(page.performed).toEqual([]);

    page = hiddenList();
    ai = fakeAssist([step("stop", { stopReason: "no_results", note: "Maps says no results" })]);
    r = await runCollection(page, setup().opts, { ...setup().hooks, assist: ai.assist });
    expect(r).toEqual({ reason: "ai_stopped", stopReason: "no_results", note: "Maps says no results" });

    page = hiddenList();
    ai = fakeAssist([{ error: "AI navigation is off" }]);
    r = await runCollection(page, setup().opts, { ...setup().hooks, assist: ai.assist });
    expect(r).toEqual({ reason: "ai_stopped", stopReason: "unknown_layout", note: "AI navigation is off" });
  });

  it("hands search back to the background, and gives up after the step limit", async () => {
    let page = hiddenList();
    let ai = fakeAssist([step("search")]);
    expect(await runCollection(page, setup().opts, { ...setup().hooks, assist: ai.assist })).toEqual({ reason: "ai_search" });

    page = hiddenList();
    ai = fakeAssist(Array.from({ length: 10 }, () => step("scroll_results")));
    const r = await runCollection(page, setup().opts, { ...setup().hooks, assist: ai.assist });
    expect(r).toMatchObject({ reason: "ai_stopped", note: expect.stringContaining("after 6 AI steps") });
    expect(page.performed).toHaveLength(6);
  });

  it("a challenge appearing during recovery always stops it (never handled by AI)", async () => {
    const page = hiddenList();
    page.onPerform = () => {
      page.challengeAfterOpens = 0; // a CAPTCHA appears after the first step
    };
    const ai = fakeAssist([step("click", { target: 1 }), step("click", { target: 0 })]);
    expect(await runCollection(page, setup().opts, { ...setup().hooks, assist: ai.assist })).toEqual({ reason: "challenge", kind: "captcha" });
    expect(ai.seen).toHaveLength(1); // the AI is not asked again once a challenge shows
    expect(page.performed).toHaveLength(1);
  });
});
