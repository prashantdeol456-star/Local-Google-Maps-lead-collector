import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { Webhook } from "svix";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { maskSecret, parseEmailConfig } from "../src/providers/email/config.js";
import { LogEmailProvider } from "../src/providers/email/log.js";
import { ResendEmailProvider } from "../src/providers/email/resend.js";
import { SmtpEmailProvider } from "../src/providers/email/smtp.js";
import { EmailProviderError, WebhookVerificationFailed, type OutgoingEmail } from "../src/providers/email/types.js";

const message: OutgoingEmail = {
  to: "lead@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
  tags: { attempt: "att_123", campaign: "c-1" },
  headers: { "List-Unsubscribe": "<https://example.com/u/abc>" },
  idempotencyKey: "attempt-att_123",
};

describe("parseEmailConfig", () => {
  it("defaults to the log provider (sends nothing)", () => {
    expect(parseEmailConfig({})).toEqual({ provider: "log", from: "Lead Platform (dev) <noreply@localhost.test>", replyTo: undefined });
  });

  it("requires the provider's settings, naming what is missing", () => {
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: "resend" })).toThrow("needs EMAIL_FROM, RESEND_API_KEY");
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: "smtp", EMAIL_FROM: "a@b.co" })).toThrow("needs SMTP_HOST");
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: "smtp", EMAIL_FROM: "a@b.co", SMTP_HOST: "h", SMTP_USER: "u" })).toThrow("SMTP_PASSWORD");
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: "outplay" })).toThrow("EMAIL_PROVIDER");
  });

  it("validates addresses and the webhook secret format", () => {
    expect(() => parseEmailConfig({ EMAIL_FROM: "not an email" })).toThrow("EMAIL_FROM");
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "a@b.co", RESEND_API_KEY: "re_x", RESEND_WEBHOOK_SECRET: "abc" })).toThrow("whsec_");
    expect(parseEmailConfig({ EMAIL_FROM: "Sales Team <sales@acme.in>" }).from).toBe("Sales Team <sales@acme.in>");
  });

  it("SMTP port 465 implies TLS; 587 uses STARTTLS; empty values count as unset", () => {
    const base = { EMAIL_PROVIDER: "smtp", EMAIL_FROM: "a@b.co", SMTP_HOST: "smtp.example.com" };
    expect(parseEmailConfig({ ...base, SMTP_PORT: "465" })).toMatchObject({ port: 465, secure: true });
    expect(parseEmailConfig({ ...base, SMTP_PORT: "" })).toMatchObject({ port: 587, secure: false });
    expect(parseEmailConfig({ ...base, SMTP_PORT: "587", SMTP_SECURE: "true" })).toMatchObject({ secure: true });
  });

  it("masks secrets", () => {
    expect(maskSecret("re_1234567890abcd")).toBe("••••abcd");
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret(undefined)).toBeNull();
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ResendEmailProvider", () => {
  const API_KEY = "re_SuperSecretKey_123456";

  it("sends with the documented request shape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: "email_1" }));
    const p = new ResendEmailProvider({ apiKey: API_KEY, from: "Acme <hi@acme.in>", replyTo: "sales@acme.in", fetchImpl });
    expect(await p.sendEmail(message)).toEqual({ externalMessageId: "email_1" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["Idempotency-Key"]).toBe("attempt-att_123");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Acme <hi@acme.in>",
      to: ["lead@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      reply_to: "sales@acme.in",
      headers: { "List-Unsubscribe": "<https://example.com/u/abc>" },
      tags: [{ name: "attempt", value: "att_123" }, { name: "campaign", value: "c-1" }],
    });
  });

  it("classifies errors and never leaks the API key", async () => {
    const cases: [Response | Error, boolean, string][] = [
      [jsonResponse(401, { message: "API key is invalid" }), false, "check RESEND_API_KEY"],
      [jsonResponse(422, { message: "Invalid `to` field" }), false, "Invalid `to` field"],
      [jsonResponse(429, { message: "Too many requests" }), true, "Too many requests"],
      [jsonResponse(500, {}), true, "HTTP 500"],
      [new TypeError("fetch failed"), true, "Could not reach Resend"],
    ];
    for (const [outcome, retryable, text] of cases) {
      const fetchImpl = vi.fn(async () => {
        if (outcome instanceof Error) throw outcome;
        return outcome;
      });
      const p = new ResendEmailProvider({ apiKey: API_KEY, from: "a@acme.in", fetchImpl });
      const err = await p.sendEmail(message).catch((e) => e);
      expect(err).toBeInstanceOf(EmailProviderError);
      expect(err.retryable, text).toBe(retryable);
      expect(err.message).toContain(text);
      expect(err.message).not.toContain(API_KEY);
    }
  });

  it("rejects tags Resend would refuse, before calling the API", async () => {
    const fetchImpl = vi.fn();
    const p = new ResendEmailProvider({ apiKey: API_KEY, from: "a@acme.in", fetchImpl });
    await expect(p.sendEmail({ ...message, tags: { "bad tag": "x" } })).rejects.toThrow("Invalid tag");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends batches in chunks of at most 100", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const items = JSON.parse(init!.body as string) as unknown[];
      return jsonResponse(200, { data: items.map(() => ({ id: `e${n++}` })) });
    });
    const p = new ResendEmailProvider({ apiKey: API_KEY, from: "a@acme.in", fetchImpl: fetchImpl as typeof fetch });
    const results = await p.sendBatch(Array.from({ length: 230 }, () => message));
    expect(results).toHaveLength(230);
    expect(fetchImpl.mock.calls.map((c) => (JSON.parse((c[1] as RequestInit).body as string) as unknown[]).length)).toEqual([100, 100, 30]);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.resend.com/emails/batch");
  });

  it("maps last_event to our status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: "e1", last_event: "delivered" }));
    const p = new ResendEmailProvider({ apiKey: API_KEY, from: "a@acme.in", fetchImpl });
    expect(await p.getMessageStatus("e1")).toBe("delivered");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://api.resend.com/emails/e1");
  });

  describe("webhooks (Svix signatures)", () => {
    const secret = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
    const p = new ResendEmailProvider({ apiKey: API_KEY, from: "a@acme.in", webhookSecret: secret });
    const signer = new Webhook(secret);

    function signed(body: object, opts: { id?: string; at?: Date; signWith?: Webhook } = {}) {
      const text = JSON.stringify(body);
      const id = opts.id ?? "msg_123";
      const at = opts.at ?? new Date();
      return {
        body: text,
        headers: {
          "svix-id": id,
          "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
          "svix-signature": (opts.signWith ?? signer).sign(id, at, text),
        },
      };
    }

    const clicked = {
      type: "email.clicked",
      created_at: "2026-10-05T10:00:00.000Z",
      data: {
        email_id: "email_1",
        to: ["lead@example.com"],
        subject: "Hello",
        click: { link: "https://acme.in/offer" },
        tags: { attempt: "att_123" },
      },
    };

    it("accepts a genuine event and normalizes it", async () => {
      expect(await p.handleWebhook(signed(clicked))).toEqual([
        {
          providerEventId: "msg_123",
          externalMessageId: "email_1",
          type: "clicked",
          occurredAt: new Date("2026-10-05T10:00:00.000Z"),
          metadata: {
            resendType: "email.clicked",
            email_id: "email_1",
            click: { link: "https://acme.in/offer" },
            tags: { attempt: "att_123" },
            to: ["lead@example.com"],
          },
        },
      ]);
    });

    it("rejects forged, tampered and replayed requests", async () => {
      const good = signed(clicked);
      await expect(p.handleWebhook({ ...good, body: good.body.replace("acme.in/offer", "evil.example") })).rejects.toBeInstanceOf(WebhookVerificationFailed);

      const otherKey = new Webhook(`whsec_${Buffer.from("ffffffffffffffffffffffffffffffff").toString("base64")}`);
      await expect(p.handleWebhook(signed(clicked, { signWith: otherKey }))).rejects.toBeInstanceOf(WebhookVerificationFailed);

      const old = signed(clicked, { at: new Date(Date.now() - 60 * 60 * 1000) });
      await expect(p.handleWebhook(old)).rejects.toBeInstanceOf(WebhookVerificationFailed);

      await expect(p.handleWebhook({ body: good.body, headers: {} })).rejects.toBeInstanceOf(WebhookVerificationFailed);
    });

    it("ignores event types it does not track, and refuses when no secret is configured", async () => {
      expect(await p.handleWebhook(signed({ type: "email.scheduled", data: { email_id: "e" } }))).toEqual([]);
      const noSecret = new ResendEmailProvider({ apiKey: API_KEY, from: "a@acme.in" });
      await expect(noSecret.handleWebhook(signed(clicked))).rejects.toThrow("RESEND_WEBHOOK_SECRET");
    });
  });
});

