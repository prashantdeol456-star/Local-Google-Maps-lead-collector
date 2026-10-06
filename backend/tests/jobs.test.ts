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

async function createJob(payload: Record<string, unknown> = { searchKeyword: "University", location: "Lucknow", maxRecords: 500 }) {
  const res = await t.app.inject({ method: "POST", url: "/api/jobs", headers: auth, payload });
  return res;
}

async function patch(id: string, payload: Record<string, unknown>) {
  return t.app.inject({ method: "PATCH", url: `/api/jobs/${id}`, headers: auth, payload });
}

describe("jobs API", () => {
  it("requires login", async () => {
    for (const [method, url] of [
      ["GET", "/api/jobs"],
      ["POST", "/api/jobs"],
      ["GET", "/api/jobs/x"],
      ["PATCH", "/api/jobs/x"],
      ["GET", "/api/jobs/x/logs"],
    ] as const) {
      expect((await t.app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("creates a pending job owned by the admin, with a log entry", async () => {
    const res = await createJob({ searchKeyword: "  University ", location: " Lucknow ", maxRecords: 500 });
    expect(res.statusCode).toBe(201);
    const { job } = res.json();
    expect(job).toMatchObject({
      searchKeyword: "University",
      location: "Lucknow",
      maxRecords: 500,
      status: "pending",
      totalFound: 0,
      newRecords: 0,
      startedAt: null,
    });
    const admin = await t.db.adminUser.findFirstOrThrow();
    expect(job.createdById).toBe(admin.id);

    const logs = await t.app.inject({ method: "GET", url: `/api/jobs/${job.id}/logs`, headers: auth });
    expect(logs.json().items.map((l: { action: string }) => l.action)).toEqual(["job_created"]);
  });

  it("validates input", async () => {
    for (const payload of [
      {},
      { searchKeyword: "   " },
      { searchKeyword: "x".repeat(101) },
      { searchKeyword: "University", maxRecords: 0 },
      { searchKeyword: "University", maxRecords: 5001 },
      { searchKeyword: "University", maxRecords: 2.5 },
    ]) {
      const res = await createJob(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error.code).toBe("BAD_REQUEST");
    }
    expect((await createJob({ searchKeyword: "College" })).statusCode).toBe(201);
  });

  it("runs the full lifecycle and records timestamps + logs", async () => {
    const { job } = (await createJob()).json();

    const run = await patch(job.id, { status: "running" });
    expect(run.statusCode).toBe(200);
    const startedAt = run.json().job.startedAt;
    expect(startedAt).not.toBeNull();

    expect((await patch(job.id, { status: "paused", statusReason: "captcha_detected" })).json().job).toMatchObject({
      status: "paused",
      statusReason: "captcha_detected",
    });

    const resumed = (await patch(job.id, { status: "running" })).json().job;
    expect(resumed.startedAt).toBe(startedAt); // not reset on resume
    expect(resumed.statusReason).toBeNull();

    const done = (await patch(job.id, { status: "completed" })).json().job;
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();

    const logs = (await t.app.inject({ method: "GET", url: `/api/jobs/${job.id}/logs`, headers: auth })).json().items;
    expect(logs.map((l: { action: string }) => l.action).reverse()).toEqual([
      "job_created",
      "search_started",
      "job_paused",
      "job_resumed",
      "job_completed",
    ]);
    expect(logs.find((l: { action: string }) => l.action === "job_paused").message).toBe("captcha_detected");
  });

  it("rejects invalid transitions with 409", async () => {
    const { job } = (await createJob()).json();
    const res = await patch(job.id, { status: "completed" }); // pending → completed
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_TRANSITION");

    await patch(job.id, { status: "stopped" });
    expect((await patch(job.id, { status: "running" })).statusCode).toBe(409); // final state
  });

  it("does not accept pending or unknown statuses", async () => {
    const { job } = (await createJob()).json();
    expect((await patch(job.id, { status: "pending" })).statusCode).toBe(400);
    expect((await patch(job.id, { status: "deleted" })).statusCode).toBe(400);
  });

  it("is idempotent when the status is unchanged", async () => {
    const { job } = (await createJob()).json();
    await patch(job.id, { status: "stopped" });
    const again = await patch(job.id, { status: "stopped" });
    expect(again.statusCode).toBe(200);
    const logs = (await t.app.inject({ method: "GET", url: `/api/jobs/${job.id}/logs`, headers: auth })).json().items;
    expect(logs.filter((l: { action: string }) => l.action === "job_stopped")).toHaveLength(1);
  });

  it("allows only one running job at a time", async () => {
    const a = (await createJob({ searchKeyword: "A" })).json().job;
    const b = (await createJob({ searchKeyword: "B" })).json().job;
    expect((await patch(a.id, { status: "running" })).statusCode).toBe(200);

    const res = await patch(b.id, { status: "running" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("JOB_ALREADY_RUNNING");

    await patch(a.id, { status: "paused" });
    expect((await patch(b.id, { status: "running" })).statusCode).toBe(200);
    await patch(b.id, { status: "stopped" });
    await patch(a.id, { status: "stopped" });
  });

  it("returns 404 for unknown jobs", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/jobs/nope", headers: auth })).statusCode).toBe(404);
    expect((await patch("nope", { status: "running" })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: "/api/jobs/nope/logs", headers: auth })).statusCode).toBe(404);
  });

  it("lists newest first, filters by status, paginates", async () => {
    const all = (await t.app.inject({ method: "GET", url: "/api/jobs?pageSize=100", headers: auth })).json();
    expect(all.total).toBeGreaterThan(3);
    const created = all.items.map((j: { createdAt: string }) => j.createdAt);
    expect([...created].sort().reverse()).toEqual(created);

    const completed = (await t.app.inject({ method: "GET", url: "/api/jobs?status=completed", headers: auth })).json();
    expect(completed.items.every((j: { status: string }) => j.status === "completed")).toBe(true);

    const page2 = (await t.app.inject({ method: "GET", url: "/api/jobs?page=2&pageSize=2", headers: auth })).json();
    expect(page2).toMatchObject({ page: 2, pageSize: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].id).toBe(all.items[2].id);

    for (const qs of ["page=0", "pageSize=101", "status=bogus"]) {
      expect((await t.app.inject({ method: "GET", url: `/api/jobs?${qs}`, headers: auth })).statusCode, qs).toBe(400);
    }
  });
});
