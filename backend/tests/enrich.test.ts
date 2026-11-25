import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDomain, linkedinHandle } from "../src/services/enrich/enrichmentService.js";
import { createTestApp } from "./helpers.js";

// Email finder (Hunter) with the zero-cost rules: balance first, credits held, never over quota.

const KEY = "hunter_test_key_0123456789abcdef";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let used = 0;
let available = 50;
let mode: "ok" | "timeout" | "out" | "badkey" = "ok";
const calls: { path: string; params: URLSearchParams; key: string | null }[] = [];

const fakeHunter = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const path = url.pathname.replace(/^\/v2\//, "");
  const key = new Headers(init?.headers).get("x-api-key");
  calls.push({ path, params: url.searchParams, key });
  if (key !== KEY || mode === "badkey") return json({ errors: [{ id: "authentication_failed", details: "No user found for the API key supplied" }] }, 401);
  if (path === "account") {
    return json({ data: { plan_name: "Free", reset_date: "2026-12-20", requests: { credits: { used, available, remaining: available - used, over_quota: 0 }, searches: { credit_cost: 1 }, verifications: { credit_cost: 0.5 } } } });
  }
  if (mode === "timeout") throw new TypeError("network");
  if (mode === "out") return json({ errors: [{ id: "too_many_requests", details: "You have reached your monthly quota" }] }, 429);
  if (path === "email-finder") {
    const found = url.searchParams.get("full_name") === "Asha Verma";
    if (found) used += 1;
    return json({ data: { email: found ? "Asha.Verma@acme.in" : null, score: found ? 94 : null, position: "HR Manager", verification: { status: "valid" }, sources: [{}, {}] } }, 200, { "X-Credits-Used": found ? "1" : "0" });
  }
  if (path === "email-verifier") {
    used += 0.5;
    return json({ data: { email: url.searchParams.get("email"), status: "valid", score: 98 } });
  }
  if (path === "domain-search") {
    used += 2;
    return json({ data: { emails: [{ value: "info@acme.in", confidence: 90 }, { value: "sales@acme.in", confidence: 80 }] } }, 200, { "X-Credits-Used": "2" });
  }
  return json({ errors: [{ details: "unexpected" }] }, 500);
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
let bearer: string;

const post = (url: string, payload: unknown, headers: Record<string, string> = { authorization: `Bearer ${bearer}` }) => t.app.inject({ method: "POST", url, headers, payload: payload as object });

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 }, { hunterFetch: fakeHunter });
  const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: t.credentials.email, password: t.credentials.password } });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  bearer = (await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } })).json().token;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  used = 0;
  available = 50;
  mode = "ok";
  calls.length = 0;
  await t.db.enrichLookup.deleteMany();
});

describe("helpers", () => {
  it("cleans domains and LinkedIn handles", () => {
    expect(cleanDomain("https://www.Acme.co.in/about")).toBe("acme.co.in");
    expect(cleanDomain("gmail.com")).toBeNull();
    expect(cleanDomain("not a domain")).toBeNull();
    expect(linkedinHandle("https://www.linkedin.com/in/asha-verma-12/")).toBe("asha-verma-12");
  });
});

