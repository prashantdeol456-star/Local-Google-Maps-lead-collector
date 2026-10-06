import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LogEmailProvider } from "../src/providers/email/log.js";
import { EmailProviderError, NO_CAPABILITIES, type EmailProvider } from "../src/providers/email/types.js";
import { createTestApp } from "./helpers.js";

async function login(t: Awaited<ReturnType<typeof createTestApp>>) {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/token",
    payload: { email: t.credentials.email, password: t.credentials.password },
  });
  return { authorization: `Bearer ${res.json().token}` };
}

describe("email API (log provider)", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let auth: { authorization: string };
  const provider = new LogEmailProvider("Test <noreply@test.local>");

  beforeAll(async () => {
    t = await createTestApp({}, { emailProvider: provider });
    auth = await login(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("requires login", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/email/provider" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/api/email/send-test", payload: { to: "a@b.co" } })).statusCode).toBe(401);
  });

  it("describes the provider and says that nothing is really sent", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/email/provider", headers: auth });
    expect(res.json()).toMatchObject({ provider: "log", sendsRealEmail: false, from: "Test <noreply@test.local>", capabilities: { opens: false } });
  });

  it("send-test uses a fixed message and logs it", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/email/send-test", headers: auth, payload: { to: "Me@Example.com" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: "log", sentReal: false });
    expect(provider.outbox[0]).toMatchObject({ to: "me@example.com", subject: "Test email from your Lead Platform" });
    const log = await t.db.agentLog.findFirstOrThrow({ where: { action: "email_test_sent" } });
    expect(log.message).toContain("me@example.com");
  });

  it("rejects bad addresses and extra fields cannot change the content", async () => {
    expect((await t.app.inject({ method: "POST", url: "/api/email/send-test", headers: auth, payload: { to: "nope" } })).statusCode).toBe(400);
    await t.app.inject({ method: "POST", url: "/api/email/send-test", headers: auth, payload: { to: "x@example.com", subject: "SPAM", html: "<b>buy</b>" } });
    expect(provider.outbox[0]!.subject).toBe("Test email from your Lead Platform");
  });
});

describe("email API (provider errors, secrets)", () => {
  it("returns 502 with the provider's message and logs the failure", async () => {
    const failing: EmailProvider = {
      name: "resend",
      from: "a@acme.in",
      capabilities: NO_CAPABILITIES,
      sendEmail: async () => {
        throw new EmailProviderError("Resend: The acme.in domain is not verified", false, 403);
      },
      sendBatch: async () => [],
      getMessageStatus: async () => null,
      handleWebhook: async () => [],
    };
    const t = await createTestApp({}, { emailProvider: failing });
    try {
      const res = await t.app.inject({ method: "POST", url: "/api/email/send-test", headers: await login(t), payload: { to: "a@b.co" } });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toEqual({ code: "EMAIL_PROVIDER_ERROR", message: "Resend: The acme.in domain is not verified" });
      expect(await t.db.agentLog.count({ where: { action: "email_test_failed" } })).toBe(1);
    } finally {
      await t.close();
    }
  });

  it("never returns secrets in provider info", async () => {
    const apiKey = "re_TopSecretKeyValue_9876";
    const t = await createTestApp({
      email: { provider: "resend", from: "Acme <hi@acme.in>", apiKey, webhookSecret: "whsec_c2VjcmV0c2VjcmV0c2VjcmV0" },
    });
    try {
      const res = await t.app.inject({ method: "GET", url: "/api/email/provider", headers: await login(t) });
      expect(res.json()).toMatchObject({
        provider: "resend",
        sendsRealEmail: true,
        details: { apiKey: "••••9876", webhookSecret: "configured" },
        capabilities: { delivery: true, opens: true, clicks: true },
      });
      expect(res.body).not.toContain("TopSecret");
      expect(res.body).not.toContain("whsec_");
    } finally {
      await t.close();
    }
  });
});
