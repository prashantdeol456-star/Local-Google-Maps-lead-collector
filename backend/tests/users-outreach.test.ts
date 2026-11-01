import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unsubscribeUrl } from "../src/services/email/unsubscribe.js";
import { createTestApp } from "./helpers.js";

// Phase B: templates, opt-outs, contacts and campaigns belong to each user.

const SECRET = "test-secret-test-secret-test-secret-123"; // same as helpers.ts

let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };

const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, headers: Record<string, string>, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

async function customer(name: string) {
  await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${name}@shop.in`, phone: "9876543210", username: name, password: `${name}-password-1` } });
  const id = ((await req("GET", `/api/users?q=${name}`, superAuth)).json().items[0] as { id: string }).id;
  await req("POST", `/api/users/${id}/approve`, superAuth);
  const token = (await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: name, password: `${name}-password-1` } })).json().token as string;
  return { id, auth: { authorization: `Bearer ${token}` } };
}

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  superAuth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("each user's own outreach", () => {
  it("keeps templates, campaigns, opt-outs and contacts apart, and customers cannot send yet", async () => {
    const a = await customer("outreach_a");
    const b = await customer("outreach_b");

    // Templates
    const tpl = (await req("POST", "/api/templates", a.auth, { name: "Intro", subject: "Hi {{name}}", body: "Hello {{name}}" })).json().template;
    expect(tpl.id).toBeTruthy();
    expect((await req("GET", "/api/templates", b.auth)).json().items).toEqual([]);
    expect((await req("GET", "/api/templates", a.auth)).json().items.map((x: { id: string }) => x.id)).toEqual([tpl.id]);
    expect((await req("GET", `/api/templates/${tpl.id}`, b.auth)).statusCode).toBe(404);

    // Campaign from A's own leads
    const lead = (await req("POST", "/api/leads", a.auth, { lead: { name: "Clinic A", email: "hello@clinic-a.in" } })).json().lead;
    const created = await req("POST", "/api/email/campaigns", a.auth, {
      name: "A's campaign",
      templateId: tpl.id,
      recipients: { leadIds: [lead.id] },
      intervalSec: 30,
      dailyLimit: 100,
      windowStart: "00:00",
      windowEnd: "23:59",
    });
    expect(created.statusCode, created.body).toBeLessThan(300);
    const campaign = created.json().campaign;
    expect((await req("GET", `/api/email/campaigns/${campaign.id}`, b.auth)).statusCode).toBe(404);
    expect((await req("GET", `/api/email/campaigns/${campaign.id}`, a.auth)).statusCode).toBe(200);
    // B cannot build a campaign on A's template
    const foreign = await req("POST", "/api/email/campaigns", b.auth, { name: "x", templateId: tpl.id, recipients: { leadIds: [] }, intervalSec: 30, dailyLimit: 10, windowStart: "00:00", windowEnd: "23:59" });
    expect(foreign.statusCode).toBeGreaterThanOrEqual(400);

    // Sending waits for the user's own sender (phase C)
    const start = await req("POST", `/api/email/campaigns/${campaign.id}/start`, a.auth);
    expect(start.statusCode).toBe(403);
    expect(start.json().error.code).toBe("SENDER_REQUIRED");
    expect((await req("POST", "/api/email/send-test", a.auth, { to: "me@shop.in" })).json().error.code).toBe("SENDER_REQUIRED");
    expect((await req("POST", "/api/whatsapp/send-test", a.auth, { to: "+919800000000" })).json().error.code).toBe("SENDER_REQUIRED");
    // Provider settings of the platform stay hidden
    expect((await req("GET", "/api/email/provider", a.auth)).statusCode).toBe(403);

    // Opt-out lists: the same address can be on both, each list shows only its own
    const add = (auth: Record<string, string>) => req("POST", "/api/opt-outs", auth, { channel: "email", addresses: "nope@x.in", reason: "Asked to stop" });
    expect((await add(a.auth)).json().added).toBe(1);
    expect((await add(b.auth)).json().added).toBe(1);
    expect((await req("GET", "/api/opt-outs", a.auth)).json().total).toBe(1);
    const aEntry = (await req("GET", "/api/opt-outs", a.auth)).json().items[0];
    expect((await req("DELETE", `/api/opt-outs/${aEntry.id}`, b.auth, { note: "they asked again" })).statusCode).toBe(404);

    // Contacts (sheets)
    const csv = ["Name,LinkedIn URL,Contact Number,Email,Designation,Company", "Ravi,https://www.linkedin.com/in/ravi-x,9800000001,ravi@x.in,HR,Acme"].join("\n");
    const up = (auth: Record<string, string>) => req("POST", "/api/contacts/import", auth, { fileName: "c.csv", data: Buffer.from(csv).toString("base64") });
    expect((await up(a.auth)).statusCode).toBe(200);
    expect((await up(b.auth)).statusCode).toBe(200); // same LinkedIn URL is fine for another user
    expect((await req("GET", "/api/contacts", a.auth)).json().total).toBe(1);
    expect((await req("GET", "/api/contacts", b.auth)).json().total).toBe(1);

    // Super admin sees everything, or one user's with the view header
    expect((await req("GET", "/api/opt-outs", superAuth)).json().total).toBeGreaterThanOrEqual(2);
    expect((await req("GET", "/api/opt-outs", { ...superAuth, "x-view-owner": b.id })).json().total).toBe(1);
  });

  it("an unsubscribe from a customer's lead lands in that customer's opt-out list", async () => {
    const c = await customer("unsub_owner");
    const lead = (await req("POST", "/api/leads", c.auth, { lead: { name: "Shop C", email: "owner@shop-c.in" } })).json().lead;
    const url = new URL(unsubscribeUrl("https://leads.example.in", SECRET, lead.id));
    const res = await t.app.inject({ method: "POST", url: url.pathname, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "List-Unsubscribe=One-Click" });
    expect(res.statusCode).toBeLessThan(300);

    const list = (await req("GET", "/api/opt-outs", c.auth)).json();
    expect(list.items.map((s: { address: string }) => s.address)).toEqual(["owner@shop-c.in"]);
    const row = await t.db.suppression.findFirstOrThrow({ where: { address: "owner@shop-c.in" } });
    expect(row.ownerId).toBe(c.id);
    const pref = await t.db.leadCommunicationPreference.findUnique({ where: { leadId: lead.id } });
    expect(pref?.ownerId).toBe(c.id);
  });
});
