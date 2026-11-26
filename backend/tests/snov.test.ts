import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// Snov.io as the second email finder: used when Hunter has no key or no credits left.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const snovCalls: { url: URL; auth: string | null; body: string }[] = [];
let snovBalance = "50.00";
let hunterCalls = 0;

const fakeSnov = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const body = typeof init?.body === "string" ? init.body : "";
  snovCalls.push({ url, auth: new Headers(init?.headers).get("authorization"), body });
  if (url.pathname === "/v1/oauth/access_token") {
    const p = new URLSearchParams(body);
    if (p.get("client_secret") !== "secret-0123456789") return json({ error: "invalid_client", error_description: "Client authentication failed" }, 401);
    return json({ access_token: "tok-abc", token_type: "Bearer", expires_in: 3600 });
  }
  if (url.pathname === "/v1/get-balance") return json({ success: true, data: { balance: snovBalance, teamwork: false, unique_recipients_used: 0, limit_resets_in: 20, expires_in: 300 } });
  if (url.pathname === "/v2/emails-by-domain-by-name/start") return json({ data: { task_hash: "h1" }, meta: { rows: JSON.parse(body).rows } });
  if (url.pathname === "/v2/emails-by-domain-by-name/result") {
    snovBalance = String(Number(snovBalance) - 1);
    return json({ status: "completed", data: [{ people: "Asha Verma", result: [{ email: "Asha.Verma@acme.example.in", smtp_status: "valid" }] }] });
  }
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;

// Hunter with its credits used up.
const fakeHunter = (async () => {
  hunterCalls++;
  return json({ data: { plan_name: "Free", reset_date: "2026-12-20", requests: { credits: { used: 50, available: 50 }, searches: { used: 50, available: 50, credit_cost: 1 }, verifications: { credit_cost: 0.5 } } } });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };

async function customer(name: string) {
  await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${name}@shop.in`, phone: "9876543210", username: name, password: `${name}-password-1` } });
  const id = ((await t.app.inject({ method: "GET", url: `/api/users?q=${name}`, headers: superAuth })).json().items[0] as { id: string }).id;
  await t.app.inject({ method: "POST", url: `/api/users/${id}/approve`, headers: superAuth });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: name, password: `${name}-password-1` } });
  const c = res.cookies.find((x) => x.name === "mlc_session")!;
  return { id, session: { cookie: `${c.name}=${c.value}` } };
}

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 }, { snovFetch: fakeSnov, hunterFetch: fakeHunter });
  superAuth = { authorization: `Bearer ${(await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } })).json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("Snov.io email finder", () => {
  it("checks the credentials, then answers when there is no Hunter key", async () => {
    const a = await customer("sn_a");
    const req = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => t.app.inject({ method, url, headers: a.session, ...(payload !== undefined ? { payload: payload as object } : {}) });

    // Neither set up: the usual "add your Hunter key" answer.
    expect((await req("POST", "/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.example.in" })).json().error.message).toMatch(/Hunter API key/);

    expect((await req("PUT", "/api/enrich/snov/key", { key: { clientId: "client-0123456789", clientSecret: "wrong-0123456789" } })).json().error.message).toMatch(/refused/);
    const saved = await req("PUT", "/api/enrich/snov/key", { key: { clientId: "client-0123456789", clientSecret: "secret-0123456789" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ configured: true, keyHint: "…6789", credits: { left: 50, held: 0, margin: 5 } });
    expect(saved.body).not.toContain("secret-0123456789");

    const found = await req("POST", "/api/enrich/find-email", { fullName: "Asha Verma", domain: "https://www.acme.example.in/about" });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json()).toMatchObject({ provider: "snov", status: "found", result: { email: "asha.verma@acme.example.in", verification: "valid" }, creditsLeft: 49 });
    const start = snovCalls.find((c) => c.url.pathname === "/v2/emails-by-domain-by-name/start")!;
    expect(start.auth).toBe("Bearer tok-abc");
    expect(JSON.parse(start.body)).toEqual({ rows: [{ first_name: "Asha", last_name: "Verma", domain: "acme.example.in" }] });
    expect(hunterCalls).toBe(0);

    // Again: from the ledger.
    const before = snovCalls.length;
    expect((await req("POST", "/api/enrich/find-email", { fullName: "Asha Verma", domain: "acme.example.in" })).json()).toMatchObject({ provider: "snov", status: "cached" });
    expect(snovCalls.length).toBe(before);
    // Hunter's own list is not mixed with Snov's lookups.
    expect((await req("GET", "/api/enrich/status")).json().recent).toEqual([]);
  });

  it("takes over when Hunter's credits are used up, and stops at its own safety margin", async () => {
    const b = await customer("sn_b");
    const req = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => t.app.inject({ method, url, headers: b.session, ...(payload !== undefined ? { payload: payload as object } : {}) });
    expect((await req("PUT", "/api/enrich/hunter-key", { key: "hunterkey0123456789abcdef" })).statusCode).toBe(200);
    snovBalance = "50.00";
    expect((await req("PUT", "/api/enrich/snov/key", { key: { clientId: "client-0123456789", clientSecret: "secret-0123456789" } })).statusCode).toBe(200);
    const res = (await req("POST", "/api/enrich/find-email", { fullName: "Ravi Kumar", domain: "beta.example.in" })).json();
    expect(res).toMatchObject({ provider: "snov", status: "found" });

    // Snov down to its margin (5 of the 50 seen): no more requests.
    snovBalance = "5";
    const before = snovCalls.filter((c) => c.url.pathname.includes("emails-by-domain")).length;
    expect((await req("POST", "/api/enrich/find-email", { fullName: "Meena Rao", domain: "gamma.example.in" })).json().error.code).toBe("NO_CREDITS");
    expect(snovCalls.filter((c) => c.url.pathname.includes("emails-by-domain")).length).toBe(before);
  });
});
