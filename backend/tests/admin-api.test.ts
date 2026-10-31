import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppEvent } from "../src/services/events.js";
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
beforeEach(async () => {
  await t.db.jobItem.deleteMany();
  await t.db.lead.deleteMany();
});

const inject = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: auth, ...(payload !== undefined ? { payload } : {}) });

async function saveLead(lead: Record<string, unknown>) {
  return (await inject("POST", "/api/leads", { lead })).json().lead as { id: string };
}

describe("PATCH /api/leads/:id", () => {
  it("edits fields, clears with null, and recomputes duplicate lookup columns", async () => {
    const { id } = await saveLead({ name: "City College", phone: "0522 400 0000", city: "Lucknow", category: "College" });

    const res = await inject("PATCH", `/api/leads/${id}`, { name: "  City  Degree College ", phone: "+91 98390 00000", category: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().lead).toMatchObject({ name: "City Degree College", phone: "+91 98390 00000", category: null, city: "Lucknow" });

    const row = await t.db.lead.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ normalizedName: "city degree college", normalizedPhone: "+919839000000" });

    // A later collection with the edited phone is recognised as this lead.
    const again = await inject("POST", "/api/leads", { lead: { name: "CDC", phone: "9839000000" } });
    expect(again.json()).toMatchObject({ result: "duplicate", matchedBy: "phone", lead: { id } });
  });

  it("rejects unknown/internal fields, empty names and bad emails", async () => {
    const { id } = await saveLead({ name: "X College" });
    for (const body of [{ dedupeKey: "x" }, { normalizedPhone: "+91" }, { placeId: "ChIJ" }, { name: "" }, { name: "!!!" }, { email: "nope" }]) {
      expect((await inject("PATCH", `/api/leads/${id}`, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await inject("PATCH", `/api/leads/${id}`, { email: "Info@Example.COM" })).json().lead.email).toBe("info@example.com");
  });

  it("404 for unknown lead; empty patch returns the lead unchanged", async () => {
    expect((await inject("PATCH", "/api/leads/nope", { city: "x" })).statusCode).toBe(404);
    const { id } = await saveLead({ name: "Y College", city: "Agra" });
    expect((await inject("PATCH", `/api/leads/${id}`, {})).json().lead.city).toBe("Agra");
  });
});

describe("GET /api/leads/facets", () => {
  it("returns distinct values with counts, most common first, without nulls", async () => {
    await saveLead({ name: "A", city: "Lucknow", category: "University", searchKeyword: "University" });
    await saveLead({ name: "B", city: "Lucknow", category: "College", searchKeyword: "College" });
    await saveLead({ name: "C", city: "Agra", category: "College", searchKeyword: "College" });
    await saveLead({ name: "D" });

    const res = await inject("GET", "/api/leads/facets");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      cities: [{ value: "Lucknow", count: 2 }, { value: "Agra", count: 1 }],
      states: [],
      categories: [{ value: "College", count: 2 }, { value: "University", count: 1 }],
      keywords: [{ value: "College", count: 2 }, { value: "University", count: 1 }],
    });
  });

  it("requires login", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/leads/facets" })).statusCode).toBe(401);
  });
});

describe("live events", () => {
  it("services publish lead and job events after saving", async () => {
    const events: AppEvent[] = [];
    const off = t.app.events.subscribe((e) => events.push(e));
    try {
      const job = (await inject("POST", "/api/jobs", { searchKeyword: "University" })).json().job;
      await inject("PATCH", `/api/jobs/${job.id}`, { status: "running" });
      const saved = (await inject("POST", "/api/leads", { jobId: job.id, clientKey: "k", lead: { name: "Event U", placeId: "ChIJev" } })).json();
      await inject("POST", "/api/leads", { jobId: job.id, clientKey: "k", lead: { name: "Event U", placeId: "ChIJev" } }); // replay: no event
      await inject("PATCH", `/api/leads/${saved.lead.id}`, { city: "Lucknow" });
      await inject("DELETE", `/api/leads/${saved.lead.id}`);

      expect(events.map((e) => e.type)).toEqual([
        "job.updated", // created
        "job.updated", // running
        "lead.saved",
        "job.updated", // counters
        "lead.updated",
        "lead.deleted",
      ]);
      const admin = await t.db.adminUser.findFirstOrThrow();
      expect(events[2]).toEqual({ type: "lead.saved", leadId: saved.lead.id, result: "new", jobId: job.id, ownerId: admin.id });
    } finally {
      off();
    }
  });

  it("streams events over SSE to a logged-in client, and refuses anonymous clients", async () => {
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;

    expect((await fetch(`${base}/api/events`)).status).toBe(401);
    const others = t.app.events.listenerCount(); // in-process listeners (integrations)

    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { headers: auth, signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil("event: ready");
    expect(t.app.events.listenerCount()).toBe(others + 1);

    await inject("POST", "/api/leads", { lead: { name: "Streamed University", placeId: "ChIJstream" } });
    await readUntil("event: lead.saved");
    expect(text).toMatch(/event: lead\.saved\ndata: \{"type":"lead\.saved","leadId":"[^"]+","result":"new","jobId":null,"ownerId":"[^"]+"\}/);

    controller.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect(t.app.events.listenerCount()).toBe(others); // unsubscribed on disconnect
  });
});

describe("admin static files", () => {
  it("explains how to build when the admin panel is missing", async () => {
    const res = await t.app.inject({ method: "GET", url: "/admin" });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("npm run build:admin");
    expect((await t.app.inject({ method: "GET", url: "/" })).headers.location).toBe("/admin/");
  });

  it("serves the built panel with SPA fallback and security headers", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mlc-admin-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Admin</title>");
    writeFileSync(path.join(dir, "assets", "app.js"), "console.log(1)");
    const t2 = await createTestApp({ adminDir: dir });
    try {
      const index = await t2.app.inject({ method: "GET", url: "/admin/" });
      expect(index.statusCode).toBe(200);
      expect(index.body).toContain("<title>Admin</title>");
      expect(index.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(index.headers["x-frame-options"]).toBe("DENY");

      const deep = await t2.app.inject({ method: "GET", url: "/admin/leads/abc123" });
      expect(deep.statusCode).toBe(200);
      expect(deep.body).toContain("<title>Admin</title>");

      const asset = await t2.app.inject({ method: "GET", url: "/admin/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toBe("console.log(1)");
      expect(asset.headers["x-content-type-options"]).toBe("nosniff");

      // The admin page itself is public; its data is not.
      expect((await t2.app.inject({ method: "GET", url: "/api/leads" })).statusCode).toBe(401);
    } finally {
      await t2.close();
    }
  });
});
