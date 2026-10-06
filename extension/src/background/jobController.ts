import {
  buildSearchQuery,
  EMPTY_COUNTERS,
  nextStatus,
  startsNewJob,
  validateCollectorSettings,
  type CollectorCommand,
  type CollectorSettings,
} from "@platform/shared";
import type { RunOutcome } from "../content/maps/runner";
import type { ExtractedListing } from "../content/maps/types";
import { MAX_RECENT, withLog, type CollectorState } from "../storage/state";
import type { MapsPageState } from "../utils/maps";
import type { SyncEvent } from "./sync";

// Pure state transitions for the collector (no chrome APIs), so they are unit-testable.

export type CommandResult = { ok: true; state: CollectorState } | { ok: false; error: string };

/** Fresh state for a new run of one search (counters reset; queue/backend ids are set by the caller). */
function newRun(
  state: CollectorState,
  settings: CollectorSettings,
  keyword: string,
  page: MapsPageState,
  now: number,
  tabId: number | null,
): CollectorState {
  const query = buildSearchQuery(keyword, settings.location);
  let s: CollectorState = {
    ...state,
    status: "running",
    jobLabel: query,
    startedAt: now,
    counters: { ...EMPTY_COUNTERS },
    log: [],
    jobSettings: { ...settings, keyword },
    runId: String(now),
    tabId,
    lastHeartbeatAt: now,
    recent: [],
    backendJobId: null,
    aiSearches: 0,
  };
  s = withLog(s, "success", "Google Maps detected", now);
  if (page.isSearch && page.query) {
    s = withLog(s, "success", `Search detected: "${page.query}"`, now);
    if (page.query.toLowerCase() !== query.toLowerCase()) {
      s = withLog(s, "warning", `Maps search differs from job keyword ("${query}")`, now);
    }
  } else {
    s = withLog(s, "warning", 'No search results open. Use "Open search in Maps" first', now);
  }
  return withLog(s, "info", `Job started: "${query}" (max ${settings.maxRecords} records)`, now);
}

/**
 * Applies a START/PAUSE/STOP command from the side panel.
 * For a new job, `keyword` is the search to run now (the first one of a queue).
 */
export function applyCommand(
  state: CollectorState,
  command: CollectorCommand,
  settings: CollectorSettings,
  page: MapsPageState | null,
  now = Date.now(),
  tabId: number | null = null,
  keyword: string = settings.keyword,
): CommandResult {
  const next = nextStatus(state.status, command);
  if (!next) return { ok: false, error: `Cannot ${command} while ${state.status}` };

  if (command === "pause") {
    return { ok: true, state: withLog({ ...state, status: next }, "warning", "Job paused", now) };
  }
  if (command === "stop") {
    return { ok: true, state: withLog({ ...state, status: next }, "warning", "Job stopped", now) };
  }

  // start or resume
  if (!page?.isMaps) return { ok: false, error: "Open Google Maps in the active tab first" };

  if (!startsNewJob(state.status)) {
    return {
      ok: true,
      state: withLog({ ...state, status: next, tabId, lastHeartbeatAt: now }, "info", "Job resumed", now),
    };
  }

  const errors = validateCollectorSettings(settings);
  const firstError = Object.values(errors)[0];
  if (firstError) return { ok: false, error: firstError };

  return { ok: true, state: newRun({ ...state, queue: null }, settings, keyword, page, now, tabId) };
}

/** Starts the next search of the queue (after the previous one finished). */
export function applyStartNext(state: CollectorState, page: MapsPageState | null, now = Date.now(), tabId: number | null = null): CommandResult {
  const q = state.queue;
  if (!q || q.index + 1 >= q.jobs.length) return { ok: false, error: "No more searches in the queue" };
  if (state.status === "running" || state.status === "paused") return { ok: false, error: "Finish or stop the current search first" };
  if (!state.jobSettings) return { ok: false, error: "Queue settings are missing; start a new search" };
  if (!page?.isMaps) return { ok: false, error: "Open Google Maps in the active tab first" };

  const nextJob = q.jobs[q.index + 1]!;
  const s = newRun(state, state.jobSettings, nextJob.keyword, page, now, tabId);
  return {
    ok: true,
    state: withLog(
      { ...s, queue: { ...q, index: q.index + 1 }, backendJobId: nextJob.id },
      "info",
      `Search ${q.index + 2} of ${q.jobs.length}`,
      now,
    ),
  };
}

