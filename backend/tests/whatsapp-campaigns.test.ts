import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../src/database/repositories/index.js";
import { WhatsAppWorker } from "../src/jobs/whatsappWorker.js";
import { LogWhatsAppProvider } from "../src/providers/whatsapp/log.js";
import { WhatsAppProviderError, type OutgoingTemplate } from "../src/providers/whatsapp/types.js";
import { providerBody, renderWhatsApp } from "../src/services/whatsapp/templateParams.js";
import { createTestApp } from "./helpers.js";

const ist = (time: string, day = "2026-10-06") => new Date(`${day}T${time}:00+05:30`);

/** Log provider whose next sends can be made to fail. */
class TestProvider extends LogWhatsAppProvider {
  failures: WhatsAppProviderError[] = [];
  override async sendTemplate(message: OutgoingTemplate) {
    const next = this.failures.shift();
    if (next) throw next;
    return super.sendTemplate(message);
  }
}

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
const provider = new TestProvider();
let clock = ist("11:00");
let worker: WhatsAppWorker;
let n = 0;

async function lead(data: Record<string, unknown> = {}) {
  n++;
  const name = (data.name as string) ?? `Lead ${n}`;
  return t.db.lead.create({ data: { name, normalizedName: name.toLowerCase(), dedupeKey: `w:${n}`, city: "Lucknow", category: "University", ...data } });
}

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

const optIn = (leadId: string, source = "Asked for details on a call, 6 Oct") => call("POST", `/api/leads/${leadId}/whatsapp-opt-in`, { source });

const TEMPLATE = {
  name: "website_intro",
  language: "en",
  category: "marketing",
  paramFormat: "positional",
  body: "Hello {{name}}, we help {{category|businesses}} in {{city}} get more enquiries. Reply STOP to opt out.",
  approvalStatus: "approved",
};

async function template(extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/whatsapp/templates", { ...TEMPLATE, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().template as { id: string; name: string };
}

async function campaign(leadIds: string[], templateId?: string, extra: Record<string, unknown> = {}) {
  return call("POST", "/api/whatsapp/campaigns", {
    name: "University WhatsApp",
    templateId: templateId ?? (await template()).id,
    recipients: { leadIds },
    intervalSec: 120,
    dailyLimit: 20,
    windowStart: "10:00",
    windowEnd: "18:00",
    ...extra,
  });
}

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
  await t.db.contactAttempt.deleteMany();
  await t.db.campaign.deleteMany();
  await t.db.messageTemplate.deleteMany();
  await t.db.leadCommunicationPreference.deleteMany();
  await t.db.lead.deleteMany();
  provider.outbox.length = 0;
  provider.failures = [];
  clock = ist("11:00");
});

describe("template parameters", () => {
  const body = "Hi {{name}}! {{city | your city}} has many {{category}}. Bye {{name}}.";

  it("maps distinct variables to {{1}}, {{2}}… in order of first use, or keeps names", () => {
    expect(providerBody(body, "positional")).toBe("Hi {{1}}! {{2}} has many {{3}}. Bye {{1}}.");
    expect(providerBody(body, "named")).toBe("Hi {{name}}! {{city}} has many {{category}}. Bye {{name}}.");
  });

  it("fills values, uses fallbacks, flattens whitespace and reports missing values", () => {
    const r = renderWhatsApp({ body, paramFormat: "positional" }, { name: "ERA\nUniversity  ", city: null, category: "" });
    expect(r.params).toEqual([{ value: "ERA University" }, { value: "your city" }, { value: "" }]);
    expect(r.missing).toEqual(["category"]);
    expect(r.text).toBe("Hi ERA University! your city has many . Bye ERA University.");

    const named = renderWhatsApp({ body, paramFormat: "named" }, { name: "A", city: "Agra", category: "Schools" });
    expect(named.params).toEqual([{ name: "name", value: "A" }, { name: "city", value: "Agra" }, { name: "category", value: "Schools" }]);
    expect(named.missing).toEqual([]);
  });
});

