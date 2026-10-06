import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StatsService } from "../src/services/statsService.js";
import { createRepositories } from "../src/database/repositories/index.js";
import { startOfDayInZone } from "../src/utils/time.js";
import { createTestApp } from "./helpers.js";

describe("startOfDayInZone", () => {
  it("Asia/Kolkata (UTC+5:30)", () => {
    // 2026-10-05 01:00 IST = 2026-10-04 19:30 UTC → day starts 2026-10-04 18:30 UTC
    expect(startOfDayInZone(new Date("2026-10-04T19:30:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-10-04T18:30:00.000Z");
    // 2026-10-04 23:59 IST
    expect(startOfDayInZone(new Date("2026-10-04T18:29:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-10-03T18:30:00.000Z");
  });

  it("UTC", () => {
    expect(startOfDayInZone(new Date("2026-10-05T12:34:56Z"), "UTC").toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("handles a DST day (America/New_York, 2026-03-08)", () => {
    // Midnight before the spring-forward is still EST (UTC-5).
    expect(startOfDayInZone(new Date("2026-03-08T15:00:00Z"), "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    // Day after: EDT (UTC-4).
    expect(startOfDayInZone(new Date("2026-03-09T15:00:00Z"), "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("stats", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it("requires login and starts at zero", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/stats" })).statusCode).toBe(401);

    const login = await t.app.inject({
      method: "POST",
      url: "/api/auth/token",
      payload: { email: t.credentials.email, password: t.credentials.password },
    });
    const res = await t.app.inject({
      method: "GET",
      url: "/api/stats",
      headers: { authorization: `Bearer ${login.json().token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      totalLeads: 0,
      todayLeads: 0,
      totalDuplicates: 0,
      totalCollections: 0,
      completedJobs: 0,
      activeJob: null,
      timeZone: "Asia/Kolkata",
    });
  });

  it("counts today's leads in the configured time zone, duplicates and jobs", async () => {
    const now = new Date("2026-10-05T06:00:00Z"); // 11:30 IST
    const mk = (n: number, createdAt: string) =>
      t.db.lead.create({ data: { name: `L${n}`, normalizedName: `l${n}`, dedupeKey: `s:${n}`, createdAt: new Date(createdAt) } });
    await mk(1, "2026-10-04T18:30:00Z"); // exactly 00:00 IST → today
    await mk(2, "2026-10-05T05:00:00Z"); // today
    await mk(3, "2026-10-04T18:29:59Z"); // 23:59:59 IST yesterday

    const done = await t.db.collectionJob.create({ data: { searchKeyword: "a", status: "completed" } });
    const active = await t.db.collectionJob.create({ data: { searchKeyword: "b", status: "paused" } });
    await t.db.jobItem.createMany({
      data: [
        { jobId: done.id, clientKey: "1", result: "new" },
        { jobId: done.id, clientKey: "2", result: "duplicate" },
        { jobId: done.id, clientKey: "3", result: "duplicate" },
      ],
    });

    const stats = await new StatsService(createRepositories(t.db), "Asia/Kolkata").get(now);
    expect(stats).toMatchObject({ totalLeads: 3, todayLeads: 2, totalDuplicates: 2, totalCollections: 2, completedJobs: 1 });
    expect(stats.activeJob?.id).toBe(active.id);
  });
});
