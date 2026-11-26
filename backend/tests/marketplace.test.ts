import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanMobile, indiamartTime, leadFromRecord, parseIstTime } from "../src/services/marketplace/portals.js";
import { createTestApp } from "./helpers.js";

// Marketplace leads: IndiaMART / TradeIndia / other portal enquiries pulled with the user's own key.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const calls: URL[] = [];
let indiamartCode = 200;

const fakePortals = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  calls.push(url);
  if (url.hostname === "mapi.indiamart.com") {
    if (indiamartCode !== 200) return json({ CODE: indiamartCode, STATUS: "FAILURE", MESSAGE: "Invalid key, please check your CRM key" });
    return json({
      CODE: 200,
      STATUS: "SUCCESS",
      TOTAL_RECORDS: 2,
      RESPONSE: [
        { UNIQUE_QUERY_ID: "2001", QUERY_TYPE: "W", QUERY_TIME: "2026-11-25 10:15:00", SENDER_NAME: "Ramesh Gupta", SENDER_MOBILE: "+91-9810012345", SENDER_EMAIL: "Ramesh@Traders.in", SENDER_COMPANY: "Gupta Traders", SENDER_CITY: "Delhi", SENDER_STATE: "Delhi", SENDER_COUNTRY_ISO: "IN", QUERY_PRODUCT_NAME: "Mobile Phone", QUERY_MESSAGE: "Need 50 units, best price?", RECEIVER_MOBILE: "9999999999" },
        { UNIQUE_QUERY_ID: "2002", QUERY_TYPE: "B", QUERY_TIME: "2026-11-25 11:00:00", SENDER_NAME: "Anita Shah", SENDER_MOBILE: "9822000111", SENDER_EMAIL: "", QUERY_PRODUCT_NAME: "Laptop", QUERY_MESSAGE: "Bulk order" },
      ],
    });
  }
  if (url.hostname === "www.tradeindia.com") {
    return json([{ rfi_id: "T-77", sender_name: "Vikram", sender_mobile: "9811100000", sender_co: "VK Exports", sender_city: "Mumbai", subject: "Inquiry for cables", message: "Send catalogue", generated_date: "2026-11-25", generated_time: "09:00:00" }]);
  }
  if (url.hostname === "portal.example.com") return json({ status: "ok", data: [{ inquiry_id: "E1", buyer_name: "Sara", mobile: "+971 50 123 4567", email: "sara@buy.ae", product: "Spices", requirement: "20 kg" }] });
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };

async function customer(name: string) {
  await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${name}@shop.in`, phone: "9876543210", username: name, password: `${name}-password-1` } });
  const id = ((await t.app.inject({ method: "GET", url: `/api/users?q=${name}`, headers: superAuth })).json().items[0] as { id: string }).id;
  await t.app.inject({ method: "POST", url: `/api/users/${id}/approve`, headers: superAuth });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: name, password: `${name}-password-1` } });
  const c = res.cookies.find((x) => x.name === "mlc_session")!;
  return { id, session: { cookie: `${c.name}=${c.value}` } };
}

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 }, { portalFetch: fakePortals });
  superAuth = { authorization: `Bearer ${(await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } })).json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("reading portal answers", () => {
  it("uses IndiaMART's time format, Indian time and the usual field names", () => {
    expect(indiamartTime(new Date("2026-11-25T04:45:00Z"))).toBe("25-Nov-202610:15:00");
    expect(parseIstTime("2026-11-25 10:15:00")!.toISOString()).toBe("2026-11-25T04:45:00.000Z");
    expect(cleanMobile("+91-9810012345")).toBe("+919810012345");
    expect(cleanMobile("9822000111")).toBe("+919822000111");
    expect(leadFromRecord({ inquiry_id: "E1", buyer_name: "Sara", requirement: "20 kg" })).toMatchObject({ externalId: "E1", name: "Sara", message: "20 kg" });
    expect(leadFromRecord({ foo: "bar" })).toBeNull();
  });
});

