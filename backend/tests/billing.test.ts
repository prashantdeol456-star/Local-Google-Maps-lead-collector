import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// Lead credits (free leads, paid leads, 402 when empty), manual credits, Razorpay recharge
// (checkout verification and webhook, credited once) and the platform Integrations page.

const KEY_SECRET = "test_key_secret_123";
const WEBHOOK_SECRET = "test_webhook_secret_456";
const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

// Fake Razorpay: orders get sequential ids; payments are "captured" for the amount ordered.
const orders = new Map<string, number>();
let orderSeq = 0;
const razorpayFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const auth = (init?.headers as Record<string, string>)?.authorization ?? "";
  if (auth !== `Basic ${Buffer.from(`rzp_test_Demo123:${KEY_SECRET}`).toString("base64")}`) return json({ error: { description: "Authentication failed" } }, 401);
  if (url.endsWith("/orders") && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as { amount: number };
    const id = `order_T${++orderSeq}`;
    orders.set(id, body.amount);
    return json({ id, amount: body.amount, currency: "INR", status: "created" });
  }
  const pay = url.match(/\/payments\/(pay_[A-Za-z0-9]+)$/);
  if (pay) {
    const orderId = `order_T${pay[1]!.replace("pay_P", "")}`;
    return json({ id: pay[1], order_id: orderId, amount: orders.get(orderId), currency: "INR", status: "captured", method: "upi" });
  }
  if (url.includes("/orders?count=1")) return json({ items: [] });
  return json({ error: { description: "not found" } }, 404);
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let sa: { authorization: string };
let cu: { authorization: string };
let customerId: string;

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000, publicBaseUrl: "https://lead.example.in" }, { razorpayFetch });
  const token = async (email: string, password: string) =>
    ({ authorization: `Bearer ${(await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email, password } })).json().token}` });
  sa = await token(t.credentials.email, t.credentials.password);
  await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "shop@billing.in", phone: "9876543210", username: "billing_shop", password: "billing-pass-1" } });
  customerId = (await t.app.inject({ method: "GET", url: "/api/users?q=billing_shop", headers: sa })).json().items[0].id;
  await t.app.inject({ method: "POST", url: `/api/users/${customerId}/approve`, headers: sa });
  cu = await token("billing_shop", "billing-pass-1");
});
afterAll(async () => {
  await t.close();
});

const call = (headers: { authorization: string }, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers, payload: payload as never });
const linkedin = (headers: { authorization: string }, slug: string) =>
  call(headers, "POST", "/api/linkedin/leads", { lead: { profileUrl: `https://www.linkedin.com/in/${slug}`, name: `Person ${slug}` } });
const credits = async () => (await call(cu, "GET", "/api/billing/me")).json().credits;

describe("lead credits", () => {
  it("uses free leads first, then the balance, and refuses new leads when both are empty", async () => {
    expect(await credits()).toMatchObject({ freeLeads: 1000, freeLeadsUsed: 0, freeLeadsLeft: 1000, balancePaise: 0, pricePerLeadPaise: 50 });
    await t.db.adminUser.update({ where: { id: customerId }, data: { freeLeadsUsed: 999 } });

    expect((await linkedin(cu, "free-one")).statusCode).toBe(201);
    expect(await credits()).toMatchObject({ freeLeadsLeft: 0, leadsLeft: 0 });

    const refused = await linkedin(cu, "no-credit");
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error.code).toBe("CREDIT_EXHAUSTED");
    expect(await t.db.linkedInLead.count({ where: { profileUrl: "https://www.linkedin.com/in/no-credit" } })).toBe(0);
    // A lead the customer already has is free
    expect((await linkedin(cu, "free-one")).statusCode).toBe(200);

    // Google Maps too (the extension keeps the record and retries after a recharge)
    const job = (await call(cu, "POST", "/api/jobs", { searchKeyword: "Cafe", location: "Noida" })).json().job;
    const maps = await call(cu, "POST", "/api/leads", { jobId: job.id, clientKey: "c1", lead: { name: "Blue Cafe", phone: "+91 98111 22233" } });
    expect(maps.statusCode).toBe(402);

    // Super admins credit ₹1 by hand → two paid leads
    const bad = await call(sa, "POST", `/api/billing/accounts/${customerId}/adjust`, { amountInr: 1, note: "" });
    expect(bad.statusCode).toBe(400);
    const adjust = await call(sa, "POST", `/api/billing/accounts/${customerId}/adjust`, { amountInr: 1, note: "Paid by bank transfer" });
    expect(adjust.json().entry).toMatchObject({ type: "manual_credit", amountPaise: 100, balanceAfterPaise: 100 });
    expect((await call(cu, "POST", "/api/leads", { jobId: job.id, clientKey: "c1", lead: { name: "Blue Cafe", phone: "+91 98111 22233" } })).statusCode).toBe(201);
    expect((await linkedin(cu, "paid-two")).statusCode).toBe(201);
    expect(await credits()).toMatchObject({ balancePaise: 0, leadsLeft: 0 });
    expect((await linkedin(cu, "paid-three")).statusCode).toBe(402);

    const ledger = (await call(cu, "GET", "/api/billing/me/entries")).json().items.map((e: { type: string; amountPaise: number }) => [e.type, e.amountPaise]);
    expect(ledger).toEqual([["lead_charge", -50], ["lead_charge", -50], ["manual_credit", 100]]);
    // A debit larger than the balance is refused
    expect((await call(sa, "POST", `/api/billing/accounts/${customerId}/adjust`, { amountInr: -5, note: "Correction" })).statusCode).toBe(400);
  });

  it("never charges super admins or Quick Send contacts", async () => {
    expect((await linkedin(sa, "admin-own")).statusCode).toBe(201);
    const quick = await call(cu, "POST", "/api/quick-send/contacts", { list: "Own list", contacts: [{ email: "own@list.in" }] });
    expect(quick.json().created).toBe(1);
  });

  it("keeps billing and integrations for super admins", async () => {
    expect((await call(cu, "GET", "/api/billing/payments")).statusCode).toBe(403);
    expect((await call(cu, "GET", "/api/platform-integrations")).statusCode).toBe(403);
    expect((await call(cu, "POST", `/api/billing/accounts/${customerId}/adjust`, { amountInr: 100, note: "self service" })).statusCode).toBe(403);
  });
});

