// Browser-side actions on the Maps page (scroll, open a result, go back).
// The runner only talks to the MapsPage interface, so it can be tested with a fake.

import type { AiAction, PageSnapshot } from "@platform/shared";
import { detectChallenge } from "../challengeDetector";
import { readDetailFields, readResultCards } from "./extractor";
import { cleanText } from "./parser";
import { SELECTORS, TEXT_MARKERS } from "./selectors";
import { buildSnapshot } from "./snapshot";
import type { ChallengeKind, DetailFields, ResultCard } from "./types";

export type ListEnd = "end_of_list" | "limited_view";

export interface MapsPage {
  challenge(): ChallengeKind | null;
  hasResultsList(): boolean;
  /** Waits for the results list to appear (e.g. right after a search loads). */
  waitForResults(timeoutMs: number): Promise<boolean>;
  cards(): ResultCard[];
  listEnd(): ListEnd | null;
  scrollResults(): Promise<void>;
  /** Opens the card and reads its detail panel. Throws if it does not load in time. */
  open(card: ResultCard): Promise<DetailFields>;
  /** Returns to the results list; false if the list could not be shown again. */
  backToResults(): Promise<boolean>;
  /** Sanitized summary for the optional AI assist (remembers which element each index is). */
  snapshot(): PageSnapshot;
  /** Carries out one in-page AI step (click a listed element, scroll, back, wait). */
  perform(action: AiAction): Promise<void>;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor<T>(check: () => T | null | undefined | false, timeoutMs: number, intervalMs = 200): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() >= end) return null;
    await sleep(intervalMs);
  }
}

export const PAGE_TIMEOUTS = {
  initialResultsMs: 15_000,
  detailLoadMs: 12_000,
  detailSettleMs: 1_500,
  backToListMs: 8_000,
  afterScrollMs: 2_000,
};

export class DomMapsPage implements MapsPage {
  private listed: Element[] = [];

  constructor(private readonly doc: Document = document) {}

  challenge() {
    return detectChallenge(this.doc, this.doc.location ?? { hostname: "", pathname: "" });
  }

  private feed() {
    return this.doc.querySelector<HTMLElement>(SELECTORS.resultsFeed);
  }

  hasResultsList() {
    return !!this.feed();
  }

  async waitForResults(timeoutMs: number) {
    return !!(await waitFor(() => this.feed(), timeoutMs));
  }

  cards() {
    return readResultCards(this.doc);
  }

  listEnd(): ListEnd | null {
    const text = this.feed()?.textContent ?? "";
    if (TEXT_MARKERS.endOfList.some((m) => text.includes(m))) return "end_of_list";
    if (TEXT_MARKERS.limitedView.some((m) => text.includes(m))) return "limited_view";
    return null;
  }

  async scrollResults() {
    const feed = this.feed();
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
    await sleep(PAGE_TIMEOUTS.afterScrollMs);
  }

  /** The detail panel for this card (the results pane can also be a role=main). */
  private detailPanelFor(card: ResultCard): Element | null {
    for (const panel of this.doc.querySelectorAll(SELECTORS.detailPanel)) {
      const h1 = cleanText(panel.querySelector(SELECTORS.detailName)?.textContent);
      if (!h1) continue;
      const label = cleanText(panel.getAttribute("aria-label"));
      const urlMatches = !!card.featureId && this.doc.location.href.toLowerCase().includes(card.featureId);
      if (label === card.name || h1 === card.name || urlMatches) return panel;
    }
    return null;
  }

  async open(card: ResultCard): Promise<DetailFields> {
    const link = [...(this.feed()?.querySelectorAll<HTMLAnchorElement>(SELECTORS.resultLink) ?? [])].find(
      (a) => (a.href || a.getAttribute("href") || "").toLowerCase().includes(card.featureId ?? card.href.toLowerCase()),
    );
    if (!link) throw new Error("Result is no longer in the list");
    link.scrollIntoView({ block: "center" });
    link.click();

    const panel = await waitFor(() => this.detailPanelFor(card), PAGE_TIMEOUTS.detailLoadMs);
    if (!panel) throw new Error("Details did not load in time");
    // Contact rows render slightly after the header.
    await waitFor(
      () => panel.querySelector(`${SELECTORS.detailAddress}, ${SELECTORS.detailPhone}, ${SELECTORS.detailWebsite}`),
      PAGE_TIMEOUTS.detailSettleMs,
    );
    return readDetailFields(panel);
  }

  async backToResults() {
    if (this.feed()) return true;
    history.back();
    if (await waitFor(() => this.feed(), PAGE_TIMEOUTS.backToListMs)) return true;
    this.doc.querySelector<HTMLButtonElement>(SELECTORS.backButton)?.click();
    return !!(await waitFor(() => this.feed(), PAGE_TIMEOUTS.backToListMs));
  }

  snapshot(): PageSnapshot {
    const built = buildSnapshot(this.doc, this.doc.location.href);
    this.listed = built.elements;
    return built.snapshot;
  }

  async perform(action: AiAction): Promise<void> {
    switch (action.action) {
      case "click": {
        const el = this.listed[action.target];
        // Only an element from the last snapshot, and only while it is still on the page.
        if (!el?.isConnected) throw new Error("That element is no longer on the page");
        (el as HTMLElement).scrollIntoView({ block: "center" });
        (el as HTMLElement).click();
        break;
      }
      case "scroll_results": {
        const box = this.feed() ?? this.doc.querySelector<HTMLElement>('[role="main"]');
        if (box) box.scrollTop += box.clientHeight || 600;
        break;
      }
      case "scroll_page":
        this.doc.defaultView?.scrollBy(0, 600);
        break;
      case "back":
        history.back();
        break;
      case "wait":
        await sleep(action.seconds * 1000);
        return;
      default:
        return; // search / done / stop are handled by the runner and the background
    }
    await sleep(PAGE_TIMEOUTS.afterScrollMs);
  }
}
