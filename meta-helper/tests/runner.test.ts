import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_RUNNER, Runner, type RunnerDeps, type StoredRunner } from "../src/background/runner";
import type { ContentRequest, NextResponse } from "../src/messages";

const MESSAGE = {
  id: "m1",
  campaignId: "c1",
  campaignName: "HR intro",
  mode: "auto" as const,
  profileUrl: "https://www.linkedin.com/in/priya-sharma",
  contactName: "Priya Sharma",
  body: "Hi Priya",
};

let stored: StoredRunner;
let nextQueue: NextResponse[];
let reports: { id: string; status: string; error: string | null }[];
let sent: { tabId: number; request: ContentRequest }[];
let now: number;
let tabsAlive: Set<number>;
let reportFails: boolean;
let contentAnswers: boolean;

function deps(): RunnerDeps {
  return {
    api: {
      next: async () => ({ ok: true, data: nextQueue.shift() ?? { wait: { reason: "interval", nextCheckAt: "2026-10-26T10:05:00Z" } } }),
      report: async (id, status, error) => {
        if (reportFails) return { ok: false, error: "Backend is not reachable" };
        reports.push({ id, status, error });
        return { ok: true, data: {} };
      },
    },
    tabs: {
      open: async (_url, _active, reuse) => {
        const id = reuse ?? 7;
        tabsAlive.add(id);
        return id;
      },
      waitLoaded: async () => true,
      exists: async (id) => tabsAlive.has(id),
      send: async (tabId, request) => {
        sent.push({ tabId, request });
        return contentAnswers;
      },
    },
    store: {
      load: async () => structuredClone(stored),
      save: async (s) => {
        stored = structuredClone(s);
      },
    },
    now: () => now,
    sleep: async () => {},
  };
}

beforeEach(() => {
  stored = structuredClone(EMPTY_RUNNER);
  nextQueue = [];
  reports = [];
  sent = [];
  now = 1_000_000;
  tabsAlive = new Set();
  reportFails = false;
  contentAnswers = true;
});

describe("Runner", () => {
  it("does nothing until started", async () => {
    nextQueue.push({ message: MESSAGE });
    await new Runner(deps()).tick();
    expect(sent).toEqual([]);
    expect(nextQueue).toHaveLength(1);
  });

  it("opens the profile, hands the message to the page and reports the result", async () => {
    const runner = new Runner(deps());
    nextQueue.push({ message: MESSAGE });
    await runner.start();
    expect(sent).toEqual([{ tabId: 7, request: { type: "LM_SEND", messageId: "m1", job: { body: "Hi Priya", mode: "auto", contactName: "Priya Sharma", profileUrl: "https://www.linkedin.com/in/priya-sharma" } } }]);
    expect(stored.current).toMatchObject({ id: "m1", tabId: 7 });

    // While a message is open, ticks do not fetch another one.
    nextQueue.push({ message: { ...MESSAGE, id: "m2" } });
    await runner.tick();
    expect(nextQueue).toHaveLength(1);

    await runner.onResult("m1", { status: "sent" });
    expect(reports).toEqual([{ id: "m1", status: "sent", error: null }]);
    expect(stored.current).toBeNull();
    expect(stored.log[0]!.text).toBe("Sent to Priya Sharma");

    // A repeated result is ignored.
    await runner.onResult("m1", { status: "failed", reason: "x" });
    expect(reports).toHaveLength(1);
  });

  it("stops on blocked and shows why", async () => {
    const runner = new Runner(deps());
    nextQueue.push({ message: MESSAGE });
    await runner.start();
    await runner.onResult("m1", { status: "blocked", reason: "LinkedIn is showing a security check." });
    expect(stored).toMatchObject({ running: false, lastError: "LinkedIn is showing a security check.", current: null });
    expect(reports[0]).toMatchObject({ status: "blocked" });
  });

  it("records the wait reason from the backend", async () => {
    await new Runner(deps()).start();
    expect(stored.waiting).toEqual({ reason: "interval", nextCheckAt: "2026-10-26T10:05:00Z" });
  });

  it("fails the message when the page never answers, and when it times out", async () => {
    const runner = new Runner(deps());
    contentAnswers = false;
    nextQueue.push({ message: MESSAGE });
    await runner.start();
    expect(sent).toHaveLength(4); // retried
    expect(reports[0]).toMatchObject({ id: "m1", status: "failed" });

    contentAnswers = true;
    nextQueue.push({ message: { ...MESSAGE, id: "m2" } });
    await runner.tick();
    now += 13 * 60_000;
    await runner.tick();
    expect(reports[1]).toMatchObject({ id: "m2", status: "failed", error: expect.stringMatching(/stopped responding/) });
  });

  it("skips when the LinkedIn tab was closed, and keeps results the backend could not take", async () => {
    const runner = new Runner(deps());
    nextQueue.push({ message: MESSAGE });
    await runner.start();
    tabsAlive.clear();
    reportFails = true;
    await runner.tick();
    expect(stored.current).toBeNull();
    expect(stored.pendingReports).toEqual([{ messageId: "m1", status: "skipped", error: "The Instagram tab was closed" }]);

    reportFails = false;
    await runner.tick();
    expect(stored.pendingReports).toEqual([]);
    expect(reports).toEqual([{ id: "m1", status: "skipped", error: "The Instagram tab was closed" }]);
  });

  it("Skip asks the page to stop, or records it when the page is gone", async () => {
    const runner = new Runner(deps());
    nextQueue.push({ message: { ...MESSAGE, mode: "assisted" } });
    await runner.start();
    await runner.skipCurrent();
    expect(sent.at(-1)!.request).toEqual({ type: "LM_ABORT", messageId: "m1" });
    expect(reports).toEqual([]); // the page reports it

    contentAnswers = false;
    await runner.skipCurrent();
    expect(reports).toEqual([{ id: "m1", status: "skipped", error: "Skipped by you" }]);
  });
});
