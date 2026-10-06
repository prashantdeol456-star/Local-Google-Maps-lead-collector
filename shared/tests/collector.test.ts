import { describe, expect, it } from "vitest";
import {
  buildSearchQuery,
  canTransitionJob,
  defaultCollectorSettings,
  isFinalJobStatus,
  JOB_STATUSES,
  nextStatus,
  parseKeywords,
  startsNewJob,
  validateCollectorSettings,
  type CollectorCommand,
  type CollectorStatus,
  type JobStatus,
} from "../src/index.js";

describe("canTransitionJob", () => {
  const allowed: [JobStatus, JobStatus][] = [
    ["pending", "running"],
    ["pending", "stopped"],
    ["running", "paused"],
    ["running", "completed"],
    ["running", "stopped"],
    ["running", "failed"],
    ["paused", "running"],
    ["paused", "stopped"],
  ];
  it.each(allowed)("%s → %s is allowed", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(true);
  });

  const denied: [JobStatus, JobStatus][] = [
    ["pending", "paused"],
    ["pending", "completed"],
    ["paused", "completed"],
    ["running", "running"],
    ["running", "pending"],
    ["completed", "running"],
    ["stopped", "running"],
    ["failed", "running"],
  ];
  it.each(denied)("%s → %s is rejected", (from, to) => {
    expect(canTransitionJob(from, to)).toBe(false);
  });

  it("only completed/failed/stopped are final", () => {
    expect(JOB_STATUSES.filter(isFinalJobStatus)).toEqual(["completed", "failed", "stopped"]);
  });
});

describe("nextStatus", () => {
  const cases: [CollectorStatus, CollectorCommand, CollectorStatus | null][] = [
    ["idle", "start", "running"],
    ["running", "start", null],
    ["running", "pause", "paused"],
    ["paused", "start", "running"],
    ["paused", "pause", null],
    ["running", "stop", "stopped"],
    ["paused", "stop", "stopped"],
    ["stopped", "stop", null],
    ["stopped", "start", "running"],
    ["completed", "start", "running"],
    ["failed", "start", "running"],
    ["idle", "pause", null],
    ["idle", "stop", null],
  ];
  it.each(cases)("%s + %s → %s", (from, cmd, to) => {
    expect(nextStatus(from, cmd)).toBe(to);
  });

  it("resuming a paused job keeps it; finished states start a new job", () => {
    expect(startsNewJob("paused")).toBe(false);
    expect(startsNewJob("stopped")).toBe(true);
    expect(startsNewJob("idle")).toBe(true);
  });
});

describe("validateCollectorSettings", () => {
  const valid = { ...defaultCollectorSettings(), keyword: "University", location: "Lucknow" };

  it("accepts valid settings", () => {
    expect(validateCollectorSettings(valid)).toEqual({});
  });

  it("requires a keyword", () => {
    expect(validateCollectorSettings({ ...valid, keyword: "   " }).keyword).toBeDefined();
  });

  it.each([0, -5, 1.5, 5001, Number.NaN])("rejects maxRecords=%s", (n) => {
    expect(validateCollectorSettings({ ...valid, maxRecords: n }).maxRecords).toBeDefined();
  });

  it("allows an empty location", () => {
    expect(validateCollectorSettings({ ...valid, location: "" })).toEqual({});
  });

  it("name cannot be turned off", () => {
    expect(validateCollectorSettings({ ...valid, fields: { ...valid.fields, name: false } }).fields).toBeDefined();
  });
});

describe("parseKeywords", () => {
  it("splits on commas, semicolons and new lines; trims; drops duplicates", () => {
    expect(parseKeywords(" University, College\nEngineering  College;college ,, ")).toEqual([
      "University",
      "College",
      "Engineering College",
    ]);
    expect(parseKeywords("   ")).toEqual([]);
  });

  it("validation covers queues", () => {
    const base = defaultCollectorSettings();
    expect(validateCollectorSettings({ ...base, keyword: "University, College" })).toEqual({});
    expect(validateCollectorSettings({ ...base, keyword: " , ; " }).keyword).toBeDefined();
    expect(validateCollectorSettings({ ...base, keyword: `ok, ${"x".repeat(101)}` }).keyword).toContain("too long");
    const many = Array.from({ length: 21 }, (_, i) => `k${i}`).join(",");
    expect(validateCollectorSettings({ ...base, keyword: many }).keyword).toContain("At most 20");
  });
});

describe("buildSearchQuery", () => {
  it("joins keyword and location", () => {
    expect(buildSearchQuery("  University ", " Lucknow")).toBe("University in Lucknow");
  });
  it("collapses whitespace and omits empty location", () => {
    expect(buildSearchQuery("Engineering   College", "")).toBe("Engineering College");
  });
});
