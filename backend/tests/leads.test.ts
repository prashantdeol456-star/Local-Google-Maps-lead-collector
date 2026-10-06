import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
let seq = 0;

/** Inserts a lead directly (POST /api/leads with dedupe arrives in Phase 5). */
function insertLead(data: Record<string, unknown>) {
  seq++;
  const name = (data.name as string) ?? `Lead ${seq}`;
  return t.db.lead.create({
    data: { name, normalizedName: name.toLowerCase(), dedupeKey: `test:${seq}`, ...data },
  });
}

beforeAll(async () => {
  t = await createTestApp();
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/token",
    payload: { email: t.credentials.email, password: t.credentials.password },
  });
  auth = { authorization: `Bearer ${res.json().token}` };

  await insertLead({ name: "ABC University", city: "Lucknow", category: "University", searchKeyword: "University", rating: 4.4, reviewCount: 1200, phone: "+919800000001", website: "https://abc.edu.in", latitude: 26.85, longitude: 80.95 });
  await insertLead({ name: "Zeta College", city: "Lucknow", category: "College", searchKeyword: "College", rating: 3.9, reviewCount: 80, address: "Hazratganj, Lucknow" });
  await insertLead({ name: "Moradabad Institute", city: "Moradabad", category: "College", searchKeyword: "College", rating: null });
  await insertLead({ name: "Delhi Mobile Shop", city: "Delhi", category: "Mobile phone shop", searchKeyword: "Mobile shops" });
});
afterAll(async () => {
  await t.close();
});

async function list(qs = "") {
  const res = await t.app.inject({ method: "GET", url: `/api/leads${qs ? `?${qs}` : ""}`, headers: auth });
  return res;
}
const names = (body: { items: { name: string }[] }) => body.items.map((l) => l.name);

describe("leads API", () => {
  it("requires login", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/leads" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "DELETE", url: "/api/leads/x" })).statusCode).toBe(401);
  });

  it("lists with total and hides internal dedupe columns", async () => {
    const body = (await list()).json();
    expect(body.total).toBe(4);
    expect(body).toMatchObject({ page: 1, pageSize: 25 });
    const abc = body.items.find((l: { name: string }) => l.name === "ABC University");
    expect(abc).toMatchObject({ latitude: 26.85, longitude: 80.95, rating: 4.4, source: "google_maps" });
    for (const hidden of ["dedupeKey", "normalizedName", "normalizedPhone", "normalizedWebsite", "normalizedAddress"]) {
      expect(abc).not.toHaveProperty(hidden);
    }
  });

  it("searches name case-insensitively, plus phone, website and address", async () => {
    expect(names((await list("q=abc%20univ")).json())).toEqual(["ABC University"]);
    expect(names((await list("q=9800000001")).json())).toEqual(["ABC University"]);
    expect(names((await list("q=abc.edu")).json())).toEqual(["ABC University"]);
    expect(names((await list("q=hazratganj")).json())).toEqual(["Zeta College"]);
    expect((await list("q=nothing-matches")).json().total).toBe(0);
  });

  it("filters by city, category and keyword (combined)", async () => {
    expect(names((await list("city=Lucknow&sort=name&order=asc")).json())).toEqual(["ABC University", "Zeta College"]);
    expect(names((await list("category=College&sort=name&order=asc")).json())).toEqual(["Moradabad Institute", "Zeta College"]);
    expect(names((await list("keyword=College&city=Moradabad")).json())).toEqual(["Moradabad Institute"]);
  });

  it("sorts, with empty values last", async () => {
    expect(names((await list("sort=rating&order=desc")).json()).slice(0, 2)).toEqual(["ABC University", "Zeta College"]);
    const asc = names((await list("sort=rating&order=asc")).json());
    expect(asc.slice(0, 2)).toEqual(["Zeta College", "ABC University"]);
    expect(asc.slice(2)).toEqual(expect.arrayContaining(["Moradabad Institute", "Delhi Mobile Shop"]));
  });

  it("paginates without overlap", async () => {
    const p1 = names((await list("sort=name&order=asc&pageSize=3")).json());
    const p2 = names((await list("sort=name&order=asc&pageSize=3&page=2")).json());
    expect(p1).toHaveLength(3);
    expect(p2).toHaveLength(1);
    expect(new Set([...p1, ...p2]).size).toBe(4);
  });

  it("rejects bad query parameters", async () => {
    for (const qs of ["sort=password", "order=sideways", "page=-1", "pageSize=1000", `q=${"x".repeat(201)}`]) {
      expect((await list(qs)).statusCode, qs).toBe(400);
    }
  });

  it("gets and deletes a lead; job items keep working after delete", async () => {
    const lead = await insertLead({ name: "To Delete" });
    const job = await t.db.collectionJob.create({ data: { searchKeyword: "x" } });
    await t.db.jobItem.create({ data: { jobId: job.id, clientKey: "k1", result: "new", leadId: lead.id } });

    const got = await t.app.inject({ method: "GET", url: `/api/leads/${lead.id}`, headers: auth });
    expect(got.json().lead.name).toBe("To Delete");

    const del = await t.app.inject({ method: "DELETE", url: `/api/leads/${lead.id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: `/api/leads/${lead.id}`, headers: auth })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/api/leads/${lead.id}`, headers: auth })).statusCode).toBe(404);

    const item = await t.db.jobItem.findFirstOrThrow({ where: { clientKey: "k1" } });
    expect(item.leadId).toBeNull();
  });

  it("enforces unique placeId and dedupeKey in the database", async () => {
    await insertLead({ name: "P1", placeId: "0x1:0x2" });
    await expect(insertLead({ name: "P2", placeId: "0x1:0x2" })).rejects.toThrow();
    await expect(
      t.db.lead.create({ data: { name: "D", normalizedName: "d", dedupeKey: "test:1" } }),
    ).rejects.toThrow();
  });
});