describe("SmtpEmailProvider (against a local SMTP server)", () => {
  const received: { from: string; to: string[]; raw: string; user?: string }[] = [];
  let server: SMTPServer;
  let port: number;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onAuth(auth, _session, cb) {
        if (auth.username === "mailer" && auth.password === "right-password") cb(null, { user: "mailer" });
        else cb(new Error("Invalid username or password"));
      },
      onData(stream, session, cb) {
        let raw = "";
        stream.on("data", (c: Buffer) => (raw += c.toString()));
        stream.on("end", () => {
          received.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
            to: session.envelope.rcptTo.map((r) => r.address),
            raw,
            user: session.user as string | undefined,
          });
          cb();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const provider = (user?: string, password?: string) =>
    new SmtpEmailProvider({ host: "127.0.0.1", port, secure: false, user, password, from: "Acme <hi@acme.in>", replyTo: "sales@acme.in", allowSelfSigned: true });

  it("delivers the message with headers, reply-to and correlation tags", async () => {
    const p = provider("mailer", "right-password");
    const { externalMessageId } = await p.sendEmail(message);
    p.close();
    expect(externalMessageId).toMatch(/^<.+@.+>$/);

    const got = received.at(-1)!;
    expect(got.from).toBe("hi@acme.in");
    expect(got.to).toEqual(["lead@example.com"]);
    expect(got.user).toBe("mailer");
    expect(got.raw).toContain("Subject: Hello");
    expect(got.raw).toContain("Reply-To: sales@acme.in");
    expect(got.raw).toContain("List-Unsubscribe: <https://example.com/u/abc>");
    // Header names are case-insensitive; nodemailer writes them Title-Cased.
    expect(got.raw).toMatch(/^X-Lead-Platform-Attempt: att_123$/im);
    expect(got.raw).toContain(`Message-ID: ${externalMessageId}`);
  });

  it("wrong password → not retryable, with a hint", async () => {
    const p = provider("mailer", "wrong");
    const err = await p.sendEmail(message).catch((e) => e);
    p.close();
    expect(err).toBeInstanceOf(EmailProviderError);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("check SMTP_USER / SMTP_PASSWORD");
    expect(err.message).not.toContain("wrong");
  });

  it("server down → retryable", async () => {
    const p = new SmtpEmailProvider({ host: "127.0.0.1", port: 9, secure: false, from: "a@acme.in" });
    const err = await p.sendEmail(message).catch((e) => e);
    p.close();
    expect(err).toBeInstanceOf(EmailProviderError);
    expect(err.retryable).toBe(true);
  });

  it("reports no tracking capabilities", () => {
    expect(provider().capabilities).toMatchObject({ delivery: false, opens: false, clicks: false });
  });
});

describe("LogEmailProvider", () => {
  it("records messages without sending anything", async () => {
    const p = new LogEmailProvider("Dev <noreply@localhost.test>");
    const { externalMessageId } = await p.sendEmail(message);
    expect(externalMessageId).toMatch(/^log_/);
    expect(p.outbox[0]).toMatchObject({ to: "lead@example.com", subject: "Hello", externalMessageId });
  });
});
