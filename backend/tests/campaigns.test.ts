import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../src/database/repositories/index.js";
import { EmailWorker } from "../src/jobs/emailWorker.js";
import { LogEmailProvider } from "../src/providers/email/log.js";
import { EmailProviderError, NO_CAPABILITIES, type EmailProvider, type OutgoingEmail } from "../src/providers/email/types.js";
import { createTestApp } from "./helpers.js";

const SECRET = "test-secret-test-secret-test-secret-123"; // same as helpers.ts
const ist = (time: string, day = "2026-10-06") => new Date(`${day}T${time}:00+05:30`);

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
const provider = new LogEmailProvider("Acme <hi@acme.in>");
let clock = ist("11:00");
let worker: EmailWorker;
let n = 0;

async function lead(data: Record<string, unknown>) {
  n++;
  const name = (data.name as string) ?? `Lead ${n}`;
  return t.db.lead.create({ data: { name, normalizedName: name.toLowerCase(), dedupeKey: `c:${n}`, city: "Lucknow", ...data } });
}

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

async function template(body = "Hi {{name}},\n\nWe build websites for {{category|businesses}} in {{city}}.") {
  return (await call("POST", "/api/templates", { name: "Intro", subject: "Website for {{name}}", body })).json().template as { id: string };
}

async function campaign(leadIds: string[], extra: Record<string, unknown> = {}) {
  const tpl = await template();
  const res = await call("POST", "/api/email/campaigns", {
    name: "University outreach",
    templateId: tpl.id,
    recipients: { leadIds },
    intervalSec: 180,
    dailyLimit: 50,
    windowStart: "10:00",
    windowEnd: "18:00",
    ...extra,
  });
  return res;
}

beforeAll(async () => {
  t = await createTestApp({}, { emailProvider: provider });
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/token",
    payload: { email: t.credentials.email, password: t.credentials.password },
  });
  auth = { authorization: `Bearer ${res.json().token}` };
  worker = new EmailWorker(createRepositories(t.db), provider, { baseUrl: "https://leads.acme.in", unsubscribeSecret: SECRET, now: () => clock });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.contactAttempt.deleteMany();
  await t.db.campaign.deleteMany();
  await t.db.messageTemplate.deleteMany();
  await t.db.leadCommunicationPreference.deleteMany();
  await t.db.lead.deleteMany();
  provider.outbox.length = 0;
  clock = ist("11:00");
});

