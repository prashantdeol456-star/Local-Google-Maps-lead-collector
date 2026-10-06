import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseWhatsAppConfig } from "../src/providers/whatsapp/config.js";
import { toWhatsAppNumber } from "../src/providers/whatsapp/index.js";
import { LogWhatsAppProvider } from "../src/providers/whatsapp/log.js";
import { MetaWhatsAppProvider } from "../src/providers/whatsapp/meta.js";
import { WhatsAppProviderError, WhatsAppWebhookRejected, type OutgoingTemplate } from "../src/providers/whatsapp/types.js";
import { createTestApp } from "./helpers.js";

const TOKEN = "EAAGsecretAccessToken1234567890";
const APP_SECRET = "app-secret-value-123";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const message: OutgoingTemplate = {
  to: "918957926677",
  templateName: "website_intro",
  language: "en",
  bodyParams: [{ value: "ERA University" }, { value: "Lucknow" }],
  callbackData: "att_123",
};

describe("config & numbers", () => {
  it("defaults to the log provider and validates Meta settings", () => {
    expect(parseWhatsAppConfig({})).toEqual({ provider: "log" });
    expect(() => parseWhatsAppConfig({ WHATSAPP_PROVIDER: "meta" })).toThrow("META_WA_ACCESS_TOKEN, META_WA_PHONE_NUMBER_ID");
    expect(() => parseWhatsAppConfig({ WHATSAPP_PROVIDER: "meta", META_WA_ACCESS_TOKEN: "x", META_WA_PHONE_NUMBER_ID: "abc" })).toThrow("numeric");
    expect(() => parseWhatsAppConfig({ META_WA_API_VERSION: "26" })).toThrow("v26.0");
    expect(parseWhatsAppConfig({ WHATSAPP_PROVIDER: "meta", META_WA_ACCESS_TOKEN: "x", META_WA_PHONE_NUMBER_ID: "106540352242922" })).toMatchObject({
      provider: "meta",
      apiVersion: "v26.0",
      endpoint: "messages",
    });
  });

  it("formats WhatsApp recipients and rejects numbers that cannot be WhatsApp users", () => {
    expect(toWhatsAppNumber("089579 26677")).toBe("918957926677");
    expect(toWhatsAppNumber("+1 (415) 555-0100")).toBe("14155550100");
    expect(toWhatsAppNumber("1800 123 4567")).toBeNull(); // toll-free
    expect(toWhatsAppNumber("12345")).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
  });
});

describe("MetaWhatsAppProvider.sendTemplate", () => {
  it("sends the documented Cloud API request", async () => {
    const fetchImpl = vi.fn(async () => json(200, { messaging_product: "whatsapp", contacts: [{ input: "918957926677", wa_id: "918957926677" }], messages: [{ id: "wamid.ABC" }] }));
    const p = new MetaWhatsAppProvider({ accessToken: TOKEN, phoneNumberId: "106540352242922", fetchImpl });
    expect(await p.sendTemplate(message)).toEqual({ externalMessageId: "wamid.ABC" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/106540352242922/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "918957926677",
      type: "template",
      template: {
        name: "website_intro",
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: "ERA University" }, { type: "text", text: "Lucknow" }] }],
      },
      biz_opaque_callback_data: "att_123",
    });
  });

  it("supports named parameters, no-parameter templates and the Marketing Messages endpoint", async () => {
    const fetchImpl = vi.fn(async () => json(200, { messages: [{ id: "wamid.X" }] }));
    const p = new MetaWhatsAppProvider({ accessToken: TOKEN, phoneNumberId: "1", endpoint: "marketing_messages", apiVersion: "v25.0", fetchImpl });
    await p.sendTemplate({ ...message, bodyParams: [{ name: "business_name", value: "ERA" }] });
    let [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v25.0/1/marketing_messages");
    let body = JSON.parse(init.body as string);
    expect(body.template.components[0].parameters).toEqual([{ type: "text", parameter_name: "business_name", text: "ERA" }]);
    expect(body.product_policy).toBe("CLOUD_API_FALLBACK");

    await p.sendTemplate({ ...message, templateName: "hello_world", language: "en_US", bodyParams: [] });
    [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    body = JSON.parse(init.body as string);
    expect(body.template).toEqual({ name: "hello_world", language: { code: "en_US" } });
  });

  it("classifies Meta errors (rate limits retryable; spam restriction and bad token not) and never leaks the token", async () => {
    const cases: [Response | Error, boolean, string][] = [
      [json(400, { error: { message: "Cloud API message throughput has been reached.", code: 130429 } }), true, "throughput"],
      [json(400, { error: { message: "Too many messages to this user", code: 131056 } }), true, "Too many"],
      [json(400, { error: { message: "Spam rate limit hit", code: 131048 } }), false, "quality rating"],
      [json(401, { error: { message: "Error validating access token", code: 190 } }), false, "META_WA_ACCESS_TOKEN"],
      [json(400, { error: { message: "Template name does not exist", code: 132001, error_data: { details: "website_intro (en)" } } }), false, "website_intro (en)"],
      [json(503, {}), true, "HTTP 503"],
      [new TypeError("fetch failed"), true, "Could not reach WhatsApp"],
    ];
    for (const [outcome, retryable, text] of cases) {
      const fetchImpl = vi.fn(async () => {
        if (outcome instanceof Error) throw outcome;
        return outcome;
      });
      const err = await new MetaWhatsAppProvider({ accessToken: TOKEN, phoneNumberId: "1", fetchImpl }).sendTemplate(message).catch((e) => e);
      expect(err).toBeInstanceOf(WhatsAppProviderError);
      expect(err.retryable, text).toBe(retryable);
      expect(err.message).toContain(text);
      expect(err.message).not.toContain(TOKEN);
    }
  });
});

