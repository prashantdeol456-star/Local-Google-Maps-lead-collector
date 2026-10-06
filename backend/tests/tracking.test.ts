import { Webhook } from "svix";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ResendEmailProvider } from "../src/providers/email/resend.js";
import { rewriteLinks } from "../src/services/email/trackingService.js";
import { createTestApp } from "./helpers.js";

describe("rewriteLinks", () => {
  it("routes http(s) links through /t/c, keeps the unsubscribe link and reuses ids per URL", () => {
    const html =
      '<p><a href="https://acme.in/work">https://acme.in/work</a> and again <a href="https://acme.in/work">x</a>' +
      ' <a href="https://acme.in/q?a=1&amp;b=2">q</a> <a href="mailto:a@b.co">m</a></p>' +
      '<p><a href="https://leads.acme.in/u/tok">unsubscribe here</a></p>';
    const out = rewriteLinks(html, "https://leads.acme.in/", ["https://leads.acme.in/u/tok"]);
    expect(out.links.map((l) => l.url)).toEqual(["https://acme.in/work", "https://acme.in/q?a=1&b=2"]);
    expect(out.html).toContain(`href="https://leads.acme.in/t/c/${out.links[0]!.id}">https://acme.in/work</a>`); // text still shows the real URL
    expect(out.html.split(`/t/c/${out.links[0]!.id}`).length - 1).toBe(2);
    expect(out.html).toContain('href="https://leads.acme.in/u/tok"');
    expect(out.html).toContain('href="mailto:a@b.co"');
  });
});

const secret = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
const signer = new Webhook(secret);
let sentBodies: { to: string[]; html: string }[] = [];
let nextId = 0;
const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
  sentBodies.push(JSON.parse(init!.body as string));
  return new Response(JSON.stringify({ id: `re_${++nextId}` }), { status: 200, headers: { "content-type": "application/json" } });
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
let attemptIdByEmail: Record<string, string> = {};
let leadIdByEmail: Record<string, string> = {};
let campaignId = "";

function webhook(type: string, emailId: string, id: string, data: Record<string, unknown> = {}) {
  const body = JSON.stringify({ type, created_at: "2026-10-06T10:00:00.000Z", data: { email_id: emailId, to: ["x@y.z"], ...data } });
  const at = new Date();
  return t.app.inject({
    method: "POST",
    url: "/api/webhooks/email/resend",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": signer.sign(id, at, body),
    },
    payload: body,
  });
}

beforeAll(async () => {
  t = await createTestApp(
    { publicBaseUrl: "https://leads.acme.in" },
    { emailProvider: new ResendEmailProvider({ apiKey: "re_test_key_123456", from: "Acme <hi@acme.in>", webhookSecret: secret, fetchImpl: fetchImpl as typeof fetch }) },
  );
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };

  const emails = ["a@uni.in", "b@college.in", "c@school.in"];
  const leadIds: string[] = [];
  for (const [i, email] of emails.entries()) {
    const lead = await t.db.lead.create({ data: { name: `Lead ${i}`, normalizedName: `lead ${i}`, dedupeKey: `t:${i}`, email } });
    leadIds.push(lead.id);
    leadIdByEmail[email] = lead.id;
  }
  const tpl = (await t.app.inject({ method: "POST", url: "/api/templates", headers: auth, payload: { name: "t", subject: "Hi {{name}}", body: "See our work: https://acme.in/portfolio" } })).json().template;
  const c = (
    await t.app.inject({
      method: "POST",
      url: "/api/email/campaigns",
      headers: auth,
      payload: { name: "Track test", templateId: tpl.id, recipients: { leadIds }, intervalSec: 30, dailyLimit: 100, windowStart: "00:00", windowEnd: "23:59" },
    })
  ).json().campaign;
  campaignId = c.id;
  expect((await t.app.inject({ method: "POST", url: `/api/email/campaigns/${c.id}/start`, headers: auth })).statusCode).toBe(200);

  // Send all three: reset lastSentAt between ticks to skip the interval.
  for (let i = 0; i < 3; i++) {
    await t.db.campaign.update({ where: { id: c.id }, data: { lastSentAt: null } });
    await t.app.emailWorker.tick();
  }
  const attempts = await t.db.contactAttempt.findMany();
  attemptIdByEmail = Object.fromEntries(attempts.map((a) => [a.toAddress, a.id]));
  expect(attempts.every((a) => a.status === "sent")).toBe(true);
});
afterAll(async () => {
  await t.close();
});