describe("templates", () => {
  it("validates variables and previews with a real lead (HTML-escaped)", async () => {
    const bad = await call("POST", "/api/templates", { name: "x", subject: "Hi {{firstName}}", body: "x" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain("{{firstName}}");

    const l = await lead({ name: "A&B <College>", category: null });
    const preview = await call("POST", "/api/templates/preview", { subject: "For {{name}}", body: "Hello {{category|there}}", leadId: l.id });
    expect(preview.json()).toMatchObject({ subject: "For A&B <College>", lead: "A&B <College>" });
    expect(preview.json().text).toContain("Hello there");
    expect(preview.json().html).toContain("Hello there");

    const sample = await call("POST", "/api/templates/preview", { subject: "{{name}}", body: "x" });
    expect(sample.json().lead).toContain("(sample)");
  });

  it("cannot delete a template used by a campaign", async () => {
    const l = await lead({ email: "a@x.in" });
    const c = (await campaign([l.id])).json().campaign;
    const del = await call("DELETE", `/api/templates/${c.templateId}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe("TEMPLATE_IN_USE");
  });

  it("requires login", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/templates" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: "/api/email/campaigns" })).statusCode).toBe(401);
  });
});

describe("campaign recipients", () => {
  it("skips leads without email, opted-out leads and repeated addresses", async () => {
    const a = await lead({ email: "info@abc.in" });
    const dup = await lead({ email: "INFO@abc.in " });
    const none = await lead({ email: null });
    const bad = await lead({ email: "not-an-email" });
    const out = await lead({ email: "out@x.in" });
    await t.db.leadCommunicationPreference.create({ data: { leadId: out.id, emailAllowed: false } });
    const e = await lead({ email: "e@x.in" });
    const ids = [a.id, dup.id, none.id, bad.id, out.id, e.id];

    const preview = await call("POST", "/api/email/campaigns/recipients", { recipients: { leadIds: ids } });
    expect(preview.json()).toEqual({ selected: 6, eligible: 2, skipped: { noEmail: 2, optedOut: 1, duplicateEmail: 1 } });

    const created = await campaign(ids);
    expect(created.statusCode).toBe(201);
    expect(created.json().campaign).toMatchObject({ status: "draft", provider: "log", timeZone: "Asia/Kolkata" });
    const attempts = await t.db.contactAttempt.findMany({ orderBy: { createdAt: "asc" } });
    expect(attempts.map((x) => x.toAddress).sort()).toEqual(["e@x.in", "info@abc.in"]);
  });

  it("selects by filters too, and refuses an empty audience", async () => {
    await lead({ email: "x@lko.in", city: "Lucknow" });
    await lead({ email: "y@agra.in", city: "Agra" });
    const preview = await call("POST", "/api/email/campaigns/recipients", { recipients: { filters: { city: "Agra" } } });
    expect(preview.json().eligible).toBe(1);

    const none = await lead({ email: null });
    const res = await campaign([none.id]);
    expect(res.statusCode).toBe(400);
  });

  it("validates schedule settings", async () => {
    const l = await lead({ email: "a@x.in" });
    for (const extra of [{ intervalSec: 5 }, { dailyLimit: 0 }, { windowStart: "25:00" }, { windowStart: "10:00", windowEnd: "10:00" }]) {
      expect((await campaign([l.id], extra)).statusCode, JSON.stringify(extra)).toBe(400);
    }
  });
});

describe("sending (worker)", () => {
  it("sends one email per interval inside the window, then completes", async () => {
    const a = await lead({ name: "ABC University", category: "University", email: "a@abc.in" });
    const b = await lead({ name: "XYZ College", category: "College", email: "b@xyz.in" });
    const c = (await campaign([a.id, b.id])).json().campaign;

    // Draft campaigns never send.
    expect(await worker.step(c)).toBe("waiting"); // a draft (or paused/stopped) campaign never sends
    provider.outbox.length = 0;

    expect((await call("POST", `/api/email/campaigns/${c.id}/start`)).json().campaign.status).toBe("running");
    const running = (await t.db.campaign.findUniqueOrThrow({ where: { id: c.id } }));

    await worker.tick();
    expect(provider.outbox).toHaveLength(1);
    const first = provider.outbox[0]!;
    expect(first).toMatchObject({ to: "a@abc.in", subject: "Website for ABC University" });
    expect(first.text).toContain("We build websites for University in Lucknow.");
    expect(first.headers!["List-Unsubscribe"]).toMatch(/^<https:\/\/leads\.acme\.in\/u\/.+>$/);
    expect(first.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(first.tags).toMatchObject({ campaign: c.id });
    expect(first.idempotencyKey).toMatch(/^attempt-/);

    await worker.tick(); // interval not over yet
    expect(provider.outbox).toHaveLength(1);
    const detail = (await call("GET", `/api/email/campaigns/${c.id}`)).json();
    expect(detail.counts).toEqual({ sent: 1, queued: 1 }); // (API uses the real clock; pacing itself is covered in email-logic tests)

    clock = new Date(clock.getTime() + 180_000);
    await worker.tick();
    expect(provider.outbox.map((m) => m.to)).toEqual(["b@xyz.in", "a@abc.in"]);

    await worker.tick(); // completes right away, without waiting another interval
    const done = await t.db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(done.status).toBe("completed");
    expect(running.status).toBe("running");

    const sent = await t.db.contactAttempt.findMany({ where: { campaignId: c.id } });
    expect(sent.every((x) => x.status === "sent" && x.externalMessageId?.startsWith("log_") && x.renderedSubject)).toBe(true);

    // Lead timeline shows the email.
    const history = (await call("GET", `/api/leads/${a.id}/communications`)).json();
    expect(history.attempts).toHaveLength(1);
    expect(history.attempts[0]).toMatchObject({ status: "sent", campaignName: "University outreach", channel: "email" });
  });

  it("does nothing outside the window or after the daily limit", async () => {
    const l1 = await lead({ email: "1@x.in" });
    const l2 = await lead({ email: "2@x.in" });
    const c = (await campaign([l1.id, l2.id], { dailyLimit: 1 })).json().campaign;
    await call("POST", `/api/email/campaigns/${c.id}/start`);

    clock = ist("07:00");
    await worker.tick();
    expect(provider.outbox).toHaveLength(0);

    clock = ist("10:00");
    await worker.tick();
    clock = ist("12:00");
    await worker.tick();
    expect(provider.outbox).toHaveLength(1); // daily limit 1

    clock = ist("10:05", "2026-10-07"); // next day
    await worker.tick();
    expect(provider.outbox).toHaveLength(2);
  });

  it("re-checks consent right before sending", async () => {
    const l = await lead({ email: "late@x.in" });
    const c = (await campaign([l.id])).json().campaign;
    await call("POST", `/api/email/campaigns/${c.id}/start`);
    await t.db.leadCommunicationPreference.create({ data: { leadId: l.id, emailAllowed: false } });

    await worker.tick();
    expect(provider.outbox).toHaveLength(0);
    const attempt = await t.db.contactAttempt.findFirstOrThrow();
    expect(attempt).toMatchObject({ status: "skipped" });
    expect(attempt.error).toContain("unsubscribed");
  });

  it("pause / resume / stop", async () => {
    const l1 = await lead({ email: "1@x.in" });
    const l2 = await lead({ email: "2@x.in" });
    const c = (await campaign([l1.id, l2.id])).json().campaign;
    await call("POST", `/api/email/campaigns/${c.id}/start`);
    await call("POST", `/api/email/campaigns/${c.id}/pause`);
    await worker.tick();
    expect(provider.outbox).toHaveLength(0);

    expect((await call("POST", `/api/email/campaigns/${c.id}/start`)).statusCode).toBe(200); // resume
    await worker.tick();
    expect(provider.outbox).toHaveLength(1);

    expect((await call("POST", `/api/email/campaigns/${c.id}/stop`)).json().campaign.status).toBe("stopped");
    expect(await t.db.contactAttempt.count({ where: { campaignId: c.id, status: "cancelled" } })).toBe(1);
    const restart = await call("POST", `/api/email/campaigns/${c.id}/start`);
    expect(restart.statusCode).toBe(409);
  });
});

describe("provider failures and crashes", () => {
  function failing(retryable: boolean): EmailProvider {
    return {
      name: "log",
      from: "a@acme.in",
      capabilities: NO_CAPABILITIES,
      sendEmail: async (_m: OutgoingEmail) => {
        throw new EmailProviderError(retryable ? "Resend: Too many requests" : "Resend: Invalid `to` field", retryable, retryable ? 429 : 422);
      },
      sendBatch: async () => [],
      getMessageStatus: async () => null,
      handleWebhook: async () => [],
    };
  }

  it("temporary errors are retried later (with backoff); permanent errors fail the email", async () => {
    const l = await lead({ email: "r@x.in" });
    const c = (await campaign([l.id])).json().campaign;
    await call("POST", `/api/email/campaigns/${c.id}/start`);
    const repos = createRepositories(t.db);

    await new EmailWorker(repos, failing(true), { baseUrl: "https://leads.acme.in", unsubscribeSecret: SECRET, now: () => clock }).tick();
    let attempt = await t.db.contactAttempt.findFirstOrThrow();
    expect(attempt).toMatchObject({ status: "queued", tries: 1, error: "Resend: Too many requests" });
    expect(attempt.nextTryAt!.getTime()).toBe(clock.getTime() + 60_000);

    clock = new Date(clock.getTime() + 10 * 60_000);
    await new EmailWorker(repos, failing(false), { baseUrl: "https://leads.acme.in", unsubscribeSecret: SECRET, now: () => clock }).tick();
    attempt = await t.db.contactAttempt.findFirstOrThrow();
    expect(attempt).toMatchObject({ status: "failed", tries: 2, error: "Resend: Invalid `to` field" });
  });

  it("after a crash, emails stuck in 'sending' are marked failed, never re-sent", async () => {
    const l = await lead({ email: "s@x.in" });
    const c = (await campaign([l.id])).json().campaign;
    await t.db.contactAttempt.updateMany({ where: { campaignId: c.id }, data: { status: "sending" } });
    expect(await worker.recover()).toBe(1);
    expect((await t.db.contactAttempt.findFirstOrThrow()).status).toBe("failed");
  });

  it("a real provider needs a public https PUBLIC_BASE_URL before a campaign can start", async () => {
    const real: EmailProvider = { ...failing(false), name: "resend" };
    const t2 = await createTestApp({}, { emailProvider: real });
    try {
      const token = (await t2.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t2.credentials.email, password: t2.credentials.password } })).json().token;
      const h = { authorization: `Bearer ${token}` };
      const l = await t2.db.lead.create({ data: { name: "P", normalizedName: "p", dedupeKey: "p", email: "p@x.in" } });
      const tpl = (await t2.app.inject({ method: "POST", url: "/api/templates", headers: h, payload: { name: "t", subject: "s", body: "b" } })).json().template;
      const c = (await t2.app.inject({ method: "POST", url: "/api/email/campaigns", headers: h, payload: { name: "c", templateId: tpl.id, recipients: { leadIds: [l.id] }, intervalSec: 60, dailyLimit: 10, windowStart: "09:00", windowEnd: "18:00" } })).json().campaign;
      const start = await t2.app.inject({ method: "POST", url: `/api/email/campaigns/${c.id}/start`, headers: h });
      expect(start.statusCode).toBe(409);
      expect(start.json().error.code).toBe("PUBLIC_URL_REQUIRED");
    } finally {
      await t2.close();
    }
  });
});

describe("unsubscribe page (public)", () => {
  async function linkFor(leadId: string) {
    const l = await t.db.lead.findUniqueOrThrow({ where: { id: leadId } });
    const c = (await campaign([l.id])).json().campaign;
    await call("POST", `/api/email/campaigns/${c.id}/start`);
    await worker.tick();
    const url = provider.outbox[0]!.headers!["List-Unsubscribe"]!.slice(1, -1);
    return new URL(url).pathname;
  }

  it("GET only asks for confirmation; POST unsubscribes; future campaigns skip the lead", async () => {
    const l = await lead({ email: "bye@x.in" });
    const path = await linkFor(l.id);

    const get = await t.app.inject({ method: "GET", url: path });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toContain("text/html");
    expect(get.body).toContain('<form method="post">');
    expect(await t.db.leadCommunicationPreference.count()).toBe(0); // GET changes nothing

    const post = await t.app.inject({
      method: "POST",
      url: path,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });
    expect(post.statusCode).toBe(200);
    expect(post.body).toContain("You are unsubscribed");
    expect(await t.db.leadCommunicationPreference.findUniqueOrThrow({ where: { leadId: l.id } })).toMatchObject({
      emailAllowed: false,
      optOutReason: "unsubscribe_link",
    });

    const again = await call("POST", "/api/email/campaigns/recipients", { recipients: { leadIds: [l.id] } });
    expect(again.json().skipped.optedOut).toBe(1);
  });

  it("rejects forged links without revealing anything", async () => {
    const l = await lead({ email: "x@x.in" });
    const path = await linkFor(l.id);
    const forged = path.slice(0, -2) + (path.endsWith("AA") ? "BB" : "AA");
    for (const url of [forged, "/u/abc.def", "/u/nothing"]) {
      const res = await t.app.inject({ method: "POST", url, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "" });
      expect(res.statusCode, url).toBe(404);
    }
    expect(await t.db.leadCommunicationPreference.count()).toBe(0);
  });
});
