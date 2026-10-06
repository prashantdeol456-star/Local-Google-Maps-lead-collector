import { defaultCollectorSettings } from "@platform/shared";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  applyFinished,
  applyItemError,
  applyListing,
  applyStartNext,
  applySyncEvent,
  applyWatchdog,
  backendStatusFor,
  HEARTBEAT_TIMEOUT_MS,
  isCurrentRun,
} from "../src/background/jobController";
import type { ExtractedListing } from "../src/content/maps/types";
import { initialCollectorState, MAX_LOG_ENTRIES, withLog, type CollectorState } from "../src/storage/state";
import { parseMapsPage } from "../src/utils/maps";

const settings = { ...defaultCollectorSettings(), keyword: "University", location: "Lucknow", maxRecords: 500 };
const searchPage = parseMapsPage("https://www.google.com/maps/search/University+in+Lucknow");
const homePage = parseMapsPage("https://www.google.com/maps/@26.8,80.9,12z");
const otherPage = parseMapsPage("https://example.com/");

function ok(result: ReturnType<typeof applyCommand>): CollectorState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("applyCommand", () => {
  it("starts a job on a Maps search page", () => {
    const s = ok(applyCommand(initialCollectorState(), "start", settings, searchPage, 1000));
    expect(s.status).toBe("running");
    expect(s.jobLabel).toBe("University in Lucknow");
    expect(s.startedAt).toBe(1000);
    expect(s.log.map((l) => l.message)).toContain('Search detected: "University in Lucknow"');
  });

  it("refuses to start when the active tab is not Google Maps", () => {
    const r = applyCommand(initialCollectorState(), "start", settings, otherPage);
    expect(r).toEqual({ ok: false, error: "Open Google Maps in the active tab first" });
    expect(applyCommand(initialCollectorState(), "start", settings, null).ok).toBe(false);
  });

  it("refuses to start with invalid settings", () => {
    const r = applyCommand(initialCollectorState(), "start", { ...settings, keyword: "" }, searchPage);
    expect(r.ok).toBe(false);
  });

  it("warns when no search is open or the search differs", () => {
    const home = ok(applyCommand(initialCollectorState(), "start", settings, homePage));
    expect(home.log.some((l) => l.level === "warning" && l.message.includes("No search results open"))).toBe(true);

    const other = parseMapsPage("https://www.google.com/maps/search/College+in+Delhi");
    const diff = ok(applyCommand(initialCollectorState(), "start", settings, other));
    expect(diff.log.some((l) => l.level === "warning" && l.message.includes("differs"))).toBe(true);
  });

  it("pause → resume keeps the job; stop → start begins a new one", () => {
    let s = ok(applyCommand(initialCollectorState(), "start", settings, searchPage, 1000));
    s = { ...s, counters: { found: 10, new: 7, duplicate: 3, errors: 0 } };

    s = ok(applyCommand(s, "pause", settings, searchPage));
    expect(s.status).toBe("paused");

    s = ok(applyCommand(s, "start", settings, searchPage, 2000));
    expect(s.status).toBe("running");
    expect(s.startedAt).toBe(1000);
    expect(s.counters.found).toBe(10);

    s = ok(applyCommand(s, "stop", settings, searchPage));
    expect(s.status).toBe("stopped");

    s = ok(applyCommand(s, "start", settings, searchPage, 3000));
    expect(s.startedAt).toBe(3000);
    expect(s.counters).toEqual({ found: 0, new: 0, duplicate: 0, errors: 0 });
  });

  it("rejects commands that are invalid for the current status", () => {
    expect(applyCommand(initialCollectorState(), "pause", settings, searchPage).ok).toBe(false);
    const running = ok(applyCommand(initialCollectorState(), "start", settings, searchPage));
    expect(applyCommand(running, "start", settings, searchPage).ok).toBe(false);
  });

  it("can pause and stop even if the user left the Maps tab", () => {
    const running = ok(applyCommand(initialCollectorState(), "start", settings, searchPage));
    expect(applyCommand(running, "pause", settings, otherPage).ok).toBe(true);
    expect(applyCommand(running, "stop", settings, null).ok).toBe(true);
  });
});