describe("click tracking", () => {
  it("emails contain tracked links; a click is recorded and redirects to the real URL", async () => {
    const html = sentBodies[0]!.html;
    const match = /href="https:\/\/leads\.acme\.in\/t\/c\/([A-Za-z0-9_-]+)">https:\/\/acme\.in\/portfolio<\/a>/.exec(html);
    expect(match).not.toBeNull();
    expect(html).toContain('href="https://leads.acme.in/u/'); // unsubscribe link not tracked

    const res = await t.app.inject({ method: "GET", url: `/t/c/${match![1]}`, headers: { "user-agent": "Mozilla/5.0 test" } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://acme.in/portfolio");

    const to = sentBodies[0]!.to[0]!;
    const attempt = await t.db.contactAttempt.findUniqueOrThrow({ where: { id: attemptIdByEmail[to] } });
    expect(attempt.clickedAt).not.toBeNull();
    const event = await t.db.emailEvent.findFirstOrThrow({ where: { attemptId: attempt.id, type: "clicked" } });
    expect(JSON.parse(event.metadata!)).toMatchObject({ link: "https://acme.in/portfolio", userAgent: "Mozilla/5.0 test" });
  });

  it("unknown or malformed link ids are a 404, never a redirect", async () => {
    for (const id of ["doesnotexist123", "x", "../../etc"]) {
      const res = await t.app.inject({ method: "GET", url: `/t/c/${encodeURIComponent(id)}` });
      expect(res.statusCode, id).toBe(404);
      expect(res.headers.location).toBeUndefined();
    }
  });
});

describe("provider webhooks (Resend)", () => {
  const externalId = async (email: string) => (await t.db.contactAttempt.findUniqueOrThrow({ where: { id: attemptIdByEmail[email] } })).externalMessageId!;

  it("records delivered/opened events without a login and updates the email", async () => {
    const id = await externalId("a@uni.in");
    const delivered = await webhook("email.delivered", id, "msg_d1");
    expect(delivered.statusCode).toBe(200);
    expect(delivered.json()).toEqual({ received: 1, recorded: 1, duplicates: 0, unmatched: 0 });
    await webhook("email.opened", id, "msg_o1");

    const attempt = await t.db.contactAttempt.findUniqueOrThrow({ where: { id: attemptIdByEmail["a@uni.in"] } });
    expect(attempt.status).toBe("delivered");
    expect(attempt.deliveredAt).toEqual(new Date("2026-10-06T10:00:00.000Z"));
    expect(attempt.openedAt).not.toBeNull();
  });

  it("a webhook delivered twice is stored once", async () => {
    const id = await externalId("a@uni.in");
    const again = await webhook("email.delivered", id, "msg_d1");
    expect(again.json()).toMatchObject({ recorded: 0, duplicates: 1 });
    expect(await t.db.emailEvent.count({ where: { providerEventId: "msg_d1" } })).toBe(1);
  });

  it("bounces fail the email with the reason; spam complaints unsubscribe the lead", async () => {
    const b = await externalId("b@college.in");
    await webhook("email.bounced", b, "msg_b1", { bounce: { message: "Mailbox does not exist", type: "Permanent" } });
    const bounced = await t.db.contactAttempt.findUniqueOrThrow({ where: { id: attemptIdByEmail["b@college.in"] } });
    expect(bounced).toMatchObject({ status: "failed", error: "Mailbox does not exist" });
    expect(bounced.bouncedAt).not.toBeNull();

    const c = await externalId("c@school.in");
    await webhook("email.complained", c, "msg_c1");
    const pref = await t.db.leadCommunicationPreference.findUniqueOrThrow({ where: { leadId: leadIdByEmail["c@school.in"] } });
    expect(pref).toMatchObject({ emailAllowed: false, optOutReason: "spam_complaint" });
  });

  it("rejects bad signatures and stores nothing", async () => {
    const id = await externalId("a@uni.in");
    const body = JSON.stringify({ type: "email.clicked", data: { email_id: id } });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/webhooks/email/resend",
      headers: { "content-type": "application/json", "svix-id": "msg_fake", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(await t.db.emailEvent.count({ where: { providerEventId: "msg_fake" } })).toBe(0);
  });

  it("events for unknown emails are counted as unmatched; other providers' paths are 404", async () => {
    expect((await webhook("email.delivered", "re_not_ours", "msg_u1")).json()).toMatchObject({ unmatched: 1, recorded: 0 });
    const other = await t.app.inject({ method: "POST", url: "/api/webhooks/email/smtp", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(other.statusCode).toBe(404);
    // Webhooks are public, but the rest of the API still needs a login.
    expect((await t.app.inject({ method: "GET", url: "/api/email/campaigns" })).statusCode).toBe(401);
  });
});

describe("replies, campaign stats and lead timeline", () => {
  it("logs a reply for a sent email (not for unsent ones)", async () => {
    const ok = await t.app.inject({ method: "POST", url: `/api/email/attempts/${attemptIdByEmail["a@uni.in"]}/reply`, headers: auth, payload: { message: "Interested, call us Monday" } });
    expect(ok.statusCode).toBe(200);
    const attempt = await t.db.contactAttempt.findUniqueOrThrow({ where: { id: attemptIdByEmail["a@uni.in"] } });
    expect(attempt.repliedAt).not.toBeNull();

    await t.db.contactAttempt.update({ where: { id: attemptIdByEmail["c@school.in"] }, data: { sentAt: null } });
    const notSent = await t.app.inject({ method: "POST", url: `/api/email/attempts/${attemptIdByEmail["c@school.in"]}/reply`, headers: auth, payload: { message: "x" } });
    expect(notSent.statusCode).toBe(409);
  });

  it("campaign detail shows tracking totals", async () => {
    const detail = (await t.app.inject({ method: "GET", url: `/api/email/campaigns/${campaignId}`, headers: auth })).json();
    expect(detail.tracking).toEqual({ deliveredAt: 1, openedAt: 1, clickedAt: 1, bouncedAt: 1, complainedAt: 1, repliedAt: 1, readAt: 0 });
  });

  it("the lead timeline lists its events", async () => {
    const history = (await t.app.inject({ method: "GET", url: `/api/leads/${leadIdByEmail["a@uni.in"]}/communications`, headers: auth })).json();
    expect(history.events.map((e: { type: string }) => e.type).sort()).toEqual(["clicked", "delivered", "opened", "replied"]); // the click test above clicked this lead's email
    expect(history.events.find((e: { type: string }) => e.type === "replied").metadata).toEqual({ message: "Interested, call us Monday" });
  });
});
