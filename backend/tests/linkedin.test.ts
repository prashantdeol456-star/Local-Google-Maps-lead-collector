import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseConnectionsCsv, parseCsv } from "../src/services/linkedin/csvImport.js";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

const save = (lead: Record<string, unknown>) => call("POST", "/api/linkedin/leads", { lead });

beforeAll(async () => {
  t = await createTestApp();
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.linkedInLead.deleteMany();
});

// As LinkedIn's "Connections.csv" export looks: notes first, then the header.
const CONNECTIONS_CSV = [
  "Notes:",
  '"When exporting your connection data, you may notice that some of the email addresses are missing."',
  "",
  "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
  "Nikhil,Sharda,https://www.linkedin.com/in/nikhil-sharda,nikhil@example.com,Fixtra,\"Founder, CEO\",19 Oct 2026",
  "Bala,M,https://in.linkedin.com/in/bala-m/,,Acme,HR Manager,02 Sep 2026",
  "Hidden,Member,,,,,01 Jan 2026",
  "",
].join("\r\n");

describe("LinkedIn leads API", () => {
  it("needs a login", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/linkedin/leads" });
    expect(res.statusCode).toBe(401);
  });

  it("saves a profile from the extension under its canonical URL", async () => {
    const res = await save({
      profileUrl: "https://www.linkedin.com/in/Vaishnavi-Yadav/overlay/contact-info/",
      name: "  Vaishnavi   Yadav ",
      headline: "HR Executive",
      company: "Fixtra",
      emails: ["Vaishnavi@Example.com"],
      websites: [{ url: "fixtra.in", label: "Company" }],
      ims: ["vaishnavi (Google Hangouts)"],
      birthday: "February 5",
      connectedSince: "Oct 19, 2026",
      tag: "HR Lucknow",
    });
    expect(res.statusCode, res.body).toBe(201);
    const { result, lead } = res.json();
    expect(result).toBe("new");
    expect(lead).toMatchObject({
      profileUrl: "https://www.linkedin.com/in/vaishnavi-yadav",
      name: "Vaishnavi Yadav",
      emails: ["vaishnavi@example.com"],
      websites: [{ url: "fixtra.in", label: "Company" }],
      hasEmail: true,
      hasPhone: false,
      source: "extension",
    });
  });

  it("merges a second save: new values win, empty values never clear, lists are combined", async () => {
    await save({ profileUrl: "linkedin.com/in/aman", name: "Aman Singh", company: "Old Co", emails: ["a@x.in"], birthday: "May 1" });
    const res = await save({ profileUrl: "https://www.linkedin.com/in/aman/", name: "Aman Singh", company: "New Co", emails: ["A@x.in", "b@x.in"], phones: ["+91 98765 43210"], birthday: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe("updated");
    expect(res.json().lead).toMatchObject({ company: "New Co", birthday: "May 1", emails: ["a@x.in", "b@x.in"], phones: ["+91 98765 43210"], hasPhone: true });
    expect(await t.db.linkedInLead.count()).toBe(1);
  });

  it("stores experience and education; a newer reading replaces them, an empty one keeps them", async () => {
    const experience = [
      { title: "Technical Product Manager", company: "XtraCover", employmentType: "Full-time", dates: "Oct 2023 - May 2024 · 8 mos", location: "Delhi, India" },
      { title: "Senior Process Associate", company: "Capgemini", employmentType: null, dates: null, location: null },
      { title: "  ", company: "dropped: no title" },
    ];
    const education = [{ school: "IIM Lucknow", degree: "MBA, HR", dates: "2019 - 2021" }];
    const first = (await save({ profileUrl: "https://www.linkedin.com/in/p", name: "P", experience, education })).json().lead;
    expect(first.experience).toHaveLength(2);
    expect(first.education).toEqual(education);

    const again = (await save({ profileUrl: "https://www.linkedin.com/in/p", name: "P", experience: [experience[0]], education: [] })).json().lead;
    expect(again.experience).toEqual([experience[0]]);
    expect(again.education).toEqual(education);

    expect((await call("GET", "/api/linkedin/leads?q=iim lucknow")).json().total).toBe(1);
    const csv = await call("GET", "/api/linkedin/export.csv");
    expect(csv.body).toContain("Technical Product Manager at XtraCover (Oct 2023 - May 2024 · 8 mos)");
    expect(csv.body).toContain("\"MBA, HR, IIM Lucknow (2019 - 2021)\"");
  });

  it("rejects non-profile URLs and bad emails", async () => {
    expect((await save({ profileUrl: "https://www.linkedin.com/company/fixtra", name: "X" })).statusCode).toBe(400);
    expect((await save({ profileUrl: "https://evil.com/in/x", name: "X" })).statusCode).toBe(400);
    expect((await save({ profileUrl: "https://www.linkedin.com/in/x", name: "X", emails: ["not-an-email"] })).statusCode).toBe(400);
  });

  it("tells the extension which queued profiles are saved already", async () => {
    const { lead } = (await save({ profileUrl: "https://www.linkedin.com/in/anmol-gupta", name: "Anmol Gupta" })).json();
    const res = await call("POST", "/api/linkedin/leads/check", {
      profileUrls: ["https://in.linkedin.com/in/Anmol-Gupta/", "https://www.linkedin.com/in/someone-else", "garbage"],
    });
    expect(res.json()).toEqual({ saved: { "https://in.linkedin.com/in/Anmol-Gupta/": lead.id } });
  });

  it("filters by text, company, tag, source, email and phone; returns facets", async () => {
    await save({ profileUrl: "https://www.linkedin.com/in/a", name: "Asha", company: "Fixtra", emails: ["asha@f.in"], tag: "HR" });
    await save({ profileUrl: "https://www.linkedin.com/in/b", name: "Bala", company: "Acme", phones: ["98765 43210"], tag: "HR" });
    await save({ profileUrl: "https://www.linkedin.com/in/c", name: "Chetan", company: "Acme Labs", headline: "Principal", websites: [{ url: "chetan.dev", label: "Personal" }] });

    const names = async (qs: string) => (await call("GET", `/api/linkedin/leads?${qs}`)).json().items.map((l: { name: string }) => l.name).sort();
    expect(await names("q=principal")).toEqual(["Chetan"]);
    expect(await names("company=acme")).toEqual(["Bala", "Chetan"]);
    expect(await names("tag=HR")).toEqual(["Asha", "Bala"]);
    expect(await names("hasEmail=true")).toEqual(["Asha"]);
    expect(await names("hasPhone=false")).toEqual(["Asha", "Chetan"]);
    expect(await names("hasWebsite=true")).toEqual(["Chetan"]);
    expect(await names("hasWebsite=false")).toEqual(["Asha", "Bala"]);
    expect(await names("source=csv")).toEqual([]);
    expect((await call("GET", "/api/linkedin/leads?hasEmail=maybe")).statusCode).toBe(400);

    const facets = (await call("GET", "/api/linkedin/facets")).json();
    expect(facets).toMatchObject({ total: 3, withEmail: 1, withPhone: 1, withWebsite: 1, tags: [{ value: "HR", count: 2 }], sources: [{ value: "extension", count: 3 }] });
  });

  it("edits, deletes and exports with formula protection", async () => {
    const { lead } = (await save({ profileUrl: "https://www.linkedin.com/in/x", name: "=HYPERLINK(\"evil\")", emails: ["x@x.in"] })).json();
    const edited = await call("PATCH", `/api/linkedin/leads/${lead.id}`, { company: "Fixtra", emails: [], notes: "Met at expo" });
    expect(edited.json().lead).toMatchObject({ company: "Fixtra", emails: [], hasEmail: false, notes: "Met at expo" });
    expect((await call("PATCH", `/api/linkedin/leads/${lead.id}`, { profileUrl: "https://www.linkedin.com/in/y" })).statusCode).toBe(400);

    const csv = await call("GET", "/api/linkedin/export.csv?company=fixtra");
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("'=HYPERLINK");
    expect(csv.body).toContain("https://www.linkedin.com/in/x");

    expect((await call("DELETE", `/api/linkedin/leads/${lead.id}`)).statusCode).toBe(200);
    expect((await call("GET", `/api/linkedin/leads/${lead.id}`)).statusCode).toBe(404);
  });

  it("imports LinkedIn's Connections.csv and merges into saved profiles", async () => {
    await save({ profileUrl: "https://www.linkedin.com/in/nikhil-sharda", name: "Nikhil Sharda", phones: ["+91 90000 00000"] });
    const res = await call("POST", "/api/linkedin/import", { csv: CONNECTIONS_CSV, tag: "My connections" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ total: 3, created: 1, updated: 1, skipped: 1, errors: [{ line: 7, reason: "No profile URL" }] });

    const nikhil = (await call("GET", "/api/linkedin/leads?q=nikhil")).json().items[0];
    expect(nikhil).toMatchObject({ headline: "Founder, CEO", company: "Fixtra", emails: ["nikhil@example.com"], phones: ["+91 90000 00000"], connectedSince: "19 Oct 2026", tag: "My connections", source: "extension" });
    const bala = (await call("GET", "/api/linkedin/leads?q=bala")).json().items[0];
    expect(bala).toMatchObject({ profileUrl: "https://www.linkedin.com/in/bala-m", source: "csv", hasEmail: false });

    expect((await call("POST", "/api/linkedin/import", { csv: "a,b\n1,2" })).statusCode).toBe(400);
  });
});

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,"line\nbreak",3')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "line\nbreak", "3"],
    ]);
  });

  it("reads this platform's own export back in", () => {
    const { rows } = parseConnectionsCsv("Name,Profile URL,Emails,Phones\r\nAsha,https://www.linkedin.com/in/asha,a@x.in; b@x.in,98765\r\n");
    expect(rows[0]!.input).toMatchObject({ name: "Asha", profileUrl: "https://www.linkedin.com/in/asha", emails: ["a@x.in", "b@x.in"], phones: ["98765"] });
  });
});