describe("withLog", () => {
  it("caps the log size and keeps ids increasing", () => {
    let s = initialCollectorState();
    for (let i = 0; i < MAX_LOG_ENTRIES + 25; i++) s = withLog(s, "info", `m${i}`);
    expect(s.log).toHaveLength(MAX_LOG_ENTRIES);
    expect(s.log.at(-1)!.message).toBe(`m${MAX_LOG_ENTRIES + 24}`);
    expect(s.log.at(-1)!.id).toBeGreaterThan(s.log[0].id);
  });
});

const listing = (name: string, extra: Partial<ExtractedListing> = {}): ExtractedListing => ({
  name,
  category: null,
  phone: null,
  email: null,
  website: null,
  address: null,
  city: null,
  state: null,
  country: null,
  postalCode: null,
  latitude: null,
  longitude: null,
  rating: null,
  reviewCount: null,
  mapsUrl: null,
  placeId: null,
  searchKeyword: "University",
  source: "google_maps",
  clientKey: name,
  ...extra,
});

describe("run events", () => {
  const running = () => ok(applyCommand(initialCollectorState(), "start", settings, searchPage, 1000, 7));

  it("a new job gets a run id, tab id and its settings", () => {
    const s = running();
    expect(s).toMatchObject({ runId: "1000", tabId: 7, jobSettings: settings, recent: [] });
    expect(isCurrentRun(s, "1000")).toBe(true);
    expect(isCurrentRun(s, "999")).toBe(false);
  });

  it("resume keeps the run id", () => {
    let s = running();
    s = ok(applyCommand(s, "pause", settings, searchPage));
    s = ok(applyCommand(s, "start", settings, searchPage, 2000, 9));
    expect(s.runId).toBe("1000");
    expect(s.tabId).toBe(9);
  });

  it("events from a stopped run are not current", () => {
    const s = ok(applyCommand(running(), "stop", settings, searchPage));
    expect(isCurrentRun(s, "1000")).toBe(false);
  });

  it("listings increment found and fill the recent list (newest first, capped)", () => {
    let s = running();
    for (let i = 0; i < 25; i++) s = applyListing(s, listing(`P${i}`, i === 24 ? { phone: "0522", website: "https://x" } : {}));
    expect(s.counters.found).toBe(25);
    expect(s.recent).toHaveLength(20);
    expect(s.recent[0]!.name).toBe("P24");
    expect(s.log.at(-1)!.message).toBe("P24 (phone, website)");
  });

  it("item errors count as found; the error total comes from the backend", () => {
    const s = applyItemError(running(), "Bad Place", "Details did not load in time");
    expect(s.counters.found).toBe(1);
    expect(s.counters.errors).toBe(0);
    expect(s.log.at(-1)).toMatchObject({ level: "error", message: "Bad Place: Details did not load in time" });
  });

  it.each(["max_reached", "end_of_list", "no_more_results", "limited_view"] as const)("%s completes the job", (reason) => {
    const s = applyFinished(running(), { reason });
    expect(s.status).toBe("completed");
  });

  it("limited view explains how to see more results", () => {
    const s = applyFinished(running(), { reason: "limited_view" });
    expect(s.log.some((l) => l.message.includes("Sign in to Google Maps"))).toBe(true);
  });

  it("a challenge pauses the job and asks the user to handle it", () => {
    const s = applyFinished(running(), { reason: "challenge", kind: "captcha" });
    expect(s.status).toBe("paused");
    expect(s.log.at(-1)).toMatchObject({ level: "error" });
    expect(s.log.at(-1)!.message).toContain("press RESUME");
  });

  it("missing results list and crashes pause the job", () => {
    expect(applyFinished(running(), { reason: "no_results_list" }).status).toBe("paused");
    expect(applyFinished(running(), { reason: "crashed", message: "boom" }).status).toBe("paused");
  });

  it("paused/stopped outcomes do not change state", () => {
    const s = running();
    expect(applyFinished(s, { reason: "paused" })).toBe(s);
    expect(applyFinished(s, { reason: "stopped" })).toBe(s);
  });

  it("watchdog pauses a silent running job only after the timeout", () => {
    const s = running(); // heartbeat at 1000
    expect(applyWatchdog(s, 1000 + HEARTBEAT_TIMEOUT_MS - 1)).toBeNull();
    const paused = applyWatchdog(s, 1000 + HEARTBEAT_TIMEOUT_MS);
    expect(paused?.status).toBe("paused");
    expect(applyWatchdog({ ...s, status: "paused" }, 10 ** 12)).toBeNull();
  });
});