describe("Razorpay recharge", () => {
  it("is off until a super admin saves the keys; secrets are never sent back", async () => {
    expect((await call(cu, "GET", "/api/billing/me")).json().razorpay).toEqual({ enabled: false });
    expect((await call(cu, "POST", "/api/billing/orders", { amountInr: 500 })).statusCode).toBe(400);

    expect((await call(sa, "PUT", "/api/platform-integrations/razorpay", { keyId: "rzp_test_Demo123", keySecret: "" })).statusCode).toBe(400);
    const saved = await call(sa, "PUT", "/api/platform-integrations/razorpay", { keyId: "rzp_test_Demo123", keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain(KEY_SECRET);
    expect(saved.json().razorpay).toMatchObject({ source: "panel", keyId: "rzp_test_Demo123", mode: "test", webhookSecretSet: true, webhookUrl: "https://lead.example.in/api/webhooks/razorpay" });
    // Saving again without secrets keeps them
    await call(sa, "PUT", "/api/platform-integrations/razorpay", { keyId: "rzp_test_Demo123" });
    expect((await call(sa, "POST", "/api/platform-integrations/razorpay/test")).json()).toEqual({ ok: true, mode: "test" });
    expect(JSON.stringify(await t.db.integrationSetting.findMany())).not.toContain(KEY_SECRET);
  });

  it("credits a verified checkout payment once", async () => {
    expect((await call(cu, "POST", "/api/billing/orders", { amountInr: 50 })).statusCode).toBe(400); // below the minimum
    const order = (await call(cu, "POST", "/api/billing/orders", { amountInr: 500 })).json();
    expect(order).toMatchObject({ amountPaise: 50000, keyId: "rzp_test_Demo123", prefill: { email: "shop@billing.in" } });
    const paymentId = `pay_P${order.orderId.replace("order_T", "")}`;

    const forged = await call(cu, "POST", "/api/billing/verify", { orderId: order.orderId, paymentId, signature: "0".repeat(64) });
    expect(forged.statusCode).toBe(400);
    expect(await credits()).toMatchObject({ balancePaise: 0 });

    const signature = hmac(KEY_SECRET, `${order.orderId}|${paymentId}`);
    const ok = await call(cu, "POST", "/api/billing/verify", { orderId: order.orderId, paymentId, signature });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().credits).toMatchObject({ balancePaise: 50000, leadsLeft: 1000 });
    await call(cu, "POST", "/api/billing/verify", { orderId: order.orderId, paymentId, signature });
    expect(await credits()).toMatchObject({ balancePaise: 50000 });
  });

  it("credits webhook payments once and rejects unsigned webhooks", async () => {
    const order = (await call(cu, "POST", "/api/billing/orders", { amountInr: 200 })).json();
    const paymentId = `pay_P${order.orderId.replace("order_T", "")}`;
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: order.orderId, amount: 20000, currency: "INR", status: "captured", method: "card" } } } });
    const post = (signature: string) =>
      t.app.inject({ method: "POST", url: "/api/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": signature }, payload: body });

    expect((await post("f".repeat(64))).statusCode).toBe(401);
    expect(await credits()).toMatchObject({ balancePaise: 50000 });
    expect((await post(hmac(WEBHOOK_SECRET, body))).statusCode).toBe(200);
    expect((await post(hmac(WEBHOOK_SECRET, body))).statusCode).toBe(200);
    expect(await credits()).toMatchObject({ balancePaise: 70000 });

    const overview = (await call(sa, "GET", "/api/billing/payments")).json();
    expect(overview.totals.allTime).toEqual({ paise: 70000, count: 2 });
    expect(overview.totals.today.paise).toBe(70000);
    expect(overview.items[0]).toMatchObject({ status: "paid", method: "card", user: { email: "shop@billing.in" } });
    const accounts = (await call(sa, "GET", "/api/billing/accounts?q=billing")).json();
    expect(accounts.items[0]).toMatchObject({ email: "shop@billing.in", paidPaise: 70000, credits: { balancePaise: 70000 } });
  });

  it("applies Meta app keys entered on the Integrations page right away", async () => {
    const res = await call(sa, "PUT", "/api/platform-integrations/meta", { appId: "123456789012", appSecret: "meta-secret-xyz" });
    expect(res.json().meta).toMatchObject({ source: "panel", appId: "123456789012", redirectUrl: "https://lead.example.in/api/oauth/callback/meta" });
    expect(res.body).not.toContain("meta-secret-xyz");
    const providers = (await call(sa, "GET", "/api/social/providers")).json();
    expect(JSON.stringify(providers)).toContain('"configured":true');
    await call(sa, "DELETE", "/api/platform-integrations/meta");
    expect((await call(sa, "GET", "/api/platform-integrations")).json().meta.source).toBeNull();
  });
});
