// Collects the search data that mapsTap.iife.ts (inside the Maps page) passes on, so the fast
// mode can read every result without opening it.

import { parseSearchPayload, sameQuery, type SearchPlace } from "./searchData";

export const TAP_TAG = "maps-collector-tap";

export interface SearchSource {
  /** Results for this search, in the order Maps loaded them. */
  placesFor(query: string): SearchPlace[];
  /** The search of the latest data (used when the job keyword was typed differently in Maps). */
  latestQuery(): string | null;
  /** Bumped on every new response. */
  version(): number;
  /** Resolves true as soon as a newer response arrives, false after the timeout. */
  waitForChange(since: number, timeoutMs: number): Promise<boolean>;
}

export class SearchStore implements SearchSource {
  private byQuery = new Map<string, Map<string, SearchPlace>>();
  private latest: string | null = null;
  private v = 0;
  private waiters = new Set<() => void>();

  /** Adds one raw response; returns how many new places it brought. */
  add(text: string): number {
    const payload = parseSearchPayload(text);
    if (!payload || payload.places.length === 0) return 0;
    const key = (payload.query ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    let places = this.byQuery.get(key);
    if (!places) {
      places = new Map();
      this.byQuery.set(key, places);
    }
    let added = 0;
    for (const p of payload.places) {
      if (!places.has(p.featureId)) {
        places.set(p.featureId, p);
        added++;
      }
    }
    if (payload.query) this.latest = payload.query;
    this.v++;
    for (const wake of this.waiters) wake();
    return added;
  }

  placesFor(query: string): SearchPlace[] {
    for (const [key, places] of this.byQuery) if (sameQuery(key, query)) return [...places.values()];
    return [];
  }

  /** Every place seen on this page, whatever the search (for looking up one business). */
  allPlaces(): SearchPlace[] {
    const out = new Map<string, SearchPlace>();
    for (const places of this.byQuery.values()) for (const [id, p] of places) out.set(id, p);
    return [...out.values()];
  }

  latestQuery() {
    return this.latest;
  }

  version() {
    return this.v;
  }

  waitForChange(since: number, timeoutMs: number): Promise<boolean> {
    if (this.v > since) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (changed: boolean) => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve(changed);
      };
      const wake = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.waiters.add(wake);
    });
  }

  /** Listens to the page tap and asks it to resend what Maps loaded before this script started. */
  listen(win: Window = window): this {
    win.addEventListener("message", (e: MessageEvent) => {
      if (e.source !== win || e.data?.source !== TAP_TAG || e.data.kind !== "search" || typeof e.data.text !== "string") return;
      this.add(e.data.text);
    });
    win.postMessage({ source: TAP_TAG, kind: "replay" }, win.location.origin);
    return this;
  }
}
