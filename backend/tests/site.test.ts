import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// Public website (before login) and per-customer service access.

let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000, publicBaseUrl: "https://lead.example.in" });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  superAuth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("public website", () => {
  it("serves indexable pages with titles, descriptions, canonical URLs and structured data", async () => {
    for (const path of ["/", "/features", "/pricing", "/about", "/contact", "/privacy", "/terms"]) {
      const res = await t.app.inject({ method: "GET", url: path });
      expect(res.statusCode, path).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toMatch(/<title>[^<]+<\/title>/);
      expect(res.body).toContain('<meta name="description"');
      expect(res.body).toContain(`<link rel="canonical" href="https://lead.example.in${path}">`);
      expect(res.body).toContain('type="application/ld+json"');
      expect(res.body).not.toContain("<script src");
    }
    const home = (await t.app.inject({ method: "GET", url: "/" })).body;
    expect(home).toContain('"@type":"FAQPage"');
    expect(home).toContain("₹0.50");
    expect(home).toContain('href="/admin/register"');

    const sitemap = await t.app.inject({ method: "GET", url: "/sitemap.xml" });
    expect(sitemap.body).toContain("<loc>https://lead.example.in/pricing</loc>");
    const robots = (await t.app.inject({ method: "GET", url: "/robots.txt" })).body;
    expect(robots).toContain("Disallow: /admin/");
    expect(robots).toContain("Sitemap: https://lead.example.in/sitemap.xml");
  });

  it("uses the editable contact details, escaped", async () => {
    const res = await t.app.inject({
      method: "PUT",
      url: "/api/site/settings",
      headers: superAuth,
      payload: { brandName: "Acme <Leads>", contactEmail: "hello@acme.in", contactPhone: "+91 98765 43210", address: "Hazratganj, Lucknow" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const page = (await t.app.inject({ method: "GET", url: "/contact" })).body;
    expect(page).toContain("Acme &lt;Leads&gt;");
    expect(page).not.toContain("Acme <Leads>");
    expect(page).toContain('href="mailto:hello@acme.in"');
    expect(page).toContain("Hazratganj, Lucknow");
    expect(page).toContain('href="tel:+919876543210"');
    expect(page).not.toContain("Follow us"); // no social links yet

    const bad = await t.app.inject({ method: "PUT", url: "/api/site/settings", headers: superAuth, payload: { linkedinUrl: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);
    await t.app.inject({ method: "PUT", url: "/api/site/settings", headers: superAuth, payload: { linkedinUrl: "https://www.linkedin.com/company/acme" } });
    const home = (await t.app.inject({ method: "GET", url: "/" })).body;
    expect(home).toContain("Follow us");
    expect(home).toContain('href="https://www.linkedin.com/company/acme"');
  });

  it("stores contact form messages for super admins, ignores bots, and validates", async () => {
    const post = (body: Record<string, string>) =>
      t.app.inject({ method: "POST", url: "/contact", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams(body).toString() });
    const ok = await post({ name: "Ravi Kumar", email: "Ravi@Shop.in", phone: "9876543210", message: "Please share a demo" });
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe("/contact?sent=1");
    expect((await post({ name: "Bot", email: "bot@x.in", message: "spam spam", website: "http://spam" })).statusCode).toBe(303);
    const bad = await post({ name: "R", email: "not-an-email", message: "hi there" });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("notice--err");
    expect(bad.body).toContain('value="R"'); // keeps what was typed

    const list = (await t.app.inject({ method: "GET", url: "/api/site/messages", headers: superAuth })).json();
    expect(list.items.map((m: { email: string }) => m.email)).toEqual(["ravi@shop.in"]);
    expect(list.unread).toBe(1);
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const count = async (q: string) => (await t.app.inject({ method: "GET", url: `/api/site/messages?${q}`, headers: superAuth })).json().total;
    expect(await count(`from=${day(-1)}&to=${day(1)}`)).toBe(1);
    expect(await count(`from=${day(3)}`)).toBe(0);
    await t.app.inject({ method: "POST", url: `/api/site/messages/${list.items[0].id}/read`, headers: superAuth });
    expect((await t.app.inject({ method: "GET", url: "/api/site/messages", headers: superAuth })).json().unread).toBe(0);
  });
});

describe("service access per customer", () => {
  it("lets super admins switch services off, which closes their API, menu data and extension downloads", async () => {
    await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "svc@shop.in", phone: "9876543210", username: "svc_user", password: "svc-password-1" } });
    const id = ((await t.app.inject({ method: "GET", url: "/api/users?q=svc_user", headers: superAuth })).json().items[0] as { id: string }).id;
    await t.app.inject({ method: "POST", url: `/api/users/${id}/approve`, headers: superAuth });
    const login = async () => {
      const token = (await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: "svc_user", password: "svc-password-1" } })).json().token;
      return { authorization: `Bearer ${token}` };
    };
    let auth = await login();
    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", headers: auth })).json().admin.services).toContain("linkedin");

    const set = await t.app.inject({ method: "PUT", url: `/api/users/${id}/services`, headers: superAuth, payload: { services: ["google_maps", "email"] } });
    expect(set.json().user.services).toEqual(["google_maps", "email"]);
    auth = await login();

    const blocked = await t.app.inject({ method: "GET", url: "/api/linkedin/facets", headers: auth });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("SERVICE_DISABLED");
    expect((await t.app.inject({ method: "GET", url: "/api/inbox/conversations", headers: auth })).json().error.code).toBe("SERVICE_DISABLED");
    expect((await t.app.inject({ method: "GET", url: "/api/leads", headers: auth })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/api/email/campaigns", headers: auth })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/api/opt-outs", headers: auth })).statusCode).toBe(200); // always available

    expect((await t.app.inject({ method: "PUT", url: `/api/users/${id}/services`, headers: superAuth, payload: { services: ["teleport"] } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "PUT", url: `/api/users/${id}/services`, headers: auth, payload: { services: ["linkedin"] } })).statusCode).toBe(403);
    const services = (await t.app.inject({ method: "GET", url: "/api/services", headers: superAuth })).json().items;
    expect(services.map((s: { id: string }) => s.id)).toContain("ai_inbox");
  });
});