describe("WhatsApp templates API", () => {
  it("validates the template name, numbered placeholders and unknown variables", async () => {
    expect((await call("POST", "/api/whatsapp/templates", { ...TEMPLATE, name: "Website Intro" })).statusCode).toBe(400);
    const numbered = await call("POST", "/api/whatsapp/templates", { ...TEMPLATE, body: "Hello {{1}}" });
    expect(numbered.statusCode).toBe(400);
    expect(numbered.json().error.message).toContain("{{name}}");
    const unknown = await call("POST", "/api/whatsapp/templates", { ...TEMPLATE, body: "Hello {{firstName}}" });
    expect(unknown.json().error.message).toContain("{{firstName}}");
    expect((await call("POST", "/api/whatsapp/templates", { ...TEMPLATE, body: "x".repeat(1025) })).statusCode).toBe(400);
  });

  it("creates, lists separately from email templates, previews and logs approval changes", async () => {
    const tpl = await template({ approvalStatus: "pending" });
    expect((await call("GET", "/api/whatsapp/templates")).json().items).toHaveLength(1);
    expect((await call("GET", "/api/templates")).json().items).toHaveLength(0);
    expect((await call("GET", `/api/templates/${tpl.id}`)).statusCode).toBe(404);

    const l = await lead({ name: "ERA University", category: null });
    const preview = (await call("POST", "/api/whatsapp/templates/preview", { body: TEMPLATE.body, paramFormat: "positional", leadId: l.id })).json();
    expect(preview.text).toBe("Hello ERA University, we help businesses in Lucknow get more enquiries. Reply STOP to opt out.");
    expect(preview.providerBody).toBe("Hello {{1}}, we help {{2}} in {{3}} get more enquiries. Reply STOP to opt out.");

    const updated = await call("PATCH", `/api/whatsapp/templates/${tpl.id}`, { approvalStatus: "approved" });
    expect(updated.json().template.approvalStatus).toBe("approved");
    const logs = await t.db.agentLog.findMany({ where: { action: "whatsapp_template_status" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.message)).toEqual(['"website_intro" (en): new → pending', '"website_intro" (en): pending → approved']);
  });
});

describe("WhatsApp opt-in", () => {
  it("records how the lead opted in, and can be withdrawn", async () => {
    const l = await lead({ phone: "089579 26677" });
    expect((await call("POST", `/api/leads/${l.id}/whatsapp-opt-in`, { source: "" })).statusCode).toBe(400);
    const res = await optIn(l.id);
    expect(res.json().preference).toMatchObject({ whatsappAllowed: true, whatsappOptInSource: "Asked for details on a call, 6 Oct" });
    expect(res.json().preference.whatsappOptInAt).toBeTruthy();

    const withdrawn = await call("DELETE", `/api/leads/${l.id}/whatsapp-opt-in`, { reason: "Asked us to stop" });
    expect(withdrawn.json().preference.whatsappAllowed).toBe(false);
    expect((await call("POST", "/api/leads/nope/whatsapp-opt-in", { source: "phone call" })).statusCode).toBe(404);
  });

  it("refuses an opt-in for a lead that opted out of everything", async () => {
    const l = await lead({ phone: "089579 26677" });
    await t.db.leadCommunicationPreference.create({ data: { leadId: l.id, optedOut: true } });
    expect((await optIn(l.id)).statusCode).toBe(409);
  });
});

describe("WhatsApp campaign recipients", () => {
  it("only includes leads with a recorded opt-in and a usable mobile number", async () => {
    const tpl = await template();
    const ok = await lead({ phone: "089579 26677" });
    const noOptIn = await lead({ phone: "098765 43210" });
    const noPhone = await lead({ phone: null });
    const tollFree = await lead({ phone: "1800 123 4567" });
    const withdrawn = await lead({ phone: "091234 56789" });
    const samePhone = await lead({ phone: "+91 89579 26677" });
    const noCity = await lead({ phone: "099999 11111", city: null });
    for (const l of [ok, withdrawn, samePhone, noCity, tollFree, noPhone]) await optIn(l.id);
    await call("DELETE", `/api/leads/${withdrawn.id}/whatsapp-opt-in`);

    const ids = [ok, noOptIn, noPhone, tollFree, withdrawn, samePhone, noCity].map((l) => l.id);
    const summary = (await call("POST", "/api/whatsapp/campaigns/recipients", { recipients: { leadIds: ids }, templateId: tpl.id })).json();
    expect(summary).toEqual({
      selected: 7,
      eligible: 1,
      skipped: { noPhone: 2, noOptIn: 1, optedOut: 1, duplicatePhone: 1, missingValue: 1 },
    });
  });

  it("needs an approved WhatsApp template and at least one eligible lead", async () => {
    const l = await lead({ phone: "089579 26677" });
    const pending = await template({ approvalStatus: "pending" });
    const res = await campaign([l.id], pending.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TEMPLATE_NOT_APPROVED");

    const email = (await call("POST", "/api/templates", { name: "Intro", subject: "Hi", body: "Hello" })).json().template;
    expect((await campaign([l.id], email.id)).statusCode).toBe(400);

    const noOptIn = await campaign([l.id]);
    expect(noOptIn.statusCode).toBe(400);
    expect(noOptIn.json().error.message).toContain("opt-in");
  });

  it("creates a draft with one queued message per opted-in lead, separate from email campaigns", async () => {
    const a = await lead({ phone: "089579 26677" });
    const b = await lead({ phone: "098765 43210" });
    await optIn(a.id);
    const res = await campaign([a.id, b.id]);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().summary.eligible).toBe(1);
    const id = res.json().campaign.id;
    expect(res.json().campaign).toMatchObject({ channel: "whatsapp", status: "draft", provider: "log" });

    const attempts = (await call("GET", `/api/whatsapp/campaigns/${id}/attempts`)).json();
    expect(attempts.items).toMatchObject([{ leadId: a.id, toAddress: "+918957926677", status: "queued", channel: "whatsapp" }]);
    expect((await call("GET", `/api/email/campaigns/${id}`)).statusCode).toBe(404);
    expect((await call("GET", "/api/email/campaigns")).json().total).toBe(0);
    expect((await call("GET", "/api/whatsapp/campaigns")).json().total).toBe(1);
  });
});

describe("WhatsApp worker", () => {
  async function running(count: number) {
    const leads = [];
    for (let i = 0; i < count; i++) {
      const l = await lead({ name: `College ${i}`, phone: `098765 4321${i}` });
      await optIn(l.id);
      leads.push(l);
    }
    const created = await campaign(leads.map((l) => l.id));
    const id = created.json().campaign.id as string;
    expect((await call("POST", `/api/whatsapp/campaigns/${id}/start`)).statusCode).toBe(200);
    const c = (await t.db.campaign.findUnique({ where: { id } }))!;
    return { id, c, leads };
  }

  it("sends the approved template with lead values, one per interval, then completes", async () => {
    const { id, c } = await running(2);
    expect(await worker.step(c)).toBe("sent");
    expect(provider.outbox[0]).toMatchObject({
      to: "919876543210",
      templateName: "website_intro",
      language: "en",
      bodyParams: [{ value: "College 0" }, { value: "University" }, { value: "Lucknow" }],
    });
    const first = (await call("GET", `/api/whatsapp/campaigns/${id}/attempts?status=sent`)).json().items[0];
    expect(provider.outbox[0]!.callbackData).toBe(first.id);
    expect(first.renderedBody).toBe("Hello College 0, we help University in Lucknow get more enquiries. Reply STOP to opt out.");

    expect(await worker.step(c)).toBe("waiting"); // 120 s interval
    clock = ist("11:02");
    expect(await worker.step(c)).toBe("sent");
    expect(await worker.step(c)).toBe("completed");
    expect((await call("GET", `/api/whatsapp/campaigns/${id}`)).json().campaign.status).toBe("completed");
    expect((await call("GET", "/api/stats")).json().whatsappSent).toBe(2);
  });

  it("skips a lead whose opt-in was withdrawn after the campaign was created", async () => {
    const { c, leads } = await running(1);
    await call("DELETE", `/api/leads/${leads[0]!.id}/whatsapp-opt-in`);
    expect(await worker.step(c)).toBe("skipped");
    expect(provider.outbox).toHaveLength(0);
    expect((await t.db.contactAttempt.findFirst())!.error).toContain("opted out");
  });

  it("pauses the campaign when the template is no longer approved, without using up the message", async () => {
    const { id, c } = await running(1);
    const tplId = c.templateId;
    await call("PATCH", `/api/whatsapp/templates/${tplId}`, { approvalStatus: "paused" });
    expect(await worker.step(c)).toBe("paused");
    expect(provider.outbox).toHaveLength(0);
    const detail = (await call("GET", `/api/whatsapp/campaigns/${id}`)).json();
    expect(detail.campaign).toMatchObject({ status: "paused" });
    expect(detail.campaign.statusReason).toContain("no longer marked approved");
    expect(detail.counts).toEqual({ queued: 1 });

    // Resuming is refused until the template is approved again.
    expect((await call("POST", `/api/whatsapp/campaigns/${id}/start`)).json().error.code).toBe("TEMPLATE_NOT_APPROVED");
    await call("PATCH", `/api/whatsapp/templates/${tplId}`, { approvalStatus: "approved" });
    expect((await call("POST", `/api/whatsapp/campaigns/${id}/start`)).statusCode).toBe(200);
    clock = ist("11:02"); // the paused try still counts toward the interval
    expect(await worker.step(c)).toBe("sent");
  });

  it("pauses on account/template errors from WhatsApp, retries rate limits, fails bad numbers", async () => {
    const { id, c } = await running(3);
    provider.failures.push(new WhatsAppProviderError("WhatsApp: template does not exist", false, 404, 132001));
    expect(await worker.step(c)).toBe("paused");
    let detail = (await call("GET", `/api/whatsapp/campaigns/${id}`)).json();
    expect(detail.campaign.statusReason).toContain("template does not exist");
    expect(detail.counts).toEqual({ queued: 3 });

    await call("POST", `/api/whatsapp/campaigns/${id}/start`);
    clock = ist("11:02");
    provider.failures.push(new WhatsAppProviderError("WhatsApp: rate limit", true, 400, 130429));
    expect(await worker.step(c)).toBe("retry_later");
    clock = ist("11:04");
    provider.failures.push(new WhatsAppProviderError("WhatsApp: not a WhatsApp number", false, 400, 131026));
    expect(await worker.step(c)).toBe("failed");
    detail = (await call("GET", `/api/whatsapp/campaigns/${id}`)).json();
    expect(detail.campaign.status).toBe("running");
    expect(detail.counts).toEqual({ queued: 2, failed: 1 });
  });

  it("records an opt-out when the recipient stopped marketing messages (131050)", async () => {
    const { c, leads } = await running(1);
    provider.failures.push(new WhatsAppProviderError("WhatsApp: recipient stopped marketing messages", false, 400, 131050));
    expect(await worker.step(c)).toBe("failed");
    const pref = await t.db.leadCommunicationPreference.findUnique({ where: { leadId: leads[0]!.id } });
    expect(pref!.whatsappAllowed).toBe(false);
  });

  it("does not start a campaign created for a different provider", async () => {
    const { id } = await running(1);
    await call("POST", `/api/whatsapp/campaigns/${id}/pause`);
    await t.db.campaign.update({ where: { id }, data: { provider: "meta" } });
    const res = await call("POST", `/api/whatsapp/campaigns/${id}/start`);
    expect(res.json().error.code).toBe("PROVIDER_CHANGED");
  });

  it("after a crash only fails the WhatsApp messages left in sending", async () => {
    const { id } = await running(1);
    const l = await lead({ email: "a@b.in" });
    const tpl = (await call("POST", "/api/templates", { name: "Intro", subject: "Hi", body: "Hello" })).json().template;
    const emailCampaign = await t.db.campaign.create({ data: { channel: "email", name: "e", templateId: tpl.id, provider: "log" } });
    await t.db.contactAttempt.create({ data: { leadId: l.id, campaignId: emailCampaign.id, channel: "email", provider: "log", toAddress: "a@b.in", status: "sending" } });
    await t.db.contactAttempt.updateMany({ where: { campaignId: id }, data: { status: "sending" } });

    expect(await worker.recover()).toBe(1);
    expect((await t.db.contactAttempt.findFirst({ where: { campaignId: id } }))!.status).toBe("failed");
    expect((await t.db.contactAttempt.findFirst({ where: { campaignId: emailCampaign.id } }))!.status).toBe("sending");
  });
});
