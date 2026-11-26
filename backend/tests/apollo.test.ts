import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// Apollo people search (free) and work emails (1 Apollo credit each, within the user's credits).

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const calls: { url: URL; key: string | null }[] = [];
let credits = { limit: 100, consumed: 10, left_over: 90 };

const fakeApollo = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const key = new Headers(init?.headers).get("x-api-key");
  calls.push({ url, key });
  if (key === "BADKEY0000000000000000") return json({ error: "Invalid access credentials." }, 401);
  if (key === "NOSTATS000000000000000") return json({ error: "This endpoint is not accessible with this API key" }, 403);
  if (url.pathname.endsWith("/usage_stats/credit_usage_stats")) {
    return json({ credit_usage_stats: { lead_credit: credits, direct_dial_credit: { limit: 0, consumed: 0, left_over: 0 } }, current_credit_cycle: { start_date: "2026-11-01T00:00:00Z", end_date: "2026-12-01T00:00:00Z" } });
  }
  if (url.pathname.endsWith("/mixed_people/api_search")) {
    return json({
      total_entries: 2,
      people: [
        { id: "p1aaaaaaaa", first_name: "Asha", last_name_obfuscated: "Ve***a", title: "HR Manager", has_email: true, has_city: true, organization: { name: "Acme Infotech", primary_domain: "acme.example.in" } },
        { id: "p2bbbbbbbb", first_name: "Rohit", last_name_obfuscated: "Ma***a", title: "HR Head", has_email: false, organization: { name: "Beta Soft" } },
      ],
    });
  }
  if (url.pathname.endsWith("/people/match")) {
    const id = url.searchParams.get("id");
    if (id === "p1aaaaaaaa") {
      credits = { ...credits, consumed: credits.consumed + 1, left_over: credits.left_over - 1 };
      return json({ person: { id, name: "Asha Verma", first_name: "Asha", last_name: "Verma", title: "HR Manager", email: "Asha.Verma@acme.example.in", email_status: "verified", linkedin_url: "http://www.linkedin.com/in/asha-verma", city: "Noida", country: "India", match_confidence: "high", organization: { name: "Acme Infotech", primary_domain: "acme.example.in" } } });
    }
    return json({ person: null });
  }
  return json({ error: "unexpected" }, 500);
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
  t = await createTestApp({ loginRateLimitPerMinute: 1000 }, { apolloFetch: fakeApollo });
  superAuth = { authorization: `Bearer ${(await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } })).json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("Apollo people search", () => {
  it("checks the key, searches for free and reveals emails within the credits", async () => {
    const a = await customer("ap_a");
    const req = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => t.app.inject({ method, url, headers: a.session, ...(payload !== undefined ? { payload: payload as object } : {}) });

    expect((await req("POST", "/api/enrich/apollo/search", { titles: ["HR"] })).statusCode).toBe(400);
    expect((await req("PUT", "/api/enrich/apollo/key", { key: "BADKEY0000000000000000" })).json().error.message).toMatch(/does not accept/);
    expect((await req("PUT", "/api/enrich/apollo/key", { key: "NOSTATS000000000000000" })).json().error.message).toMatch(/Credit Usage/);
    const saved = await req("PUT", "/api/enrich/apollo/key", { key: "GOODKEY123456789abcd" });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ configured: true, keyHint: "…abcd", credits: { limit: 100, used: 10, left: 90, held: 0 } });
    expect(saved.body).not.toContain("GOODKEY");

    expect((await req("POST", "/api/enrich/apollo/search", {})).statusCode).toBe(400);
    const found = await req("POST", "/api/enrich/apollo/search", { titles: ["HR Manager"], seniorities: ["manager"], organizationLocations: ["Noida, India"], page: 1 });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json()).toMatchObject({ total: 2, page: 1, people: [{ id: "p1aaaaaaaa", firstName: "Asha", lastName: "Ve***a", company: "Acme Infotech", domain: "acme.example.in", hasEmail: true, revealed: null }, { id: "p2bbbbbbbb" }] });
    const search = calls.find((c) => c.url.pathname.endsWith("/mixed_people/api_search"))!;
    expect(search.key).toBe("GOODKEY123456789abcd");
    expect(search.url.searchParams.getAll("person_titles[]")).toEqual(["HR Manager"]);
    expect(search.url.searchParams.getAll("organization_locations[]")).toEqual(["Noida, India"]);
    expect(search.url.searchParams.get("per_page")).toBe("25");

    const revealed = await req("POST", "/api/enrich/apollo/reveal", { ids: ["p1aaaaaaaa", "p2bbbbbbbb"] });
    expect(revealed.json()).toMatchObject({
      items: [
        { id: "p1aaaaaaaa", status: "found", person: { name: "Asha Verma", email: "asha.verma@acme.example.in", emailStatus: "verified" } },
        { id: "p2bbbbbbbb", status: "not_found", person: null },
      ],
      creditsLeft: 89,
    });
    const match = calls.find((c) => c.url.pathname.endsWith("/people/match"))!;
    expect(match.url.searchParams.get("reveal_phone_number")).toBe("false");
    expect(match.url.searchParams.get("reveal_personal_emails")).toBe("false");

    // Again: from the ledger, no new request and no credit.
    const before = calls.length;
    expect((await req("POST", "/api/enrich/apollo/reveal", { ids: ["p1aaaaaaaa"] })).json().items[0]).toMatchObject({ status: "cached", person: { name: "Asha Verma" } });
    expect(calls.length).toBe(before);
    // The search shows who was revealed.
    expect((await req("POST", "/api/enrich/apollo/search", { titles: ["HR Manager"] })).json().people[0].revealed).toMatchObject({ email: "asha.verma@acme.example.in" });

    const added = await req("POST", "/api/enrich/apollo/to-contacts", { ids: ["p1aaaaaaaa", "p2bbbbbbbb"], listName: "HR Noida" });
    expect(added.statusCode, added.body).toBe(200);
    expect(await t.db.outreachContact.findFirst({ where: { ownerId: a.id, email: "asha.verma@acme.example.in", listName: "HR Noida" } })).not.toBeNull();

    // Hunter's credits and lookups are not mixed with Apollo's.
    expect((await req("GET", "/api/enrich/status")).json()).toMatchObject({ configured: false, recent: [] });
  });

  it("never goes beyond the credits left (10 % kept back) and keeps users apart", async () => {
    const b = await customer("ap_b");
    const req = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => t.app.inject({ method, url, headers: b.session, ...(payload !== undefined ? { payload: payload as object } : {}) });
    credits = { limit: 10, consumed: 9, left_over: 1 };
    expect((await req("PUT", "/api/enrich/apollo/key", { key: "OTHERKEY123456789wxyz" })).statusCode).toBe(200);
    const before = calls.filter((c) => c.url.pathname.endsWith("/people/match")).length;
    const res = (await req("POST", "/api/enrich/apollo/reveal", { ids: ["p1aaaaaaaa"] })).json();
    expect(res.items[0]).toMatchObject({ status: "blocked" });
    expect(calls.filter((c) => c.url.pathname.endsWith("/people/match")).length).toBe(before);
    // B's search does not show A's revealed people.
    expect((await req("POST", "/api/enrich/apollo/search", { titles: ["HR"] })).json().people[0].revealed).toBeNull();
  });
});
