import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };
let superId: string;

const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, headers: Record<string, string>, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

async function tokenFor(login: string, password: string) {
  return t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: login, password } });
}

async function customer(name: string) {
  const reg = await t.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: `${name}@shop.in`, phone: "+91 98765 43210", username: name, password: `${name}-password-1` },
  });
  expect(reg.statusCode, reg.body).toBe(201);
  const users = (await req("GET", `/api/users?q=${name}`, superAuth)).json().items as { id: string }[];
  await req("POST", `/api/users/${users[0]!.id}/approve`, superAuth);
  const token = (await tokenFor(name, `${name}-password-1`)).json().token as string;
  return { id: users[0]!.id, auth: { authorization: `Bearer ${token}` } };
}

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 }); // many registrations and logins below
  const res = await tokenFor(t.credentials.email, t.credentials.password);
  superAuth = { authorization: `Bearer ${res.json().token}` };
  superId = res.json().admin.id;
  expect(res.json().admin.role).toBe("super_admin");
});
afterAll(async () => {
  await t.close();
});

describe("registration and approval", () => {
  it("registers a pending customer who can log in only after approval, by email or user id", async () => {
    const reg = await t.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "Ravi@Shop.in", phone: "9876543210", username: "Ravi.Shop", password: "ravi-password-1" },
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user).toEqual({ email: "ravi@shop.in", username: "ravi.shop", status: "pending" });

    const pending = await tokenFor("ravi.shop", "ravi-password-1");
    expect(pending.statusCode).toBe(403);
    expect(pending.json().error.code).toBe("ACCOUNT_PENDING");
    // A wrong password does not reveal that the account exists and is pending.
    expect((await tokenFor("ravi.shop", "wrong-password")).json().error.code).toBe("INVALID_CREDENTIALS");

    const list = (await req("GET", "/api/users?status=pending", superAuth)).json();
    expect(list.pendingCount).toBe(1);
    const id = list.items[0].id as string;
    expect((await req("POST", `/api/users/${id}/approve`, superAuth)).json().user.status).toBe("active");

    const byId = await tokenFor("ravi.shop", "ravi-password-1");
    expect(byId.statusCode).toBe(200);
    expect(byId.json().admin).toMatchObject({ email: "ravi@shop.in", role: "customer" });
    expect((await tokenFor("RAVI@shop.in", "ravi-password-1")).statusCode).toBe(200);
  });

  it("rejects duplicates and weak input", async () => {
    const base = { email: "dup@shop.in", phone: "9876543210", username: "dup_user", password: "dup-password-1" };
    expect((await t.app.inject({ method: "POST", url: "/api/auth/register", payload: base })).statusCode).toBe(201);
    const again = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...base, username: "other_user" } });
    expect(again.json().error.code).toBe("EMAIL_TAKEN");
    const sameId = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...base, email: "x@shop.in" } });
    expect(sameId.json().error.code).toBe("USERNAME_TAKEN");
    for (const bad of [{ password: "short" }, { username: "a b" }, { phone: "call me" }, { email: "nope" }]) {
      expect((await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...base, email: "y@shop.in", username: "y_user", ...bad } })).statusCode).toBe(400);
    }
  });

  it("disabling signs the user out; a password reset too; the last super admin stays", async () => {
    const c = await customer("disable_me");
    expect((await req("GET", "/api/leads", c.auth)).statusCode).toBe(200);
    await req("POST", `/api/users/${c.id}/disable`, superAuth);
    expect((await req("GET", "/api/leads", c.auth)).statusCode).toBe(401);
    expect((await tokenFor("disable_me", "disable_me-password-1")).json().error.code).toBe("ACCOUNT_DISABLED");

    await req("POST", `/api/users/${c.id}/enable`, superAuth);
    const fresh = (await tokenFor("disable_me", "disable_me-password-1")).json().token;
    await req("POST", `/api/users/${c.id}/password`, superAuth, { password: "new-password-123" });
    expect((await req("GET", "/api/leads", { authorization: `Bearer ${fresh}` })).statusCode).toBe(401);
    expect((await tokenFor("disable_me", "new-password-123")).statusCode).toBe(200);

    expect((await req("POST", `/api/users/${superId}/disable`, superAuth)).statusCode).toBe(400);
  });

  it("only super admins manage users; customers cannot reach admin-only parts", async () => {
    const c = await customer("plain");
    expect((await req("GET", "/api/users", c.auth)).statusCode).toBe(403);
    expect((await req("POST", `/api/users/${c.id}/approve`, c.auth)).statusCode).toBe(403);
    const blocked = await req("GET", "/api/campaign-logs/campaigns", c.auth);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("NOT_AVAILABLE_FOR_ACCOUNT");
    expect((await req("GET", "/api/stats", c.auth)).statusCode).toBe(200);
    expect((await req("GET", "/api/auth/me", c.auth)).json().admin.role).toBe("customer");
  });
});

