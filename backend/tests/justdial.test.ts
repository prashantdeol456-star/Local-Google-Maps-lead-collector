import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JustdialService } from "../src/services/justdial/justdialService.js";
import { contactLinks, emailsIn, findWebsiteEmail, isPrivateAddress, isPublicWebUrl } from "../src/services/justdial/websiteEmail.js";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: auth, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

beforeAll(async () => {
  t = await createTestApp();
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.justdialJob.deleteMany();
  await t.db.contactAttempt.deleteMany();
  await t.db.campaign.deleteMany();
  await t.db.justdialDetail.deleteMany();
  await t.db.jobItem.deleteMany();
  await t.db.lead.deleteMany();
  await t.db.collectionJob.deleteMany();
});

describe("finding a business's email on its own website", () => {
  it("reads mailto links and text, and drops junk", () => {
    const html = `<a href="mailto:Info@GlobalExposure.in?subject=Hi">Mail</a> write to admissions [at] globalexposure.in
      <img src="logo@2x.png"> <script>var x="noreply@sentry.io"</script> user@example.com`;
    expect(emailsIn(html)).toEqual(["info@globalexposure.in", "admissions@globalexposure.in"]);
  });

  it("follows contact and about links on the same site only", () => {
    const html = `<a href="/contact-us">Contact</a><a href="https://other.com/contact">x</a><a href="/about">About us</a><a href="/blog">Blog</a>`;
    expect(contactLinks(html, "https://www.site.in/")).toEqual(["https://www.site.in/contact-us", "https://www.site.in/about"]);
  });

  it("never opens local or private addresses", async () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.2.3.4")).toBe(true);
    expect(isPrivateAddress("172.20.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.9")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("142.250.183.4")).toBe(false);
    const dns = (ip: string) => async () => [{ address: ip }];
    expect(await isPublicWebUrl("https://site.in/", dns("142.250.183.4"))).toBe(true);
    expect(await isPublicWebUrl("https://evil.example/", dns("127.0.0.1"))).toBe(false);
    expect(await isPublicWebUrl("http://localhost:3000/", dns("1.1.1.1"))).toBe(false);
    expect(await isPublicWebUrl("ftp://site.in/", dns("1.1.1.1"))).toBe(false);
    expect(await isPublicWebUrl("https://site.in:8443/", dns("1.1.1.1"))).toBe(false);
  });

  it("prefers an address on the site's own domain, from the contact page", async () => {
    const pages: Record<string, string> = {
      "https://www.site.in/": `<a href="/contact">Contact</a> <p>Partner: someone@gmail.com</p>`,
      "https://www.site.in/contact": `<a href="mailto:hello@site.in">hello@site.in</a>`,
    };
    const fetchText = async (url: string) => (pages[url] ? { url, html: pages[url]! } : null);
    expect(await findWebsiteEmail("https://www.site.in/", fetchText)).toBe("hello@site.in");
    expect(await findWebsiteEmail("https://down.site/", fetchText)).toBeNull();
  });
});

const lead = (i: number, extra: Record<string, unknown> = {}) => ({
  name: `Visa Consultant ${i}`,
  phone: `98100000${String(i).padStart(2, "0")}`,
  address: `Shop ${i}, Laxmi Nagar, Delhi 110092`,
  city: "Delhi",
  searchKeyword: "Study Visa Consultants",
  source: "justdial",
  ...extra,
});
const detail = (i: number) => ({
  docid: `011PXX11.XX11.${i}`,
  jdUrl: `https://www.justdial.com/Delhi/Visa-Consultant-${i}/011PXX11-XX11-${i}_BZDET`,
  jdPhone: "07947000000",
  jdRating: 4.5,
  jdReviewCount: 20 + i,
  categories: "Visa Assistance, Immigration Consultants",
  area: "Laxmi Nagar",
  established: "2012",
  photos: ["https://content.jdmagicbox.com/comp/delhi/a.jpg", "javascript:alert(1)"],
  mapsMatched: true,
  mapsName: `Visa Consultant ${i}`,
  mapsPhone: `98100000${String(i).padStart(2, "0")}`,
  mapsWebsite: `https://consultant${i}.in/`,
  mapsRating: 4.7,
});