describe("marketplace leads", () => {
  it("pulls IndiaMART enquiries once, adds them to Contacts and sends the WhatsApp template", async () => {
    const a = await customer("mp_a");
    const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => t.app.inject({ method, url, headers: a.session, ...(payload !== undefined ? { payload: payload as object } : {}) });
    // The customer's own WhatsApp number (test sender) and an approved template.
    expect((await req("PUT" as "POST", "/api/senders/whatsapp", { provider: "log" })).statusCode).toBe(200);
    const tpl = (await req("POST", "/api/whatsapp/templates", { name: "enquiry_thanks", language: "en", category: "utility", paramFormat: "positional", approvalStatus: "approved", body: "Hi {{name|there}}, thanks for your enquiry. Sharing details here." })).json().template;
    const existing = await t.db.outreachContact.create({ data: { ownerId: a.id, name: "Ramesh G", phone: "98100 12345", listName: "Old" } });

    expect((await req("POST", "/api/marketplace/sources", { kind: "indiamart", config: {} })).statusCode).toBe(400);
    const created = await req("POST", "/api/marketplace/sources", { kind: "indiamart", config: { key: "CRMKEY123456789" }, waTemplateId: tpl.id });
    expect(created.statusCode, created.body).toBe(200);
    const source = created.json().source;
    expect(source).toMatchObject({ name: "IndiaMART", configHint: "…6789" });
    expect(created.body).not.toContain("CRMKEY");

    const pulled = await req("POST", `/api/marketplace/sources/${source.id}/pull`);
    expect(pulled.json()).toEqual({ added: 2 });
    const call = calls.find((u) => u.hostname === "mapi.indiamart.com")!;
    expect(call.searchParams.get("glusr_crm_key")).toBe("CRMKEY123456789");
    expect(call.searchParams.get("start_time")).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4}\d{2}:\d{2}:\d{2}$/);

    const { items, today } = (await req("GET", "/api/marketplace/leads")).json();
    expect(items.map((l: { name: string }) => l.name)).toEqual(["Anita Shah", "Ramesh Gupta"]);
    const ramesh = items.find((l: { name: string }) => l.name === "Ramesh Gupta");
    expect(ramesh).toMatchObject({ mobile: "+919810012345", email: "ramesh@traders.in", company: "Gupta Traders", product: "Mobile Phone", contactId: existing.id, followUp: "sent" });
    expect(ramesh.waChatId).toBeTruthy();
    expect(today).toBeGreaterThanOrEqual(0);
    // A new person goes to Contacts under the portal's name; the WhatsApp chat is in All messages.
    expect(await t.db.outreachContact.findFirst({ where: { ownerId: a.id, name: "Anita Shah", listName: "IndiaMART" } })).not.toBeNull();
    expect(await t.db.waChat.count({ where: { ownerId: a.id } })).toBe(2);

    // Within 5 minutes: not again (IndiaMART's rule); later: the same enquiries are not saved twice.
    expect((await req("POST", `/api/marketplace/sources/${source.id}/pull`)).statusCode).toBe(409);
    await t.db.marketplaceSource.update({ where: { id: source.id }, data: { lastPolledAt: new Date(Date.now() - 6 * 60_000) } });
    expect((await req("POST", `/api/marketplace/sources/${source.id}/pull`)).json()).toEqual({ added: 0 });

    // A wrong key shows on the source.
    indiamartCode = 401;
    await t.db.marketplaceSource.update({ where: { id: source.id }, data: { lastPolledAt: new Date(Date.now() - 6 * 60_000) } });
    expect((await req("POST", `/api/marketplace/sources/${source.id}/pull`)).json().error.message).toMatch(/Invalid key/);
    expect((await req("GET", "/api/marketplace/sources")).json().items[0]).toMatchObject({ status: "error", leads: 2 });
    indiamartCode = 200;

    const csv = await req("GET", "/api/marketplace/leads/export.csv");
    expect(csv.body).toContain("Ramesh Gupta");
  });

  it("reads TradeIndia and other portals' API links, per user", async () => {
    const b = await customer("mp_b");
    const req = (method: "GET" | "POST", url: string, payload?: unknown) => t.app.inject({ method, url, headers: b.session, ...(payload !== undefined ? { payload: payload as object } : {}) });
    const ti = (await req("POST", "/api/marketplace/sources", { kind: "tradeindia", config: { userId: "123", profileId: "456", key: "abcdef123456" } })).json().source;
    expect((await req("POST", `/api/marketplace/sources/${ti.id}/pull`)).json()).toEqual({ added: 1 });
    const call = calls.find((u) => u.hostname === "www.tradeindia.com")!;
    expect([call.searchParams.get("userid"), call.searchParams.get("profile_id"), call.searchParams.get("key")]).toEqual(["123", "456", "abcdef123456"]);

    expect((await req("POST", "/api/marketplace/sources", { kind: "custom", name: "ExportersIndia", config: { url: "http://portal.example.com/api" } })).statusCode).toBe(400);
    const other = (await req("POST", "/api/marketplace/sources", { kind: "custom", name: "ExportersIndia", config: { url: "https://portal.example.com/api?k=SECRET" } })).json().source;
    expect((await req("POST", `/api/marketplace/sources/${other.id}/pull`)).json()).toEqual({ added: 1 });

    const items = (await req("GET", "/api/marketplace/leads")).json().items as { name: string; company: string | null; mobile: string | null }[];
    expect(items.map((l) => l.name).sort()).toEqual(["Sara", "Vikram"]);
    expect(items.find((l) => l.name === "Vikram")).toMatchObject({ company: "VK Exports", mobile: "+919811100000" });
    expect(await t.db.outreachContact.findFirst({ where: { ownerId: b.id, name: "Sara", listName: "ExportersIndia" } })).not.toBeNull();
    // B sees none of A's enquiries.
    expect(items.some((l) => l.name === "Ramesh Gupta")).toBe(false);
  });
});
