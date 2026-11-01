import { Webhook } from "svix";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LogEmailProvider } from "../src/providers/email/log.js";
import { createTestApp } from "./helpers.js";

// Phase C: customers send with their own email/WhatsApp sender; super admins with .env's.

const platform = new LogEmailProvider("Platform <hi@platform.in>");
let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };

const req = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, headers: Record<string, string>, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

async function customer(name: string) {
  await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${name}@shop.in`, phone: "9876543210", username: name, password: `${name}-password-1` } });
  const id = ((await req("GET", `/api/users?q=${name}`, superAuth)).json().items[0] as { id: string }).id;
  await req("POST", `/api/users/${id}/approve`, superAuth);
  const token = (await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: name, password: `${name}-password-1` } })).json().token as string;
  return { id, auth: { authorization: `Bearer ${token}` } };
}

const CAMPAIGN = { intervalSec: 30, dailyLimit: 100, windowStart: "00:00", windowEnd: "23:59" };

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000, publicBaseUrl: "https://leads.example.in" }, { emailProvider: platform });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  superAuth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("a customer's own sender", () => {
  it("stores secrets encrypted and never returns them", async () => {
    const c = await customer("secret_keeper");
    const saved = await req("PUT", "/api/senders/email", c.auth, {
      provider: "resend",
      from: "Shop <hello@shop.in>",
      apiKey: "re_live_SECRET_KEY_123456",
      webhookSecret: `whsec_${Buffer.from("x".repeat(32)).toString("base64")}`,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain("SECRET_KEY");
    expect(saved.json()).toMatchObject({ email: { provider: "resend", from: "Shop <hello@shop.in>" }, whatsapp: null });
    expect(saved.json().webhooks.email).toMatch(/^https:\/\/leads\.example\.in\/api\/webhooks\/u\/[A-Za-z0-9_-]+\/email\/resend$/);
    const row = await t.db.senderSettings.findUniqueOrThrow({ where: { ownerId: c.id } });
    expect(row.emailConfig).not.toContain("SECRET_KEY");
    expect((await req("GET", "/api/senders", c.auth)).body).not.toContain("SECRET_KEY");

    expect((await req("PUT", "/api/senders/email", c.auth, { provider: "resend", from: "not an address", apiKey: "x" })).statusCode).toBe(400);
    expect((await req("PUT", "/api/senders/whatsapp", c.auth, { provider: "meta", accessToken: "EAAx", phoneNumberId: "abc" })).statusCode).toBe(400);
    expect((await req("DELETE", "/api/senders/email", c.auth)).json().email).toBeNull();
  });

  it("starts campaigns only with the user's own sender, which then does the sending", async () => {
    const c = await customer("sender_shop");
    const tpl = (await req("POST", "/api/templates", c.auth, { name: "Intro", subject: "Hi {{name}}", body: "Hello {{name}}" })).json().template;
    const lead = (await req("POST", "/api/leads", c.auth, { lead: { name: "Clinic S", email: "clinic@s.in" } })).json().lead;
    const make = async () =>
      (await req("POST", "/api/email/campaigns", c.auth, { name: "C", templateId: tpl.id, recipients: { leadIds: [lead.id] }, ...CAMPAIGN })).json().campaign;

    // Before a sender is connected: a draft that cannot start
    const early = await make();
    expect(early.provider).toBe("none");
    expect((await req("POST", `/api/email/campaigns/${early.id}/start`, c.auth)).json().error.code).toBe("SENDER_REQUIRED");

    // Connect the sender ("log": records instead of delivering, allowed outside production)
    expect((await req("PUT", "/api/senders/email", c.auth, { provider: "log", from: "Shop <hello@shop.in>" })).statusCode).toBe(200);
    expect((await req("POST", `/api/email/campaigns/${early.id}/start`, c.auth)).json().error.code).toBe("PROVIDER_CHANGED");
    expect((await req("POST", "/api/senders/test", c.auth, { channel: "email", to: "me@shop.in" })).json()).toMatchObject({ ok: true, provider: "log" });

    const campaign = await make();
    expect(campaign.provider).toBe("log");
    expect((await req("POST", `/api/email/campaigns/${campaign.id}/start`, c.auth)).statusCode).toBe(200);
    await t.app.emailWorker.tick();
    const attempt = await t.db.contactAttempt.findFirstOrThrow({ where: { campaignId: campaign.id } });
    expect(attempt.status).toBe("sent");
    expect(attempt.ownerId).toBe(c.id);
    // …through the customer's sender, not the platform's
    expect(platform.outbox.map((m) => m.to)).not.toContain("clinic@s.in");
  });

  it("super admins keep sending with the platform sender", async () => {
    const tpl = (await req("POST", "/api/templates", superAuth, { name: "Admin", subject: "Hi", body: "Hello" })).json().template;
    const lead = (await req("POST", "/api/leads", superAuth, { lead: { name: "Admin Lead", email: "admin-lead@x.in" } })).json().lead;
    const campaign = (await req("POST", "/api/email/campaigns", superAuth, { name: "A", templateId: tpl.id, recipients: { leadIds: [lead.id] }, ...CAMPAIGN })).json().campaign;
    expect(campaign.provider).toBe("log");
    expect((await req("POST", `/api/email/campaigns/${campaign.id}/start`, superAuth)).statusCode).toBe(200);
    await t.db.campaign.updateMany({ data: { lastSentAt: null } });
    await t.app.emailWorker.tick();
    expect(platform.outbox.map((m) => m.to)).toContain("admin-lead@x.in");
  });

  it("verifies the customer's webhook with their own secret", async () => {
    const c = await customer("hooked");
    const secret = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
    const view = (await req("PUT", "/api/senders/email", c.auth, { provider: "resend", from: "hooked@shop.in", apiKey: "re_test_1", webhookSecret: secret })).json();
    const url = new URL(view.webhooks.email).pathname;
    const body = JSON.stringify({ type: "email.delivered", created_at: "2026-11-01T10:00:00.000Z", data: { email_id: "re_unknown", to: ["x@y.z"] } });
    const at = new Date();
    const signed = (signer: Webhook) => ({
      "content-type": "application/json",
      "svix-id": "msg_1",
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": signer.sign("msg_1", at, body),
    });
    expect((await t.app.inject({ method: "POST", url, headers: signed(new Webhook(secret)), payload: body })).statusCode).toBe(200);
    const other = `whsec_${Buffer.from("ffffffffffffffffffffffffffffffff").toString("base64")}`;
    expect((await t.app.inject({ method: "POST", url, headers: signed(new Webhook(other)), payload: body })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/api/webhooks/u/notarealtoken123456/email/resend", headers: signed(new Webhook(secret)), payload: body })).statusCode).toBe(404);
  });
});