describe("Justdial leads", () => {
  it("saves the lead with its Justdial and Google Maps details and lists them", async () => {
    const job = (await call("POST", "/api/jobs", { searchKeyword: "Study Visa Consultants", location: "Delhi" })).json().job;
    const res = await call("POST", "/api/leads", { jobId: job.id, clientKey: "jd:1", lead: lead(1, { website: "https://consultant1.in/" }), justdial: detail(1) });
    expect(res.statusCode).toBe(201);
    await call("POST", "/api/leads", { jobId: job.id, clientKey: "jd:2", lead: lead(2), justdial: { ...detail(2), mapsMatched: false } });

    const list = (await call("GET", "/api/justdial/leads")).json();
    expect(list.total).toBe(2);
    const one = list.items.find((l: { name: string }) => l.name === "Visa Consultant 1");
    expect(one.source).toBe("justdial");
    expect(one.justdial).toMatchObject({ jdRating: 4.5, categories: "Visa Assistance, Immigration Consultants", mapsMatched: true, mapsRating: 4.7 });
    expect(one.justdial.photos).toEqual(["https://content.jdmagicbox.com/comp/delhi/a.jpg"]); // only https links kept
    expect((await call("GET", "/api/justdial/leads?has=maps")).json().total).toBe(1);
    expect((await call("GET", "/api/justdial/leads?q=immigration")).json().total).toBe(2);
    const facets = (await call("GET", "/api/justdial/facets")).json();
    expect(facets).toMatchObject({ total: 2, withPhone: 2, withMaps: 1, keywords: [{ value: "Study Visa Consultants", count: 2 }] });

    // Google Maps leads are not mixed in…
    await call("POST", "/api/leads", { lead: { name: "Maps only bakery", phone: "9999900000" } });
    expect((await call("GET", "/api/justdial/leads")).json().total).toBe(2);
    // …unless the same business turns up on Justdial (matched by its Google place id).
    await call("POST", "/api/leads", { lead: { name: "Glow Dental", placeId: "ChIJglow", phone: "9888800000" } });
    const again = await call("POST", "/api/leads", { lead: lead(9, { name: "Glow Dental Clinic", placeId: "ChIJglow" }), justdial: detail(9) });
    expect(again.json().result).toBe("duplicate");
    expect((await call("GET", "/api/justdial/leads")).json().total).toBe(3);

    const csv = await call("GET", "/api/justdial/export.csv?has=maps");
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    const lines = csv.body.trim().split("\n");
    expect(lines[0]).toContain("Justdial rating");
    expect(lines).toHaveLength(3); // header + the two matched on Google Maps
    expect(csv.body).toContain("Visa Assistance, Immigration Consultants");
  });

  it("rejects bad details", async () => {
    const res = await call("POST", "/api/leads", { lead: lead(5), justdial: { ...detail(5), jdRating: 9 } });
    expect(res.statusCode).toBe(400);
  });

  it("finds emails on websites, then makes and starts the email campaign the user asked for", async () => {
    const job = (await call("POST", "/api/jobs", { searchKeyword: "Study Visa Consultants", location: "Delhi" })).json().job;
    await call("PATCH", `/api/jobs/${job.id}`, { status: "running" });
    await call("POST", "/api/leads", { jobId: job.id, clientKey: "jd:1", lead: lead(1, { website: "https://consultant1.in/" }), justdial: detail(1) });
    await call("POST", "/api/leads", { jobId: job.id, clientKey: "jd:2", lead: lead(2), justdial: { ...detail(2), mapsWebsite: null } });
    await call("POST", "/api/leads", { jobId: job.id, clientKey: "jd:3", lead: lead(3), justdial: detail(3) }); // website only from Maps

    const template = (await call("POST", "/api/templates", { name: "Intro", subject: "Hello {{name}}", body: "We help visa consultants." })).json().template;
    expect((await call("POST", `/api/justdial/jobs/${job.id}/auto-campaign`, { templateId: template.id })).statusCode).toBe(200);
    expect((await call("POST", `/api/justdial/jobs/${job.id}/auto-campaign`, { templateId: "nope" })).statusCode).toBe(400);
    await call("POST", `/api/justdial/jobs/${job.id}/auto-campaign`, { templateId: template.id });

    const checked: string[] = [];
    const service = new JustdialService(t.db, { findEmail: async (url) => (checked.push(url), url.includes("consultant1") ? "info@consultant1.in" : null) });
    await service.findEmails(10);
    expect(checked.sort()).toEqual(["https://consultant1.in/", "https://consultant3.in/"]);
    expect((await t.db.lead.findFirst({ where: { name: "Visa Consultant 1" } }))?.email).toBe("info@consultant1.in");

    // Nothing until the collection is finished.
    await t.app.justdialWorker.run();
    expect(await t.db.campaign.count()).toBe(0);

    await call("PATCH", `/api/jobs/${job.id}`, { status: "completed" });
    await t.app.justdialWorker.run();
    const campaign = await t.db.campaign.findFirst({ include: { attempts: true } });
    expect(campaign?.name).toMatch(/^Justdial: Study Visa Consultants in Delhi/);
    expect(campaign?.attempts.map((a) => a.toAddress)).toEqual(["info@consultant1.in"]);
    const jj = await t.db.justdialJob.findUnique({ where: { jobId: job.id } });
    expect(jj?.campaignId).toBe(campaign?.id);

    // Runs once only.
    await t.app.justdialWorker.run();
    expect(await t.db.campaign.count()).toBe(1);
  });

  it("notes why no campaign was made", async () => {
    const job = (await call("POST", "/api/jobs", { searchKeyword: "Study Visa Consultants" })).json().job;
    await call("POST", "/api/leads", { jobId: job.id, clientKey: "jd:7", lead: lead(7), justdial: { ...detail(7), mapsWebsite: null } });
    const template = (await call("POST", "/api/templates", { name: "Intro 2", subject: "Hello {{name}}", body: "Hi" })).json().template;
    await call("POST", `/api/justdial/jobs/${job.id}/auto-campaign`, { templateId: template.id });
    await call("PATCH", `/api/jobs/${job.id}`, { status: "running" });
    await call("PATCH", `/api/jobs/${job.id}`, { status: "completed" });
    await t.app.justdialWorker.run();
    expect(await t.db.campaign.count()).toBe(0);
    expect((await t.db.justdialJob.findUnique({ where: { jobId: job.id } }))?.note).toMatch(/No campaign: None of the selected leads can be emailed/);
  });
});