describe("Meta webhooks", () => {
  const provider = new MetaWhatsAppProvider({ accessToken: TOKEN, phoneNumberId: "1", appSecret: APP_SECRET, verifyToken: "my-verify-token" });
  const sign = (body: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              statuses: [
                { id: "wamid.A", status: "delivered", timestamp: "1749416383", recipient_id: "918957926677", biz_opaque_callback_data: "att_1" },
                { id: "wamid.B", status: "failed", timestamp: "1749416390", recipient_id: "919000000000", errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Not a WhatsApp user" } }] },
                { id: "wamid.C", status: "played", timestamp: "1749416390" },
              ],
              messages: [{ from: "918957926677", id: "wamid.IN1", timestamp: "1749416400", type: "text", text: { body: "Yes, interested" }, context: { id: "wamid.A" } }],
            },
          },
        ],
      },
    ],
  });

  it("verifies the subscription challenge", () => {
    expect(provider.verifySubscription({ "hub.mode": "subscribe", "hub.verify_token": "my-verify-token", "hub.challenge": "1158201444" })).toBe("1158201444");
    expect(provider.verifySubscription({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" })).toBeNull();
    expect(new MetaWhatsAppProvider({ accessToken: TOKEN, phoneNumberId: "1" }).verifySubscription({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" })).toBeNull();
  });

  it("parses signed status and reply events", async () => {
    const events = await provider.handleWebhook({ headers: { "x-hub-signature-256": sign(payload) }, body: payload });
    expect(events).toEqual([
      expect.objectContaining({ kind: "status", providerEventId: "wamid.A:delivered", externalMessageId: "wamid.A", status: "delivered", callbackData: "att_1", error: null, occurredAt: new Date(1749416383000) }),
      expect.objectContaining({ kind: "status", status: "failed", error: "131026: Message undeliverable: Not a WhatsApp user" }),
      expect.objectContaining({ kind: "inbound", providerEventId: "wamid.IN1", from: "918957926677", text: "Yes, interested", inReplyTo: "wamid.A", messageType: "text" }),
    ]);
  });

  it("reads button and list replies, strips '+' from senders, and skips other business numbers", async () => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1" },
                messages: [
                  { from: "+918957926677", id: "wamid.B1", timestamp: "1749416400", type: "button", button: { payload: "Yes", text: "Yes, call me" }, context: { id: "wamid.A" } },
                  { from: "918957926677", id: "wamid.B2", timestamp: "1749416401", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "x", title: "Website" } } },
                  { from: "918957926677", id: "wamid.B3", timestamp: "1749416402", type: "image", image: { id: "media" } },
                ],
              },
            },
            { field: "messages", value: { metadata: { phone_number_id: "2" }, messages: [{ from: "1", id: "wamid.OTHER", type: "text", text: { body: "x" } }] } },
          ],
        },
      ],
    });
    const events = await provider.handleWebhook({ headers: { "x-hub-signature-256": sign(body) }, body });
    expect(events.map((e) => (e.kind === "inbound" ? [e.from, e.text, e.messageType] : null))).toEqual([
      ["918957926677", "Yes, call me", "button"],
      ["918957926677", "Website", "interactive"],
      ["918957926677", null, "image"],
    ]);
  });

  it("rejects missing, wrong or tampered signatures", async () => {
    for (const headers of [{}, { "x-hub-signature-256": sign(payload, "other-secret") }, { "x-hub-signature-256": "sha256=00" }]) {
      await expect(provider.handleWebhook({ headers, body: payload })).rejects.toBeInstanceOf(WhatsAppWebhookRejected);
    }
    await expect(provider.handleWebhook({ headers: { "x-hub-signature-256": sign(payload) }, body: payload.replace("interested", "not interested") })).rejects.toBeInstanceOf(WhatsAppWebhookRejected);
    const noSecret = new MetaWhatsAppProvider({ accessToken: TOKEN, phoneNumberId: "1" });
    await expect(noSecret.handleWebhook({ headers: { "x-hub-signature-256": sign(payload) }, body: payload })).rejects.toThrow("META_WA_APP_SECRET");
  });
});