/** True if an event belongs to the run the state is tracking. */
export function isCurrentRun(state: CollectorState, runId: string): boolean {
  return state.runId === runId && (state.status === "running" || state.status === "paused");
}

export function applyListing(
  state: CollectorState,
  listing: ExtractedListing,
  now = Date.now(),
  localDuplicateOf: { name: string; by: string } | null = null,
): CollectorState {
  const s: CollectorState = {
    ...state,
    counters: { ...state.counters, found: state.counters.found + 1 },
    recent: [listing, ...state.recent].slice(0, MAX_RECENT),
    lastHeartbeatAt: now,
  };
  const extras = [listing.phone && "phone", listing.website && "website"].filter(Boolean).join(", ");
  const logged = withLog(s, "success", `${listing.name}${extras ? ` (${extras})` : ""}`, now);
  return localDuplicateOf
    ? withLog(logged, "info", `↺ Looks like a duplicate of "${localDuplicateOf.name}" (same ${localDuplicateOf.by})`, now)
    : logged;
}

/** A listing that could not be read: counted as found; the error count comes from the backend. */
export function applyItemError(state: CollectorState, name: string, message: string, now = Date.now()): CollectorState {
  const s: CollectorState = {
    ...state,
    counters: { ...state.counters, found: state.counters.found + 1 },
    lastHeartbeatAt: now,
  };
  return withLog(s, "error", `${name}: ${message}`, now);
}

const FINISH_MESSAGES: Record<string, { level: "success" | "warning" | "error"; text: string }> = {
  max_reached: { level: "success", text: "Maximum records reached" },
  end_of_list: { level: "success", text: "Reached the end of the results list" },
  no_more_results: { level: "success", text: "No more results are loading" },
  limited_view: {
    level: "warning",
    text: "Google Maps is showing a limited view (signed out). Sign in to Google Maps to see more results",
  },
};

/** How often AI assist may reopen the search in one run. */
export const MAX_AI_SEARCHES_PER_RUN = 2;

const AI_STOP_TEXT: Record<string, string> = {
  needs_user: "AI assist: the page needs you (sign-in, consent or a security check). Handle it in the Maps tab, then press RESUME",
  not_maps_search: "AI assist: this is not a Maps search page. Open the search in Maps, then press RESUME",
  unknown_layout: "AI assist could not find the results list",
};

/** Applies the content script's final outcome for a run. */
export function applyFinished(state: CollectorState, outcome: RunOutcome, now = Date.now()): CollectorState {
  switch (outcome.reason) {
    case "max_reached":
    case "end_of_list":
    case "no_more_results":
    case "limited_view": {
      const msg = FINISH_MESSAGES[outcome.reason]!;
      const s = withLog({ ...state, status: "completed" }, msg.level, msg.text, now);
      return withLog(s, "success", `Job completed: ${state.counters.found} listings read`, now);
    }
    case "challenge": {
      const kind = outcome.kind === "consent" ? "Google consent page" : "CAPTCHA / security check";
      return withLog(
        { ...state, status: "paused" },
        "error",
        `${kind} detected. Complete it yourself in the Maps tab, then press RESUME`,
        now,
      );
    }
    case "no_results_list":
      return withLog(
        { ...state, status: "paused" },
        "error",
        "Search results list not found. Open the search results in Maps, then press RESUME",
        now,
      );
    case "crashed":
      return withLog({ ...state, status: "paused" }, "error", `Collector error: ${outcome.message}. Press RESUME to retry`, now);
    case "ai_search": {
      const used = state.aiSearches ?? 0;
      if (used >= MAX_AI_SEARCHES_PER_RUN) {
        return withLog({ ...state, status: "paused" }, "error", "AI assist asked to reopen the search again; paused to avoid a loop. Check the Maps tab, then press RESUME", now);
      }
      return withLog({ ...state, aiSearches: used + 1 }, "info", "AI assist: opening the search again", now);
    }
    case "ai_stopped": {
      if (outcome.stopReason === "no_results") {
        const s = withLog({ ...state, status: "completed" }, "warning", `AI assist: Maps found no results for this search${outcome.note ? ` (${outcome.note})` : ""}`, now);
        return withLog(s, "success", `Job completed: ${state.counters.found} listings read`, now);
      }
      const text = AI_STOP_TEXT[outcome.stopReason] ?? AI_STOP_TEXT.unknown_layout!;
      return withLog({ ...state, status: "paused" }, "error", `${text}${outcome.note ? `: ${outcome.note}` : ""}`, now);
    }
    case "paused":
    case "stopped":
      return state; // already applied when the command was given
  }
}