describe("each user's own collection", () => {
  it("keeps Google Maps leads, collections and LinkedIn leads apart; super admins see all", async () => {
    const a = await customer("alpha");
    const b = await customer("beta");
    const place = { name: "Same Hospital", placeId: "ChIJsame", phone: "+919800000099", city: "Hapur" };

    const jobA = (await req("POST", "/api/jobs", a.auth, { searchKeyword: "Hospital" })).json().job;
    await req("PATCH", `/api/jobs/${jobA.id}`, a.auth, { status: "running" });
    const leadA = await req("POST", "/api/leads", a.auth, { jobId: jobA.id, clientKey: "k1", lead: place });
    expect(leadA.json().result).toBe("new");
    // The same place is new for another user too: their collections are separate.
    const leadB = await req("POST", "/api/leads", b.auth, { lead: place });
    expect(leadB.json().result).toBe("new");
    expect(leadB.json().lead.id).not.toBe(leadA.json().lead.id);
    // …but a duplicate within one user's collection.
    expect((await req("POST", "/api/leads", b.auth, { lead: place })).json().result).toBe("duplicate");

    const idsOf = async (auth: Record<string, string>) => ((await req("GET", "/api/leads", auth)).json().items as { id: string }[]).map((l) => l.id);
    expect(await idsOf(a.auth)).toEqual([leadA.json().lead.id]);
    expect(await idsOf(b.auth)).toEqual([leadB.json().lead.id]);

    // Another user's lead does not exist for you.
    const other = leadA.json().lead.id as string;
    expect((await req("GET", `/api/leads/${other}`, b.auth)).statusCode).toBe(404);
    expect((await req("PATCH", `/api/leads/${other}`, b.auth, { city: "X" })).statusCode).toBe(404);
    expect((await req("DELETE", `/api/leads/${other}`, b.auth)).statusCode).toBe(404);
    expect((await req("GET", `/api/leads/${other}`, a.auth)).json().lead.city).toBe("Hapur");

    // Collections and their stats
    expect(((await req("GET", "/api/jobs", b.auth)).json().items as unknown[]).length).toBe(0);
    expect((await req("GET", `/api/jobs/${jobA.id}`, b.auth)).statusCode).toBe(404);
    expect((await req("GET", "/api/stats", a.auth)).json()).toMatchObject({ totalLeads: 1, totalCollections: 1 });
    expect((await req("GET", "/api/stats", b.auth)).json()).toMatchObject({ totalLeads: 1, totalCollections: 0, totalDuplicates: 0 });

    // Export contains only your leads
    const csv = (await req("GET", "/api/export/csv", b.auth)).body;
    expect(csv.match(/Same Hospital/g)).toHaveLength(1);

    // LinkedIn leads
    const profile = { profileUrl: "https://www.linkedin.com/in/same-person", name: "Same Person" };
    expect((await req("POST", "/api/linkedin/leads", a.auth, { lead: profile })).statusCode).toBe(201);
    expect((await req("POST", "/api/linkedin/leads", b.auth, { lead: profile })).statusCode).toBe(201);
    expect((await req("GET", "/api/linkedin/facets", a.auth)).json().total).toBe(1);
    expect((await req("POST", "/api/linkedin/leads/check", b.auth, { profileUrls: [profile.profileUrl] })).json().saved).toHaveProperty([profile.profileUrl]);

    // Super admin: everything, or one user's data with the view header
    const all = (await req("GET", "/api/leads", superAuth)).json().total as number;
    expect(all).toBeGreaterThanOrEqual(2);
    const onlyA = await req("GET", "/api/leads", { ...superAuth, "x-view-owner": a.id });
    expect(onlyA.json().items.map((l: { id: string }) => l.id)).toEqual([leadA.json().lead.id]);
    expect((await req("GET", "/api/linkedin/facets", { ...superAuth, "x-view-owner": b.id })).json().total).toBe(1);
    // A customer cannot use the view header to look at others.
    expect(await idsOf({ ...b.auth, "x-view-owner": a.id })).toEqual([leadB.json().lead.id]);
  });
});
