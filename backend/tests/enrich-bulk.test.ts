import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnrichSheet } from "../src/services/enrich/bulkEnrich.js";
import { createTestApp } from "./helpers.js";

// Email finder → Bulk: a sheet of companies/people; websites first, Hunter within a budget.

const KEY = "hunter_test_key_0123456789abcdef";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let hunterUsed = 0;
const hunterCalls: string[] = [];

const fakeHunter = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const path = url.pathname.replace(/^\/v2\//, "");
  hunterCalls.push(path);
  if (path === "account") return json({ data: { plan_name: "Free", reset_date: "2026-12-20", requests: { credits: { used: hunterUsed, available: 50 } } } });
  if (path === "email-finder") {
    const found = url.searchParams.get("full_name") === "Ravi Kumar";
    if (found) hunterUsed++;
    return json({ data: { email: found ? "ravi@nosite.in" : null, score: 88 } });
  }
  return json({ errors: [{ details: "unexpected" }] }, 500);
}) as typeof fetch;

const SITES: Record<string, string> = {
  "https://acme.in": `<html><title>Acme</title><a href="/contact-us">Contact</a><p>Call +91 98100 12345</p></html>`,
  "https://acme.in/contact-us": `<html><a href="mailto:sales@acme.in">Mail</a> hr [at] acme [dot] in</html>`,
  "https://emptyco.in": `<html><p>Welcome</p></html>`,
};
const fakeSites = async (url: string) => (SITES[url] !== undefined ? { url, html: SITES[url]! } : null);

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 }, { hunterFetch: fakeHunter, siteFetch: fakeSites });
  const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: t.credentials.email, password: t.credentials.password } });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  await t.app.inject({ method: "PUT", url: "/api/enrich/hunter-key", headers: { cookie }, payload: { key: KEY } });
});
afterAll(async () => {
  await t.close();
});

describe("reading the sheet", () => {
  it("understands the usual column names and refuses sheets it cannot use", () => {
    const rows = parseEnrichSheet([["", ""], ["Full Name", "Company Name", "Web Site", "LinkedIn URL", "Job Title", "E-mail", "Mobile"], ["Asha Verma", "Acme", "acme.in", "", "HR", "", ""], ["", "", "", "", "", "", ""]]);
    expect(rows).toEqual([{ name: "Asha Verma", company: "Acme", website: "acme.in", linkedinUrl: null, designation: "HR", inputEmail: null, inputPhone: null }]);
    expect(() => parseEnrichSheet([["Name", "Email"], ["A", "a@x.in"]])).toThrow(/Website/);
  });
});

describe("bulk email finder", () => {
  it("reads websites first, asks Hunter within the job's budget, and exports or sends to Contacts", async () => {
    const sheet = ["Name,Company,Website,Designation", "Asha Verma,Acme,https://www.acme.in/about,HR Manager", "Ravi Kumar,No Site Pvt Ltd,,Owner", "Meena Rao,Empty Co,emptyco.in,", ",Unknown Co,,"].join("\n");
    const create = await t.app.inject({ method: "POST", url: "/api/enrich/jobs", headers: { cookie }, payload: { name: "Test sheet", fileName: "people.csv", data: b64(sheet), useWebsites: true, useHunter: true, hunterBudget: 1 } });
    expect(create.statusCode, create.body).toBe(200);
    const id = create.json().job.id as string;
    expect(create.json().job).toMatchObject({ total: 4, status: "running" });

    while (await t.app.bulkEnrich.step()) {
      const job = (await t.db.enrichJob.findUniqueOrThrow({ where: { id } })).status;
      if (job === "done") break;
    }
    const { job, rows } = (await t.app.inject({ method: "GET", url: `/api/enrich/jobs/${id}`, headers: { cookie } })).json();
    expect(job).toMatchObject({ status: "done", done: 4, found: 2, hunterUsed: 1 });

    const [asha, ravi, meena, unknown] = rows;
    // Website (home + Contact page): no Hunter needed.
    expect(asha.emails).toEqual([{ value: "sales@acme.in", source: "contact_page" }, { value: "hr@acme.in", source: "contact_page" }]);
    expect(asha.phones).toEqual([{ value: "+91 98100 12345", source: "website" }]);
    expect(asha.status).toBe("found");
    // No website: Hunter by name + company.
    expect(ravi).toMatchObject({ status: "found", emails: [{ value: "ravi@nosite.in", source: "hunter" }] });
    // Budget of 1 used up: no second Hunter request.
    expect(meena).toMatchObject({ status: "not_found" });
    expect(meena.note).toMatch(/budget/);
    expect(hunterCalls.filter((c) => c === "email-finder")).toHaveLength(1);
    expect(unknown.status).toBe("skipped");

    const csv = await t.app.inject({ method: "GET", url: `/api/enrich/jobs/${id}/export.csv`, headers: { cookie } });
    expect(csv.body).toContain("sales@acme.in; hr@acme.in");
    expect(csv.body).toContain("contact_page, website");

    const sent = await t.app.inject({ method: "POST", url: `/api/enrich/jobs/${id}/to-contacts`, headers: { cookie }, payload: { listName: "Bulk test" } });
    expect(sent.json()).toMatchObject({ sent: 2, created: 2 });
    expect(await t.db.outreachContact.count({ where: { listName: "Bulk test" } })).toBe(2);
  });

  it("pauses, resumes and stops a job, and refuses a sheet without the columns it needs", async () => {
    const bad = await t.app.inject({ method: "POST", url: "/api/enrich/jobs", headers: { cookie }, payload: { fileName: "x.csv", data: b64("Name,Email\nA,a@x.in\n") } });
    expect(bad.statusCode).toBe(400);
    const create = await t.app.inject({ method: "POST", url: "/api/enrich/jobs", headers: { cookie }, payload: { fileName: "sites.csv", data: b64("Website\nacme.in\nemptyco.in\n"), useHunter: false } });
    const id = create.json().job.id as string;
    expect((await t.app.inject({ method: "POST", url: `/api/enrich/jobs/${id}/pause`, headers: { cookie } })).json().job.status).toBe("paused");
    expect(await t.app.bulkEnrich.step()).toBe(false); // nothing running
    await t.app.inject({ method: "POST", url: `/api/enrich/jobs/${id}/resume`, headers: { cookie } });
    expect(await t.app.bulkEnrich.step()).toBe(true);
    expect((await t.app.inject({ method: "POST", url: `/api/enrich/jobs/${id}/stop`, headers: { cookie } })).json().job.status).toBe("stopped");
    expect((await t.app.inject({ method: "POST", url: `/api/enrich/jobs/${id}/resume`, headers: { cookie } })).statusCode).toBe(409);
    expect((await t.app.inject({ method: "DELETE", url: `/api/enrich/jobs/${id}`, headers: { cookie } })).statusCode).toBe(200);
  });
});