describe("Justdial leads per customer", () => {
  async function customer(name: string) {
    await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${name}@shop.in`, phone: "9876543210", username: name, password: `${name}-password-1` } });
    const id = ((await call("GET", `/api/users?q=${name}`)).json().items[0] as { id: string }).id;
    await call("POST", `/api/users/${id}/approve`);
    const token = (await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: name, password: `${name}-password-1` } })).json().token as string;
    return { authorization: `Bearer ${token}` };
  }

  it("lets each customer see only their own, and not touch another's collection", async () => {
    const a = await customer("jd_shop_a");
    const b = await customer("jd_shop_b");
    const as = (method: "GET" | "POST", url: string, who: Record<string, string>, payload?: unknown) =>
      t.app.inject({ method, url, headers: who, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

    const job = (await as("POST", "/api/jobs", a, { searchKeyword: "Study Visa Consultants", location: "Delhi" })).json().job;
    expect((await as("POST", "/api/leads", a, { jobId: job.id, clientKey: "jd:1", lead: lead(1), justdial: detail(1) })).statusCode).toBe(201);

    expect((await as("GET", "/api/justdial/leads", a)).json().total).toBe(1);
    expect((await as("GET", "/api/justdial/leads", b)).json().total).toBe(0);
    expect((await as("GET", "/api/justdial/export.csv", b)).statusCode).toBe(200);
    expect((await as("POST", `/api/justdial/jobs/${job.id}/auto-campaign`, b, { templateId: null })).statusCode).toBe(404);
    expect((await as("POST", `/api/justdial/jobs/${job.id}/auto-campaign`, a, { templateId: null })).statusCode).toBe(200);
  });
});