describe("backend sync", () => {
  const withJob = () => ({ ...ok(applyCommand(initialCollectorState(), "start", settings, searchPage, 1000, 7)), backendJobId: "job1" });
  const jobCounters = { id: "job1", totalFound: 3, newRecords: 2, duplicateRecords: 1, errorRecords: 0 };

  it("takes New/Duplicate/Errors from the backend job and clears the sync error", () => {
    const s0 = { ...withJob(), sync: { pending: 4, lastError: "Backend is not reachable" } };
    const s = applySyncEvent(s0, { type: "lead", jobId: "job1", result: "new", matchedBy: null, replayed: false, name: "A", job: jobCounters }, 3);
    expect(s.counters).toMatchObject({ new: 2, duplicate: 1, errors: 0 });
    expect(s.sync).toEqual({ pending: 3, lastError: null });
  });

  it("ignores counters of another (older) job", () => {
    const s = applySyncEvent(withJob(), { type: "lead", jobId: "old", result: "new", matchedBy: null, replayed: false, name: "A", job: { ...jobCounters, id: "old" } }, 0);
    expect(s.counters.new).toBe(0);
  });

  it("logs real duplicates but not replays", () => {
    const dup = applySyncEvent(withJob(), { type: "lead", jobId: "job1", result: "duplicate", matchedBy: "phone", replayed: false, name: "B", job: jobCounters }, 0);
    expect(dup.log.at(-1)!.message).toContain("Duplicate not saved again: B");
    const replay = applySyncEvent(withJob(), { type: "lead", jobId: "job1", result: "duplicate", matchedBy: "phone", replayed: true, name: "B", job: jobCounters }, 0);
    expect(replay.log.at(-1)!.message).not.toContain("Duplicate");
  });

  it("warns once while offline and reports rejected items", () => {
    const err = { kind: "unreachable" as const, message: "Backend is not reachable" };
    let s = applySyncEvent(withJob(), { type: "offline", error: err }, 5);
    s = applySyncEvent(s, { type: "offline", error: err }, 5);
    expect(s.log.filter((l) => l.message.includes("will be sent automatically"))).toHaveLength(1);
    expect(s.sync).toEqual({ pending: 5, lastError: "Backend is not reachable" });

    const dropped = applySyncEvent(withJob(), {
      type: "dropped",
      item: { id: 1, attempts: 0, nextAttemptAt: 0, createdAt: 0, kind: "lead", jobId: "job1", clientKey: "k", lead: { ...listing("Bad"), clientKey: undefined } as never },
      error: { kind: "http", status: 400, message: "lead.rating: Too big" },
    }, 0);
    expect(dropped.log.at(-1)).toMatchObject({ level: "error" });
  });

  it("maps run outcomes to backend statuses", () => {
    expect(backendStatusFor({ reason: "end_of_list" })).toEqual({ status: "completed", reason: "end_of_list" });
    expect(backendStatusFor({ reason: "challenge", kind: "captcha" })).toEqual({ status: "paused", reason: "captcha_detected" });
    expect(backendStatusFor({ reason: "paused" })).toBeNull();
    expect(backendStatusFor({ reason: "stopped" })).toBeNull();
  });
});

