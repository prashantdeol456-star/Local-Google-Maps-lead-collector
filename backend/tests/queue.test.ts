import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };

beforeAll(async () => {
  t = await createTestApp();
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/token",
    payload: { email: t.credentials.email, password: t.credentials.password },
  });
  auth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});

const inject = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

describe("search queue", () => {
  it("creates one pending job per keyword, in order, sharing a queue id", async () => {
    const res = await inject("POST", "/api/jobs/queue", {
      keywords: ["University", "College", "Engineering College"],
      location: "Lucknow",
      maxRecords: 200,
    });
    expect(res.statusCode).toBe(201);
    const { queueId, jobs } = res.json();
    expect(jobs.map((j: { searchKeyword: string; position: number; status: string; queueId: string }) => [j.searchKeyword, j.position, j.status, j.queueId])).toEqual([
      ["University", 0, "pending", queueId],
      ["College", 1, "pending", queueId],
      ["Engineering College", 2, "pending", queueId],
    ]);

    const listed = (await inject("GET", `/api/jobs?queueId=${queueId}`)).json();
    expect(listed.items.map((j: { searchKeyword: string }) => j.searchKeyword)).toEqual(["University", "College", "Engineering College"]);
    expect(listed.total).toBe(3);
  });

  it("does not start anything by itself", async () => {
    const { jobs } = (await inject("POST", "/api/jobs/queue", { keywords: ["A", "B"] })).json();
    expect(jobs.every((j: { status: string }) => j.status === "pending")).toBe(true);
  });

  it("validates keywords", async () => {
    for (const body of [
      { keywords: [] },
      { keywords: ["  "] },
      { keywords: ["a", "A"] },
      { keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) },
      { keywords: ["x".repeat(101)] },
      { keywords: "University" },
    ]) {
      expect((await inject("POST", "/api/jobs/queue", body)).statusCode, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });
});

describe("extraction errors", () => {
  it("counts an error once per clientKey and logs it", async () => {
    const job = (await inject("POST", "/api/jobs", { searchKeyword: "University" })).json().job;
    const body = { clientKey: "0xabc:0xdef", name: "Some Place", message: "Details did not load in time" };

    const a = await inject("POST", `/api/jobs/${job.id}/items/error`, body);
    const b = await inject("POST", `/api/jobs/${job.id}/items/error`, body); // retry
    expect(a.statusCode).toBe(200);
    expect(b.json().job).toMatchObject({ totalFound: 1, errorRecords: 1, newRecords: 0 });

    const logs = (await inject("GET", `/api/jobs/${job.id}/logs`)).json().items;
    expect(logs.filter((l: { action: string }) => l.action === "extraction_error")).toHaveLength(1);
    expect(await t.db.jobItem.count({ where: { jobId: job.id, result: "error" } })).toBe(1);
  });

  it("404 for unknown job, 400 for bad body", async () => {
    expect((await inject("POST", "/api/jobs/nope/items/error", { clientKey: "k", name: "n", message: "m" })).statusCode).toBe(404);
    const job = (await inject("POST", "/api/jobs", { searchKeyword: "x" })).json().job;
    expect((await inject("POST", `/api/jobs/${job.id}/items/error`, { clientKey: "k" })).statusCode).toBe(400);
  });
});

describe("lead logs", () => {
  it("logs lead_saved and duplicate_found for job submissions (not for replays)", async () => {
    const job = (await inject("POST", "/api/jobs", { searchKeyword: "University" })).json().job;
    const lead = { name: "Log Test University", placeId: "ChIJlogtest" };
    await inject("POST", "/api/leads", { jobId: job.id, clientKey: "a", lead });
    await inject("POST", "/api/leads", { jobId: job.id, clientKey: "a", lead }); // replay
    await inject("POST", "/api/leads", { jobId: job.id, clientKey: "b", lead });

    const actions = (await inject("GET", `/api/jobs/${job.id}/logs`)).json().items.map((l: { action: string }) => l.action);
    expect(actions.filter((a: string) => a === "lead_saved")).toHaveLength(1);
    expect(actions.filter((a: string) => a === "duplicate_found")).toHaveLength(1);
  });
});