describe("WhatsApp API", () => {
  async function app(overrides: Parameters<typeof createTestApp>[0] = {}, deps: Parameters<typeof createTestApp>[1] = {}) {
    const t = await createTestApp(overrides, deps);
    const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
    return { t, auth: { authorization: `Bearer ${res.json().token}` } };
  }

  it("send-test with the log provider records the message; validates input", async () => {
    const log = new LogWhatsAppProvider();
    const { t, auth } = await app({}, { whatsappProvider: log });
    try {
      expect((await t.app.inject({ method: "GET", url: "/api/whatsapp/provider" })).statusCode).toBe(401);
      expect((await t.app.inject({ method: "GET", url: "/api/whatsapp/provider", headers: auth })).json()).toMatchObject({ provider: "log", sendsRealMessages: false });

      const ok = await t.app.inject({
        method: "POST",
        url: "/api/whatsapp/send-test",
        headers: auth,
        payload: { to: "+91 89579 26677", templateName: "hello_world", language: "en_US" },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ sentReal: false, to: "+918957926677" });
      expect(log.outbox[0]).toMatchObject({ to: "918957926677", templateName: "hello_world", language: "en_US", bodyParams: [] });

      for (const payload of [
        { to: "12345", templateName: "hello_world", language: "en_US" },
        { to: "1800 123 4567", templateName: "hello_world", language: "en_US" },
        { to: "+918957926677", templateName: "Hello World", language: "en_US" },
        { to: "+918957926677", templateName: "hello_world", language: "english" },
      ]) {
        expect((await t.app.inject({ method: "POST", url: "/api/whatsapp/send-test", headers: auth, payload })).statusCode, JSON.stringify(payload)).toBe(400);
      }
    } finally {
      await t.close();
    }
  });

  it("Meta: masks the token, shows the webhook URL, maps provider errors to 502", async () => {
    const fetchImpl = vi.fn(async () => json(400, { error: { message: "Template name does not exist", code: 132001 } }));
    const meta = new MetaWhatsAppProvider({ accessToken: TOKEN, phoneNumberId: "106540352242922", appSecret: APP_SECRET, verifyToken: "my-verify-token", fetchImpl });
    const { t, auth } = await app(
      {
        publicBaseUrl: "https://leads.acme.in",
        whatsapp: { provider: "meta", accessToken: TOKEN, phoneNumberId: "106540352242922", appSecret: APP_SECRET, verifyToken: "my-verify-token", apiVersion: "v26.0", endpoint: "messages" },
      },
      { whatsappProvider: meta },
    );
    try {
      const info = await t.app.inject({ method: "GET", url: "/api/whatsapp/provider", headers: auth });
      expect(info.json()).toMatchObject({
        provider: "meta",
        sendsRealMessages: true,
        details: { phoneNumberId: "106540352242922", accessToken: "••••7890" },
        webhook: { url: "https://leads.acme.in/api/webhooks/whatsapp/meta", verifyTokenSet: true, appSecretSet: true },
      });
      expect(info.body).not.toContain(TOKEN);
      expect(info.body).not.toContain(APP_SECRET);

      const send = await t.app.inject({ method: "POST", url: "/api/whatsapp/send-test", headers: auth, payload: { to: "+918957926677", templateName: "website_intro", language: "en" } });
      expect(send.statusCode).toBe(502);
      expect(send.json().error).toMatchObject({ code: "WHATSAPP_PROVIDER_ERROR" });

      // Webhook endpoints are public but verified.
      const ok = await t.app.inject({ method: "GET", url: "/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=my-verify-token&hub.challenge=987654" });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toBe("987654");
      expect((await t.app.inject({ method: "GET", url: "/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1" })).statusCode).toBe(403);

      const body = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.A", status: "sent", timestamp: "1749416383" }] } }] }] });
      const signed = await t.app.inject({
        method: "POST",
        url: "/api/webhooks/whatsapp/meta",
        headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}` },
        payload: body,
      });
      expect(signed.json()).toMatchObject({ received: 1 });
      const forged = await t.app.inject({ method: "POST", url: "/api/webhooks/whatsapp/meta", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" }, payload: body });
      expect(forged.statusCode).toBe(401);
      expect((await t.app.inject({ method: "GET", url: "/api/webhooks/whatsapp/gupshup?hub.mode=subscribe" })).statusCode).toBe(404);
    } finally {
      await t.close();
    }
  });
});
