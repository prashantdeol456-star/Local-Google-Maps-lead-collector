import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../src/database/repositories/index.js";
import { EmailWorker } from "../src/jobs/emailWorker.js";
import { WhatsAppWorker } from "../src/jobs/whatsappWorker.js";
import { LogEmailProvider } from "../src/providers/email/log.js";
import { LogWhatsAppProvider } from "../src/providers/whatsapp/log.js";
import { unsubscribeUrl } from "../src/services/email/unsubscribe.js";
import { createTestApp } from "./helpers.js";

const SECRET = "test-secret-test-secret-test-secret-123"; // same as helpers.ts
const ist = (time: string) => new Date(`2026-10-06T${time}:00+05:30`);

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
const mailer = new LogEmailProvider("Acme <hi@acme.in>");
const wa = new LogWhatsAppProvider();
let emailWorker: EmailWorker;
let waWorker: WhatsAppWorker;

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

let n = 0;
async function lead(data: Record<string, unknown>) {
  n++;
  const res = await call("POST", "/api/leads", { lead: { name: `College ${n}`, city: "Lucknow", ...data } });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json().lead.id as string;
}

const emailSummary = async (leadIds: string[]) =>
  (await call("POST", "/api/email/campaigns/recipients", { recipients: { leadIds } })).json() as { eligible: number; skipped: { optedOut: number } };
const waSummary = async (leadIds: string[]) =>
  (await call("POST", "/api/whatsapp/campaigns/recipients", { recipients: { leadIds } })).json() as { eligible: number; skipped: { optedOut: number } };

async function unsubscribe(leadId: string) {
  const url = new URL(unsubscribeUrl("https://leads.acme.in", SECRET, leadId));
  return t.app.inject({ method: "POST", url: url.pathname, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "List-Unsubscribe=One-Click" });
}

beforeAll(async () => {
  t = await createTestApp({}, { emailProvider: mailer, whatsappProvider: wa });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };
  const repos = createRepositories(t.db);
  emailWorker = new EmailWorker(repos, mailer, { baseUrl: "https://leads.acme.in", unsubscribeSecret: SECRET, now: () => ist("11:00") });
  waWorker = new WhatsAppWorker(repos, wa, { now: () => ist("11:00") });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.suppression.deleteMany();
  await t.db.whatsAppEvent.deleteMany();
  await t.db.contactAttempt.deleteMany();
  await t.db.campaign.deleteMany();
  await t.db.messageTemplate.deleteMany();
  await t.db.leadCommunicationPreference.deleteMany();
  await t.db.jobItem.deleteMany();
  await t.db.lead.deleteMany();
  mailer.outbox.length = 0;
  wa.outbox.length = 0;
});

describe("opt-outs survive deleting and re-collecting a lead", () => {
  it("an unsubscribed email stays unsubscribed when the business is collected again", async () => {
    const first = await lead({ email: "Admissions@ERA.edu.in" });
    expect((await unsubscribe(first)).statusCode).toBe(200);
    const entries = (await call("GET", "/api/opt-outs?channel=email")).json();
    expect(entries.items).toMatchObject([{ address: "admissions@era.edu.in", source: "unsubscribe_link", leadId: first, leadName: "College 1" }]);

    await call("DELETE", `/api/leads/${first}`);
    const again = await lead({ email: "admissions@era.edu.in", phone: "098765 43210" });
    expect(await emailSummary([again])).toMatchObject({ eligible: 0, skipped: { optedOut: 1 } });
    expect((await call("GET", "/api/opt-outs?channel=email")).json().items[0].leadName).toBeNull(); // lead gone, entry kept
  });

  it("a STOP from a number that is not a lead yet blocks that number later, until a new opt-in is recorded", async () => {
    await t.db.whatsAppEvent.deleteMany();
    const repos = createRepositories(t.db);
    const { recordWhatsAppOptOut } = await import("../src/services/whatsapp/trackingService.js");
    await recordWhatsAppOptOut(repos, { leadId: null, phone: "+919876543210", reason: 'Replied "STOP"', provider: "keyword", occurredAt: new Date() });

    const leadId = await lead({ phone: "098765 43210" });
    expect((await call("GET", `/api/leads/${leadId}/preferences`)).json().suppressions.whatsapp).toMatchObject([{ source: "stop_reply" }]);
    // A recorded opt-in is a new, explicit consent: it lifts the old STOP for this number.
    await call("POST", `/api/leads/${leadId}/whatsapp-opt-in`, { source: "Asked us to message them, call on 7 Oct" });
    expect(await waSummary([leadId])).toMatchObject({ eligible: 1 });
    expect((await call("GET", `/api/leads/${leadId}/preferences`)).json().suppressions.whatsapp).toEqual([]);
  });
});

