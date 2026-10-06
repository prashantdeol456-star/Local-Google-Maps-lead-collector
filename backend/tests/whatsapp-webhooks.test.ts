import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../src/database/repositories/index.js";
import { WhatsAppWorker } from "../src/jobs/whatsappWorker.js";
import { MetaWhatsAppProvider } from "../src/providers/whatsapp/meta.js";
import { isStopMessage } from "../src/services/whatsapp/trackingService.js";
import { createTestApp } from "./helpers.js";

const APP_SECRET = "app-secret-value-123";
const NUMBER_ID = "106540352242922";
const ist = (time: string) => new Date(`2026-10-06T${time}:00+05:30`);
const unix = (time: string) => String(ist(time).getTime() / 1000);

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
let worker: WhatsAppWorker;
let clock = ist("11:00");
let sent = 0;
/** Runs inside the fake Graph API call, before the send returns (to test webhook races). */
let duringSend: ((body: { biz_opaque_callback_data?: string }, wamid: string) => Promise<void>) | null = null;

const provider = new MetaWhatsAppProvider({
  accessToken: "EAAGtestToken1234567890",
  phoneNumberId: NUMBER_ID,
  appSecret: APP_SECRET,
  verifyToken: "my-verify-token",
  fetchImpl: async (_url, init) => {
    const wamid = `wamid.OUT${++sent}`;
    await duringSend?.(JSON.parse(String(init?.body)), wamid);
    return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: wamid }] }), { status: 200, headers: { "content-type": "application/json" } });
  },
});

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

/** POSTs a signed Meta webhook with one change. */
async function webhook(value: Record<string, unknown>, field = "messages", opts: { numberId?: string; secret?: string } = {}) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          { field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550783881", phone_number_id: opts.numberId ?? NUMBER_ID }, ...value } },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac("sha256", opts.secret ?? APP_SECRET).update(body).digest("hex")}`;
  return t.app.inject({
    method: "POST",
    url: "/api/webhooks/whatsapp/meta",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    payload: body,
  });
}

const status = (id: string, s: string, time: string, extra: Record<string, unknown> = {}) =>
  webhook({ statuses: [{ id, status: s, timestamp: unix(time), recipient_id: "919876543210", ...extra }] });

const reply = (from: string, text: string, time: string, extra: Record<string, unknown> = {}) =>
  webhook({
    contacts: [{ profile: { name: "Ravi" }, wa_id: from }],
    messages: [{ from, id: `wamid.IN${from}${time}${text.length}`, timestamp: unix(time), type: "text", text: { body: text }, ...extra }],
  });

let n = 0;
async function lead(phone: string, optIn = true) {
  n++;
  const res = await call("POST", "/api/leads", { lead: { name: `College ${n}`, category: "University", city: "Lucknow", phone } });
  const id = res.json().lead.id as string;
  if (optIn) await call("POST", `/api/leads/${id}/whatsapp-opt-in`, { source: "Asked for details on a call" });
  return id;
}