describe("email finder", () => {
  it("needs a key typed in the admin panel, checks it, and never shows it", async () => {
    expect((await post("/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.in" })).json().error.message).toMatch(/Add your Hunter API key/);
    // Not from an extension token.
    expect((await t.app.inject({ method: "PUT", url: "/api/enrich/hunter-key", headers: { authorization: `Bearer ${bearer}` }, payload: { key: KEY } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "PUT", url: "/api/enrich/hunter-key", headers: { cookie }, payload: { key: "wrong_key_0123456789abcdefgh" } })).json().error.message).toBe("Hunter does not accept this key");
    const saved = await t.app.inject({ method: "PUT", url: "/api/enrich/hunter-key", headers: { cookie }, payload: { key: KEY } });
    expect(saved.json()).toMatchObject({ configured: true, keyHint: "…cdef", planName: "Free", credits: { used: 0, available: 50, left: 50 } });
    expect(saved.body).not.toContain(KEY);
    expect((await t.db.hunterAccount.findFirstOrThrow()).keyEnc).not.toContain(KEY);
  });

  it("finds a work email after checking credits, and answers repeats from the ledger", async () => {
    const res = await post("/api/enrich/find-email", { fullName: "Asha Verma", company: "Acme", linkedinUrl: "https://www.linkedin.com/in/asha-verma/" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: "found", result: { email: "asha.verma@acme.in", score: 94, verification: "valid" }, creditsLeft: 49 });
    expect(calls.map((c) => c.path)).toEqual(["account", "email-finder"]);
    const finder = calls[1]!.params;
    expect([finder.get("full_name"), finder.get("company"), finder.get("linkedin_handle"), finder.get("api_key")]).toEqual(["Asha Verma", "Acme", "asha-verma", null]);
    const row = await t.db.enrichLookup.findFirstOrThrow();
    expect(row).toMatchObject({ status: "done", reservedUnits: 1, usedUnits: 1 });

    calls.length = 0;
    expect((await post("/api/enrich/find-email", { fullName: "asha  verma", company: "acme", linkedinUrl: "https://www.linkedin.com/in/asha-verma/" })).json()).toMatchObject({ status: "cached", result: { email: "asha.verma@acme.in" } });
    expect(calls).toEqual([]);

    // Not found costs nothing.
    const none = await post("/api/enrich/find-email", { fullName: "Nobody Here", domain: "acme.in" });
    expect(none.json()).toMatchObject({ status: "not_found", result: null });
    expect((await t.db.enrichLookup.findFirstOrThrow({ where: { status: "not_found" } })).usedUnits).toBe(0);

    // Verifier and domain search.
    expect((await post("/api/enrich/verify-email", { email: "asha.verma@acme.in" })).json()).toMatchObject({ status: "found", result: { status: "valid" } });
    const domain = await post("/api/enrich/domain-emails", { domain: "https://www.acme.in", limit: 5 });
    expect(domain.json().result.map((e: { email: string }) => e.email)).toEqual(["info@acme.in", "sales@acme.in"]);
    expect(await t.db.enrichLookup.findFirstOrThrow({ where: { kind: "domain_search" } })).toMatchObject({ reservedUnits: 5, usedUnits: 2 });
  });

  it("refuses when credits (minus a 10 % margin and held credits) do not cover the most a request can cost", async () => {
    used = 45; // 5 left, margin 5 → nothing may be spent
    const res = await post("/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.in" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_CREDITS");
    expect(calls.map((c) => c.path)).toEqual(["account"]);
    expect((await t.db.enrichLookup.findFirstOrThrow()).status).toBe("blocked");

    // A timeout keeps its credit held: with 1 credit of room, the next lookup is refused.
    used = 44;
    mode = "timeout";
    expect((await post("/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.in" })).statusCode).toBe(400);
    expect((await t.db.enrichLookup.findFirstOrThrow({ where: { status: "unknown" } })).reservedUnits).toBe(1);
    mode = "ok";
    calls.length = 0;
    expect((await post("/api/enrich/find-email", { fullName: "Ravi Kumar", domain: "acme.in" })).json().error.code).toBe("NO_CREDITS");
    expect(calls.map((c) => c.path)).toEqual(["account"]);
  });

  it("pauses until the reset date when Hunter says the credits are used up, and switches off a rejected key", async () => {
    mode = "out";
    expect((await post("/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.in" })).json().error.code).toBe("NO_CREDITS");
    calls.length = 0;
    mode = "ok";
    expect((await post("/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.in" })).json().error.message).toMatch(/used up until 2026-12-20/);
    expect(calls).toEqual([]);
    await t.db.hunterAccount.updateMany({ data: { exhaustedUntil: null } });

    mode = "badkey";
    expect((await post("/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.in" })).statusCode).toBe(409);
    expect((await t.db.hunterAccount.findFirstOrThrow()).status).toBe("disabled");
    mode = "ok";
    calls.length = 0;
    expect((await post("/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.in" })).json().error.code).toBe("HUNTER_DISABLED");
    expect(calls).toEqual([]);
    const status = (await t.app.inject({ method: "GET", url: "/api/enrich/status", headers: { cookie } })).json();
    expect(status).toMatchObject({ status: "disabled" });
    expect(status.recent.length).toBeGreaterThan(0);
  });
});
