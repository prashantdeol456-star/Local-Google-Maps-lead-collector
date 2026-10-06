// Collection loop: open each unprocessed result, extract it, report it, go back.
// Deterministic: fixed delay between listings, stops on any security challenge.

import { AI_LIMITS, checkAiAction, type AiAction, type AiStep, type AiStopReason, type CollectorFieldSelection, type PageSnapshot } from "@platform/shared";
import { buildListing } from "./extractor";
import { sleep, type MapsPage } from "./page";
import type { ChallengeKind, ExtractedListing } from "./types";

export type RunOutcome =
  | { reason: "max_reached" | "end_of_list" | "limited_view" | "no_more_results" | "paused" | "stopped" }
  | { reason: "challenge"; kind: ChallengeKind }
  | { reason: "no_results_list" }
  /** AI assist asked to open the job's search again (done by the background, Maps only). */
  | { reason: "ai_search" }
  | { reason: "ai_stopped"; stopReason: AiStopReason; note: string }
  | { reason: "crashed"; message: string };

export interface RunOptions {
  searchKeyword: string;
  /** Job location (e.g. "Lucknow"); used as a hint when splitting addresses. */
  location?: string | null;
  fields: CollectorFieldSelection;
  maxRecords: number;
  /** Listings already handled in this job (survives pause/resume and page reloads). */
  processedKeys: Iterable<string>;
  /** Pause between listings. Fixed on purpose: polite pacing, not detection evasion. */
  delayMs: number;
  /** Scrolls in a row without new results before giving up. */
  maxEmptyScrolls?: number;
  /** How long to wait for the results list when the run starts. */
  initialWaitMs?: number;
}

export interface RunHooks {
  /** Checked before every step. */
  control(): "run" | "pause" | "stop";
  onListing(listing: ExtractedListing): void | Promise<void>;
  onError(clientKey: string, name: string, message: string): void | Promise<void>;
  /** Called for every key as soon as it is attempted, so a crash never repeats it. */
  onProcessed(clientKey: string): void | Promise<void>;
  /** Optional AI assist (only when the user turned it on): asks for one next step. */
  assist?(snapshot: PageSnapshot, history: AiStep[]): Promise<{ ok: true; action: AiAction } | { ok: false; error: string }>;
}

/** Fingerprint to tell whether a step changed anything. */
const fingerprint = (s: PageSnapshot) => [s.pageKind, s.urlQuery, s.title, s.placeLinks, s.candidates.map((c) => c.label).join("|")].join("§");

/**
 * The results list cannot be found: ask the AI for one step at a time. Never goes past a
 * challenge, never runs an action that does not validate against the current page.
 */
async function recover(page: MapsPage, hooks: RunHooks): Promise<"recovered" | RunOutcome> {
  const history: AiStep[] = [];
  for (let step = 0; step < AI_LIMITS.stepsPerRecovery; step++) {
    const challenge = page.challenge();
    if (challenge) return { reason: "challenge", kind: challenge };
    const control = hooks.control();
    if (control === "pause") return { reason: "paused" };
    if (control === "stop") return { reason: "stopped" };
    if (page.hasResultsList()) return "recovered";

    const snapshot = page.snapshot();
    const reply = await hooks.assist!(snapshot, history);
    if (!reply.ok) return { reason: "ai_stopped", stopReason: "unknown_layout", note: reply.error };
    const checked = checkAiAction(reply.action, snapshot); // checked again here: the page decides what runs
    if (!checked.ok) return { reason: "ai_stopped", stopReason: "unknown_layout", note: `AI answer rejected: ${checked.error}` };
    const action = checked.action;
    const label = action.action === "click" ? (snapshot.candidates.find((c) => c.i === action.target)?.label ?? null) : null;

    if (action.action === "stop") return { reason: "ai_stopped", stopReason: action.stopReason, note: action.note };
    if (action.action === "search") return { reason: "ai_search" };
    if (action.action !== "done") {
      try {
        await page.perform(action);
      } catch {
        history.push({ action: action.action, label, result: "failed" });
        continue;
      }
    }
    if (page.hasResultsList() || (await page.waitForResults(2_000))) return "recovered";
    history.push({ action: action.action, label, result: fingerprint(page.snapshot()) === fingerprint(snapshot) ? "no_change" : "page_changed" });
  }
  return { reason: "ai_stopped", stopReason: "unknown_layout", note: `Results list still not found after ${AI_LIMITS.stepsPerRecovery} AI steps` };
}

export async function runCollection(page: MapsPage, opts: RunOptions, hooks: RunHooks): Promise<RunOutcome> {
  const processed = new Set(opts.processedKeys);
  const maxEmptyScrolls = opts.maxEmptyScrolls ?? 3;
  let emptyScrolls = 0;
  let openedAny = false;

  for (;;) {
    const challenge = page.challenge();
    if (challenge) return { reason: "challenge", kind: challenge };

    const control = hooks.control();
    if (control === "pause") return { reason: "paused" };
    if (control === "stop") return { reason: "stopped" };

    if (processed.size >= opts.maxRecords) return { reason: "max_reached" };

    if (!page.hasResultsList()) {
      // Before anything was opened the list may simply still be loading: wait, never navigate back
      // (going back from a fresh search page would leave it). After opening a result, go back to the list.
      const listShown = openedAny ? await page.backToResults() : await page.waitForResults(opts.initialWaitMs ?? 15_000);
      if (!listShown) {
        const challenge = page.challenge();
        if (challenge) return { reason: "challenge", kind: challenge };
        if (!hooks.assist) return { reason: "no_results_list" };
        const recovered = await recover(page, hooks);
        if (recovered !== "recovered") return recovered;
      }
    }

    const next = page.cards().find((c) => !processed.has(c.key));
    if (!next) {
      const end = page.listEnd();
      if (end) return { reason: end };
      if (emptyScrolls >= maxEmptyScrolls) return { reason: "no_more_results" };
      const before = page.cards().length;
      await page.scrollResults();
      emptyScrolls = page.cards().length > before ? 0 : emptyScrolls + 1;
      continue;
    }
    emptyScrolls = 0;

    processed.add(next.key);
    await hooks.onProcessed(next.key);
    openedAny = true;
    try {
      const detail = await page.open(next);
      await hooks.onListing(buildListing(next, detail, opts.searchKeyword, opts.fields, opts.location));
    } catch (err) {
      await hooks.onError(next.key, next.name, err instanceof Error ? err.message : String(err));
    }

    await page.backToResults();
    await sleep(opts.delayMs);
  }
}