describe("search queue", () => {
  const queued = () => {
    const s = ok(applyCommand(initialCollectorState(), "start", { ...settings, keyword: "University, College" }, searchPage, 1000, 7, "University"));
    return {
      ...s,
      backendJobId: "j0",
      queue: { queueId: "q", jobs: [{ id: "j0", keyword: "University" }, { id: "j1", keyword: "College" }], index: 0 },
    };
  };

  it("a queued job runs the given keyword, keeping the full keyword list in settings", () => {
    const s = queued();
    expect(s.jobLabel).toBe("University in Lucknow");
    expect(s.jobSettings!.keyword).toBe("University");
  });

  it("start next moves to the next search with a fresh run and its backend job", () => {
    const done = applyFinished(queued(), { reason: "end_of_list" }, 2000);
    const collegePage = parseMapsPage("https://www.google.com/maps/search/College+in+Lucknow");
    const next = ok(applyStartNext(done, collegePage, 3000, 7));
    expect(next).toMatchObject({
      status: "running",
      jobLabel: "College in Lucknow",
      runId: "3000",
      backendJobId: "j1",
      queue: { index: 1 },
      counters: { found: 0, new: 0, duplicate: 0, errors: 0 },
    });
    expect(next.log.at(-1)!.message).toBe("Search 2 of 2");
  });

  it("refuses to start next while running or when the queue is finished", () => {
    expect(applyStartNext(queued(), searchPage).ok).toBe(false); // still running
    const last = { ...applyFinished(queued(), { reason: "end_of_list" }), queue: { queueId: "q", jobs: [{ id: "j0", keyword: "U" }], index: 0 } };
    expect(applyStartNext(last, searchPage)).toEqual({ ok: false, error: "No more searches in the queue" });
  });

  it("a fresh START drops the old queue", () => {
    const done = applyFinished(queued(), { reason: "end_of_list" });
    expect(ok(applyCommand(done, "start", settings, searchPage, 5000, 7)).queue).toBeNull();
  });
});

describe("AI assist outcomes", () => {
  const running = () => ok(applyCommand(initialCollectorState(), "start", { ...settings, aiAssist: true }, searchPage, 1000, 7));
  const lastLog = (s: CollectorState) => s.log[s.log.length - 1]!.message;

  it("reopening the search keeps the job running, at most twice per run", () => {
    let s = running();
    expect(s.aiSearches).toBe(0);
    s = applyFinished(s, { reason: "ai_search" });
    s = applyFinished(s, { reason: "ai_search" });
    expect(s).toMatchObject({ status: "running", aiSearches: 2 });
    s = applyFinished(s, { reason: "ai_search" });
    expect(s.status).toBe("paused");
    expect(lastLog(s)).toContain("avoid a loop");
    expect(backendStatusFor({ reason: "ai_search" })).toBeNull();
  });

  it("an AI stop completes the job only for 'no results'; otherwise it pauses with the reason", () => {
    const done = applyFinished(running(), { reason: "ai_stopped", stopReason: "no_results", note: "Maps found nothing" });
    expect(done.status).toBe("completed");
    expect(backendStatusFor({ reason: "ai_stopped", stopReason: "no_results", note: "" })).toEqual({ status: "completed", reason: "no_results" });

    const needsUser = applyFinished(running(), { reason: "ai_stopped", stopReason: "needs_user", note: "Sign-in page" });
    expect(needsUser.status).toBe("paused");
    expect(lastLog(needsUser)).toContain("the page needs you");
    expect(backendStatusFor({ reason: "ai_stopped", stopReason: "needs_user", note: "" })).toEqual({ status: "paused", reason: "ai_stopped: needs_user" });

    const unknown = applyFinished(running(), { reason: "ai_stopped", stopReason: "unknown_layout", note: "Results list still not found after 6 AI steps" });
    expect(lastLog(unknown)).toBe("AI assist could not find the results list: Results list still not found after 6 AI steps");
  });
});