describe("lead preferences", () => {
  it("admin email opt-out and opt-in again (with a note)", async () => {
    const id = await lead({ email: "info@abc.in" });
    expect((await call("POST", `/api/leads/${id}/email-opt-out`, { reason: "" })).statusCode).toBe(400);
    const out = (await call("POST", `/api/leads/${id}/email-opt-out`, { reason: "Asked on the phone not to email" })).json();
    expect(out.preference).toMatchObject({ emailAllowed: false, optOutReason: "admin" });
    expect(out.suppressions.email).toMatchObject([{ address: "info@abc.in", reason: "Asked on the phone not to email", source: "admin" }]);
    expect(await emailSummary([id])).toMatchObject({ eligible: 0 });

    expect((await call("POST", `/api/leads/${id}/email-opt-in`, {})).statusCode).toBe(400);
    const back = (await call("POST", `/api/leads/${id}/email-opt-in`, { note: "Emailed us asking for the brochure" })).json();
    expect(back.preference.emailAllowed).toBe(true);
    expect(back.suppressions.email).toEqual([]);
    expect(await emailSummary([id])).toMatchObject({ eligible: 1 });
  });

  it("do-not-contact blocks every channel; clearing it keeps an earlier unsubscribe", async () => {
    const id = await lead({ email: "info@abc.in", phone: "098765 43210" });
    await call("POST", `/api/leads/${id}/whatsapp-opt-in`, { source: "Website enquiry form" });
    await unsubscribe(id);

    const dnc = (await call("POST", `/api/leads/${id}/do-not-contact`, { reason: "Asked for no contact at all" })).json();
    expect(dnc.preference).toMatchObject({ optedOut: true, optOutReason: "Asked for no contact at all" });
    expect(dnc.suppressions.whatsapp).toMatchObject([{ source: "do_not_contact" }]);
    expect(dnc.suppressions.email).toMatchObject([{ source: "unsubscribe_link" }]); // first reason kept
    expect(await waSummary([id])).toMatchObject({ eligible: 0, skipped: { optedOut: 1 } });
    expect((await call("POST", `/api/leads/${id}/email-opt-in`, { note: "asked again" })).json().error.code).toBe("DO_NOT_CONTACT");

    const cleared = (await call("DELETE", `/api/leads/${id}/do-not-contact`, { note: "Called back and asked for WhatsApp updates" })).json();
    expect(cleared.preference.optedOut).toBe(false);
    expect(cleared.suppressions.whatsapp).toEqual([]);
    expect(cleared.suppressions.email).toMatchObject([{ source: "unsubscribe_link" }]);
    expect(await waSummary([id])).toMatchObject({ eligible: 1 });
    expect(await emailSummary([id])).toMatchObject({ eligible: 0 });
  });
});

describe("suppression list", () => {
  it("adds pasted addresses (normalized, deduplicated, invalid ones reported), lists, searches and removes with a note", async () => {
    const res = await call("POST", "/api/opt-outs", {
      channel: "whatsapp",
      addresses: "098765 43210\n+91 98765 43210, 12345\n091234 56789",
      reason: "Do-not-disturb list from client",
    });
    expect(res.json()).toEqual({ added: 2, alreadySuppressed: 0, invalid: ["12345"] });
    expect((await call("POST", "/api/opt-outs", { channel: "whatsapp", addresses: "9876543210", reason: "again" })).json()).toMatchObject({ added: 0, alreadySuppressed: 1 });
    expect((await call("POST", "/api/opt-outs", { channel: "email", addresses: "A@B.in; not-an-email", reason: "Bounced list" })).json()).toMatchObject({ added: 1, invalid: ["not-an-email"] });

    const all = (await call("GET", "/api/opt-outs")).json();
    expect(all.total).toBe(3);
    expect(all.counts).toEqual({ email: 1, whatsapp: 2 });
    expect((await call("GET", "/api/opt-outs?q=98765")).json().items).toMatchObject([{ address: "+919876543210", source: "import" }]);

    const entry = (await call("GET", "/api/opt-outs?channel=email")).json().items[0];
    expect((await call("DELETE", `/api/opt-outs/${entry.id}`, {})).statusCode).toBe(400); // note required
    expect((await call("DELETE", `/api/opt-outs/${entry.id}`, { note: "They asked to be added back" })).json().removed.address).toBe("a@b.in");
    expect((await call("GET", "/api/opt-outs")).json().total).toBe(2);
    expect(await t.db.agentLog.count({ where: { action: "email_suppression_removed" } })).toBe(1);
  });

  it("messages already queued are skipped when their address is suppressed before sending", async () => {
    const e = await lead({ email: "info@abc.in" });
    const w = await lead({ phone: "098765 43210" });
    await call("POST", `/api/leads/${w}/whatsapp-opt-in`, { source: "Website enquiry form" });

    const emailTpl = (await call("POST", "/api/templates", { name: "Intro", subject: "Hi {{name}}", body: "Hello" })).json().template;
    const waTpl = (
      await call("POST", "/api/whatsapp/templates", { name: "intro", language: "en", category: "marketing", paramFormat: "positional", body: "Hello {{name}}", approvalStatus: "approved" })
    ).json().template;
    const pace = { intervalSec: 60, dailyLimit: 10, windowStart: "10:00", windowEnd: "18:00" };
    const ec = (await call("POST", "/api/email/campaigns", { name: "E", templateId: emailTpl.id, recipients: { leadIds: [e] }, ...pace })).json().campaign;
    const wc = (await call("POST", "/api/whatsapp/campaigns", { name: "W", templateId: waTpl.id, recipients: { leadIds: [w] }, ...pace })).json().campaign;
    await call("POST", `/api/email/campaigns/${ec.id}/start`);
    await call("POST", `/api/whatsapp/campaigns/${wc.id}/start`);

    await call("POST", "/api/opt-outs", { channel: "email", addresses: "INFO@abc.in", reason: "Client list" });
    await call("POST", "/api/opt-outs", { channel: "whatsapp", addresses: "+919876543210", reason: "Client list" });

    expect(await emailWorker.step((await t.db.campaign.findUniqueOrThrow({ where: { id: ec.id } })))).toBe("skipped");
    expect(await waWorker.step((await t.db.campaign.findUniqueOrThrow({ where: { id: wc.id } })))).toBe("skipped");
    expect(mailer.outbox).toHaveLength(0);
    expect(wa.outbox).toHaveLength(0);
  });
});