/** Backend status + reason to record for a finished run, or null if nothing changes on the backend. */
export function backendStatusFor(outcome: RunOutcome): { status: "completed" | "paused"; reason: string } | null {
  switch (outcome.reason) {
    case "max_reached":
    case "end_of_list":
    case "no_more_results":
    case "limited_view":
      return { status: "completed", reason: outcome.reason };
    case "challenge":
      return { status: "paused", reason: `${outcome.kind}_detected` };
    case "no_results_list":
      return { status: "paused", reason: "no_results_list" };
    case "crashed":
      return { status: "paused", reason: `collector_error: ${outcome.message}`.slice(0, 500) };
    case "ai_search":
      return null; // the background reopens the search (or pauses the job: see the service worker)
    case "ai_stopped":
      return outcome.stopReason === "no_results"
        ? { status: "completed", reason: "no_results" }
        : { status: "paused", reason: `ai_stopped: ${outcome.stopReason}` };
    case "paused":
    case "stopped":
      return null;
  }
}

/** No heartbeat for this long while running → assume the Maps tab navigated away (e.g. a CAPTCHA page). */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

export function applyWatchdog(state: CollectorState, now = Date.now()): CollectorState | null {
  if (state.status !== "running" || !state.lastHeartbeatAt) return null;
  if (now - state.lastHeartbeatAt < HEARTBEAT_TIMEOUT_MS) return null;
  return withLog(
    { ...state, status: "paused" },
    "error",
    "Lost contact with the Maps tab (page changed, closed, or a security check appeared). Check the tab, then press RESUME",
    now,
  );
}

/** Applies a backend sync result. Counters New/Duplicate/Errors always come from the backend. */
export function applySyncEvent(state: CollectorState, event: SyncEvent, pending: number, now = Date.now()): CollectorState {
  let s: CollectorState = { ...state, sync: { pending, lastError: state.sync.lastError } };
  const fromJob = (job: { id: string; newRecords: number; duplicateRecords: number; errorRecords: number } | null) =>
    job && job.id === s.backendJobId
      ? { ...s, counters: { ...s.counters, new: job.newRecords, duplicate: job.duplicateRecords, errors: job.errorRecords } }
      : s;

  switch (event.type) {
    case "lead":
      s = { ...fromJob(event.job), sync: { pending, lastError: null } };
      return event.result === "duplicate" && !event.replayed && event.jobId === s.backendJobId
        ? withLog(s, "info", `Duplicate not saved again: ${event.name} (matched by ${event.matchedBy})`, now)
        : s;
    case "error_recorded":
      return { ...fromJob(event.job), sync: { pending, lastError: null } };
    case "status":
      return { ...s, sync: { pending, lastError: null } };
    case "dropped": {
      const what = event.item.kind === "lead" ? `"${event.item.lead.name}"` : event.item.kind;
      return withLog(s, "error", `Backend rejected ${what}: ${event.error.message}`, now);
    }
    case "offline": {
      const first = s.sync.lastError === null;
      s = { ...s, sync: { pending, lastError: event.error.message } };
      return first ? withLog(s, "warning", `${event.error.message}. Records are kept and will be sent automatically`, now) : s;
    }
    case "unauthorized": {
      const first = s.sync.lastError === null;
      s = { ...s, sync: { pending, lastError: "Logged out of the backend" } };
      return first ? withLog(s, "error", "Logged out of the backend. Log in again to send the waiting records", now) : s;
    }
  }
}
