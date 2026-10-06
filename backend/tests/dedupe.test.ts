import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  await t.db.collectionJob.deleteMany();
});

const era = {
  name: "ERA University",
  placeId: "ChIJera",
  category: "University",
  phone: "08957926677",
  website: "http://www.erauniversity.in/",
  address: "Tondan Marg, Sarfarazganj, Lucknow, Uttar Pradesh 226003",
  city: "Lucknow",
  state: "Uttar Pradesh",
  country: "India",
  postalCode: "226003",
  latitude: 26.8764896,
  longitude: 80.8708007,
  rating: 4.2,
  reviewCount: 1262,
  searchKeyword: "University",
  source: "google_maps",
};

function post(payload: Record<string, unknown>) {
  return t.app.inject({ method: "POST", url: "/api/leads", headers: auth, payload });
}
const save = (lead: Record<string, unknown>, extra: Record<string, unknown> = {}) => post({ lead, ...extra });

async function createJob() {
  const res = await t.app.inject({ method: "POST", url: "/api/jobs", headers: auth, payload: { searchKeyword: "University" } });
  return res.json().job.id as string;
}

describe("POST /api/leads — new and duplicate", () => {
  it("requires login", async () => {
    expect((await t.app.inject({ method: "POST", url: "/api/leads", payload: { lead: era } })).statusCode).toBe(401);
  });

  it("saves a new lead with server-computed normalized fields", async () => {
    const res = await save(era);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ result: "new", matchedBy: null, replayed: false, job: null });
    expect(res.json().lead).not.toHaveProperty("dedupeKey");

    const row = await t.db.lead.findFirstOrThrow();
    expect(row).toMatchObject({
      name: "ERA University",
      phone: "08957926677",
      normalizedName: "era university",
      normalizedPhone: "+918957926677",
      normalizedWebsite: "erauniversity.in",
      normalizedAddress: "tondan marg sarfarazganj lucknow uttar pradesh 226003",
      dedupeKey: "pid:ChIJera",
    });
  });

  it("ignores normalized/dedupe fields sent by the client", async () => {
    await save({ ...era, dedupeKey: "evil", normalizedPhone: "+910000000000" });
    const row = await t.db.lead.findFirstOrThrow();
    expect(row.dedupeKey).toBe("pid:ChIJera");
    expect(row.normalizedPhone).toBe("+918957926677");
  });

  it("same placeId → duplicate; fills missing fields but never overwrites", async () => {
    await save({ ...era, phone: null, rating: null });
    const first = await t.db.lead.findFirstOrThrow();

    const res = await save({ ...era, website: "https://other-site.example", phone: "+91 89579 26677", rating: 4.5 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: "duplicate", matchedBy: "placeId" });

    const rows = await t.db.lead.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      website: "http://www.erauniversity.in/", // kept
      phone: "+91 89579 26677", // was empty → filled
      normalizedPhone: "+918957926677", // lookup column filled too
      rating: 4.5, // was empty → filled
    });
    expect(rows[0]!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime());
    expect(rows[0]!.firstSeenAt).toEqual(first.firstSeenAt);
  });

  it("phone match without placeId → duplicate (and the placeId is filled in later)", async () => {
    await save({ ...era, placeId: null });
    const res = await save({ name: "Era Univ", phone: "+91-8957926677", placeId: "ChIJera" });
    expect(res.json()).toMatchObject({ result: "duplicate", matchedBy: "phone" });
    const rows = await t.db.lead.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.placeId).toBe("ChIJera");
    // Now it is also found by placeId.
    expect((await save({ name: "x", placeId: "ChIJera" })).json().matchedBy).toBe("placeId");
  });

  it("different placeIds sharing a phone stay separate", async () => {
    await save(era);
    const res = await save({ name: "ERA Medical College", placeId: "ChIJeraMed", phone: "08957926677" });
    expect(res.json().result).toBe("new");
    expect(await t.db.lead.count()).toBe(2);
  });

  it("toll-free numbers never merge", async () => {
    await save({ name: "Branch A", phone: "1800 123 4567" });
    expect((await save({ name: "Branch B", phone: "1800-123-4567" })).json().result).toBe("new");
  });

  it("website: same campus page merges, other campus does not", async () => {
    await save({ name: "Amity University Lucknow", website: "https://www.amity.edu/lucknow/?utm_source=google" });
    expect((await save({ name: "Amity Lko", website: "amity.edu/lucknow" })).json()).toMatchObject({
      result: "duplicate",
      matchedBy: "website",
    });
    expect((await save({ name: "Amity Noida", website: "https://www.amity.edu/noida/" })).json().result).toBe("new");
  });

  it("name + address match; same name elsewhere is new; name alone never merges", async () => {
    await save({ name: "City College", address: "Hazratganj, Lucknow" });
    expect((await save({ name: "CITY COLLEGE", address: "Hazratganj,  Lucknow, India" })).json()).toMatchObject({
      result: "duplicate",
      matchedBy: "nameAddress",
    });
    expect((await save({ name: "City College", address: "Gomti Nagar, Lucknow" })).json().result).toBe("new");

    await save({ name: "Only Name Institute" });
    expect((await save({ name: "Only Name Institute" })).json().result).toBe("new");
    const uniq = await t.db.lead.findMany({ where: { name: "Only Name Institute" } });
    expect(uniq.map((l) => l.dedupeKey.startsWith("uniq:"))).toEqual([true, true]);
  });

  it("validates input", async () => {
    for (const lead of [
      {},
      { name: "   " },
      { name: "x", rating: 6 },
      { name: "x", latitude: 100 },
      { name: "x", reviewCount: -1 },
      { name: "x", email: "not-an-email" },
      { name: "x".repeat(301) },
    ]) {
      expect((await save(lead)).statusCode, JSON.stringify(lead)).toBe(400);
    }
    expect((await save({ name: "!!!" })).statusCode).toBe(400); // nothing left after normalization
    expect((await post({ lead: era, jobId: "x" })).statusCode).toBe(400); // jobId without clientKey
  });
});