/** Running campaign to the given leads; returns its id. */
async function campaign(leadIds: string[]) {
  const tpl = (
    await call("POST", "/api/whatsapp/templates", {
      name: "website_intro",
      language: "en",
      category: "marketing",
      paramFormat: "positional",
      body: "Hello {{name}}, we build websites in {{city}}. Reply STOP to opt out.",
      approvalStatus: "approved",
    })
  ).json().template;
  const res = await call("POST", "/api/whatsapp/campaigns", {
    name: "Webhook test",
    templateId: tpl.id,
    recipients: { leadIds },
    intervalSec: 60,
    dailyLimit: 50,
    windowStart: "10:00",
    windowEnd: "18:00",
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = res.json().campaign.id as string;
  await call("POST", `/api/whatsapp/campaigns/${id}/start`);
  return id;
}

async function sendNext(id: string) {
  const c = (await t.db.campaign.findUnique({ where: { id } }))!;
  const result = await worker.step(c);
  clock = new Date(clock.getTime() + 60_000);
  return result;
}

const attemptOf = (leadId: string) => t.db.contactAttempt.findFirstOrThrow({ where: { leadId } });
const prefOf = (leadId: string) => t.db.leadCommunicationPreference.findUniqueOrThrow({ where: { leadId } });

beforeAll(async () => {
  t = await createTestApp({}, { whatsappProvider: provider });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };
  worker = new WhatsAppWorker(createRepositories(t.db), provider, { now: () => clock });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.whatsAppEvent.deleteMany();
  await t.db.contactAttempt.deleteMany();
  await t.db.campaign.deleteMany();
  await t.db.messageTemplate.deleteMany();
  await t.db.leadCommunicationPreference.deleteMany();
  await t.db.jobItem.deleteMany();
  await t.db.lead.deleteMany();
  clock = ist("11:00");
  duringSend = null;
  sent = 0;
});

describe("STOP keywords", () => {
  it("only whole-message stop requests count", () => {
    for (const text of ["STOP", "stop.", " Stop! ", "Unsubscribe", "opt out", "Stop promotions"]) expect(isStopMessage(text)).toBe(true);
    for (const text of ["please stop calling me, send details here", "Don't stop", "stopwatch", "", null]) expect(isStopMessage(text)).toBe(false);
  });
});

describe("WhatsApp webhooks", () => {
  it("tracks delivered, read and a reply on the message and the lead's timeline; retries are ignored", async () => {
    const leadId = await lead("098765 43210");
    const id = await campaign([leadId]);
    expect(await sendNext(id)).toBe("sent");
    expect((await attemptOf(leadId)).externalMessageId).toBe("wamid.OUT1");

    expect((await status("wamid.OUT1", "sent", "11:00")).json()).toEqual({ received: 1, handled: 1 });
    expect((await status("wamid.OUT1", "delivered", "11:01")).json()).toEqual({ received: 1, handled: 1 });
    expect((await status("wamid.OUT1", "delivered", "11:01")).json()).toEqual({ received: 1, handled: 0 }); // Meta retry
    await status("wamid.OUT1", "read", "11:05");
    const res = await reply("919876543210", "Yes, please share the price", "11:07", { context: { from: "15550783881", id: "wamid.OUT1" } });
    expect(res.json()).toEqual({ received: 1, handled: 1 });

    const attempt = await attemptOf(leadId);
    expect(attempt).toMatchObject({ status: "delivered", deliveredAt: ist("11:01"), readAt: ist("11:05"), repliedAt: ist("11:07") });

    const history = (await call("GET", `/api/leads/${leadId}/communications`)).json();
    expect(history.whatsappEvents.map((e: { type: string }) => e.type)).toEqual(["received", "read", "delivered", "sent"]);
    expect(history.whatsappEvents[0]).toMatchObject({ text: "Yes, please share the price", phone: "+919876543210", attemptId: attempt.id });
    expect(history.whatsappEvents[0].metadata).toMatchObject({ profileName: "Ravi", inReplyTo: "wamid.OUT1" });

    const detail = (await call("GET", `/api/whatsapp/campaigns/${id}`)).json();
    expect(detail.tracking).toMatchObject({ deliveredAt: 1, readAt: 1, repliedAt: 1 });
    expect(detail.counts).toEqual({ delivered: 1 });
  });

  it("does not lose a delivery that arrives before the send is saved", async () => {
    const leadId = await lead("098765 43210");
    const id = await campaign([leadId]);
    duringSend = async (body, wamid) => {
      const res = await status(wamid, "delivered", "11:00", { biz_opaque_callback_data: body.biz_opaque_callback_data });
      expect(res.json().handled).toBe(1);
    };
    expect(await sendNext(id)).toBe("sent");
    expect(await attemptOf(leadId)).toMatchObject({ status: "delivered", externalMessageId: "wamid.OUT1", deliveredAt: ist("11:00") });
    expect((await attemptOf(leadId)).sentAt).toEqual(ist("11:00"));
  });

  it("failed: pauses the campaign on account errors, records an opt-out for 131050, otherwise fails one message", async () => {
    const a = await lead("098765 43210");
    const b = await lead("091234 56789");
    const c = await lead("099999 11111");
    const id = await campaign([a, b, c]);
    for (let i = 0; i < 3; i++) expect(await sendNext(id)).toBe("sent");

    await status("wamid.OUT1", "failed", "11:10", { errors: [{ code: 131026, title: "Message undeliverable" }] });
    expect((await attemptOf(a)).status).toBe("failed");
    expect((await t.db.campaign.findUniqueOrThrow({ where: { id } })).status).toBe("running");

    await status("wamid.OUT2", "failed", "11:11", { errors: [{ code: 131050, title: "User stopped marketing messages" }] });
    expect((await prefOf(b)).whatsappAllowed).toBe(false);

    await status("wamid.OUT3", "failed", "11:12", { errors: [{ code: 131048, title: "Spam rate limit hit" }] });
    const campaignRow = await t.db.campaign.findUniqueOrThrow({ where: { id } });
    expect(campaignRow.status).toBe("paused");
    expect(campaignRow.statusReason).toContain("131048: Spam rate limit hit");
    expect((await attemptOf(c)).error).toBe("131048: Spam rate limit hit");
  });

  it("a STOP reply withdraws the opt-in, so the next queued message is skipped; nothing is sent back", async () => {
    const leadId = await lead("098765 43210");
    const other = await lead("091234 56789");
    const id = await campaign([leadId, other]);
    expect(await sendNext(id)).toBe("sent");
    const sendsBefore = sent;

    await reply("919876543210", "Stop.", "11:03");
    expect((await prefOf(leadId)).whatsappAllowed).toBe(false);
    const types = (await t.db.whatsAppEvent.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } })).map((e) => e.type);
    expect(types).toEqual(["received", "opted_out"]);
    expect(sent).toBe(sendsBefore); // no automatic reply

    // The other lead still gets theirs; a new campaign would skip this lead.
    expect(await sendNext(id)).toBe("sent");
    const summary = (await call("POST", "/api/whatsapp/campaigns/recipients", { recipients: { leadIds: [leadId] } })).json();
    expect(summary.skipped.optedOut).toBe(1);
  });

  it("stop / resume of marketing messages in WhatsApp (user_preferences)", async () => {
    const leadId = await lead("098765 43210");
    const pref = (value: string, time: string) =>
      webhook(
        {
          contacts: [{ wa_id: "919876543210", profile: { name: "Ravi" } }],
          user_preferences: [{ wa_id: "919876543210", detail: "User requested", category: "marketing_messages", value, timestamp: Number(unix(time)) }],
        },
        "user_preferences",
      );
    expect((await pref("stop", "12:00")).json()).toEqual({ received: 1, handled: 1 });
    expect((await pref("stop", "12:00")).json()).toEqual({ received: 1, handled: 0 });
    expect((await prefOf(leadId)).whatsappAllowed).toBe(false);

    await pref("resume", "13:00");
    expect((await prefOf(leadId)).whatsappAllowed).toBe(false); // a new opt-in must be recorded by the admin
    const types = (await t.db.whatsAppEvent.findMany({ where: { leadId }, orderBy: { occurredAt: "asc" } })).map((e) => e.type);
    expect(types).toEqual(["opted_out", "marketing_resumed"]);
  });

  it("keeps messages from unknown numbers in the inbox; ignores other business numbers and test messages", async () => {
    await reply("14155550100", "Hi, who is this?", "11:00");
    const inbox = (await call("GET", "/api/whatsapp/inbox")).json();
    expect(inbox.total).toBe(1);
    expect(inbox.items[0]).toMatchObject({ phone: "+14155550100", leadId: null, leadName: null, text: "Hi, who is this?" });
    expect(inbox.items[0].metadata.profileName).toBe("Ravi");

    const foreign = await webhook({ messages: [{ from: "14155550100", id: "wamid.X", timestamp: unix("11:01"), type: "text", text: { body: "x" } }] }, "messages", {
      numberId: "999999",
    });
    expect(foreign.json()).toEqual({ received: 0, handled: 0 });

    const testMessage = await status("wamid.SENT_FROM_SETTINGS", "delivered", "11:02", { biz_opaque_callback_data: "test" });
    expect(testMessage.json()).toEqual({ received: 1, handled: 0 });
    expect(await t.db.whatsAppEvent.count()).toBe(1);
  });

  it("matches a reply without context to the last message sent to that number, or to the lead's phone", async () => {
    const withMessage = await lead("098765 43210");
    const id = await campaign([withMessage]);
    await sendNext(id);
    const noMessage = await lead("091234 56789", false);

    await reply("919876543210", "Interested", "11:05");
    await reply("919123456789", "Call me tomorrow", "11:06");
    expect((await attemptOf(withMessage)).repliedAt).toEqual(ist("11:05"));
    const inbox = (await call("GET", "/api/whatsapp/inbox")).json().items as { leadId: string; attemptId: string | null; leadName: string }[];
    expect(inbox.map((e) => [e.leadId, !!e.attemptId])).toEqual([
      [noMessage, false],
      [withMessage, true],
    ]);
  });

  it("rejects unsigned or wrongly signed webhooks without storing anything", async () => {
    expect((await reply("919876543210", "hi", "11:00").then(() => webhook({ messages: [] }, "messages", { secret: "wrong" }))).statusCode).toBe(401);
    const unsigned = await t.app.inject({ method: "POST", url: "/api/webhooks/whatsapp/meta", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(unsigned.statusCode).toBe(401);
    expect(await t.db.whatsAppEvent.count()).toBe(1); // only the signed one
  });
});