describe("POST /api/leads — jobs and idempotency", () => {
  it("records a job item and updates job counters", async () => {
    const jobId = await createJob();
    const a = await save(era, { jobId, clientKey: "k-era" });
    expect(a.json().job).toMatchObject({ totalFound: 1, newRecords: 1, duplicateRecords: 0 });

    const b = await save({ ...era, name: "ERA (again)" }, { jobId, clientKey: "k-era-2" });
    expect(b.json()).toMatchObject({ result: "duplicate", job: { totalFound: 2, newRecords: 1, duplicateRecords: 1 } });

    const items = await t.db.jobItem.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });
    expect(items.map((i) => [i.clientKey, i.result, i.matchedBy])).toEqual([
      ["k-era", "new", null],
      ["k-era-2", "duplicate", "placeId"],
    ]);
  });

  it("retrying the same jobId + clientKey returns the original result and does not count twice", async () => {
    const jobId = await createJob();
    const first = await save(era, { jobId, clientKey: "k1" });
    const retry = await save(era, { jobId, clientKey: "k1" });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ result: "new", replayed: true, job: { totalFound: 1, newRecords: 1 } });
    expect(retry.json().lead.id).toBe(first.json().lead.id);
    expect(await t.db.jobItem.count({ where: { jobId } })).toBe(1);
    expect(await t.db.lead.count()).toBe(1);
  });

  it("unknown job → 404, and nothing is saved", async () => {
    const res = await save(era, { jobId: "nope", clientKey: "k" });
    expect(res.statusCode).toBe(404);
    expect(await t.db.lead.count()).toBe(0);
  });

  it("10 parallel submissions of the same lead create exactly one record", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => save(era)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(await t.db.lead.count()).toBe(1);
  });

  it("parallel retries of one job item count it once", async () => {
    const jobId = await createJob();
    await Promise.all(Array.from({ length: 5 }, () => save(era, { jobId, clientKey: "same" })));
    const job = await t.db.collectionJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ totalFound: 1, newRecords: 1, duplicateRecords: 0 });
    expect(await t.db.jobItem.count()).toBe(1);
  });

  it("a deleted lead is not resurrected by a retry; a fresh submission saves it again", async () => {
    const jobId = await createJob();
    const first = (await save(era, { jobId, clientKey: "k1" })).json();
    await t.app.inject({ method: "DELETE", url: `/api/leads/${first.lead.id}`, headers: auth });

    expect((await save(era, { jobId, clientKey: "k1" })).statusCode).toBe(409);
    expect((await save(era)).json().result).toBe("new");
  });
});

describe("DedupeService race handling", () => {
  it("retries once on a unique violation and then reports a duplicate", async () => {
    const { DedupeService } = await import("../src/services/lead/dedupeService.js");
    const { createRepositories } = await import("../src/database/repositories/index.js");
    const { Prisma } = await import("../src/generated/prisma/client.js");

    const repos = createRepositories(t.db);
    let calls = 0;
    // Simulates another request committing the same lead first, so our insert hits the unique index.
    const racing: typeof repos = {
      ...repos,
      transaction: async (fn) => {
        calls++;
        if (calls === 1) {
          await t.db.lead.create({
            data: { name: "ERA University", normalizedName: "era university", placeId: "ChIJera", dedupeKey: "pid:ChIJera" },
          });
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        return repos.transaction(fn);
      },
    };
    const result = await new DedupeService(racing).save(era);
    expect(calls).toBe(2);
    expect(result).toMatchObject({ result: "duplicate", matchedBy: "placeId" });
    expect(await t.db.lead.count()).toBe(1);
  });
});
