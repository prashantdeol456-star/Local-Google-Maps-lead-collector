import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseSheetTable } from "../src/services/contacts/sheet.js";
import { contactData, renderContactText, smsParts } from "../src/services/contacts/channelTemplates.js";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

const CSV = [
  "Name,LinkedIn URL,Contact Number,Email,Designation,Company",
  "Priya Sharma,https://in.linkedin.com/in/Priya-Sharma/,+91 98765 43210,Priya@Example.com,HR Manager,Example Pvt Ltd",
  "Rahul Verma,linkedin.com/in/rahul-verma,,rahul@example.com,CTO,Acme",
  "No Contact,,,,,",
  "Bad Url,https://example.com/rahul,,,,",
  "Priya Again,https://www.linkedin.com/in/priya-sharma,,,,",
  "Email Only,,,only@example.com,Founder,Solo",
].join("\n");

const upload = (fileName: string, data: Buffer, listName?: string) =>
  call("POST", "/api/contacts/import", { fileName, data: data.toString("base64"), ...(listName ? { listName } : {}) });

beforeAll(async () => {
  t = await createTestApp();
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.linkedInMessage.deleteMany();
  await t.db.linkedInCampaign.deleteMany();
  await t.db.outreachContact.deleteMany();
  await t.db.messageTemplate.deleteMany({ where: { channel: { in: ["sms", "linkedin"] } } });
});

describe("contact sheet parsing", () => {
  it("matches header synonyms and validates rows", () => {
    const { rows, errors } = parseSheetTable([
      ["User Name", "LinkedIn", "Mobile", "Email ID", "Job Title", "Company Name"],
      ["A B", "https://www.linkedin.com/in/ab", "98765-43210", "a@b.in; second@b.in", "Lead", "X"],
      ["", "https://www.linkedin.com/in/cd"],
      ["C D", "", "abc", "", "", ""],
    ]);
    expect(rows).toEqual([
      { line: 2, contact: { name: "A B", linkedinUrl: "https://www.linkedin.com/in/ab", phone: "98765-43210", email: "a@b.in", designation: "Lead", company: "X" } },
    ]);
    expect(errors).toEqual([
      { line: 3, reason: "No name" },
      { line: 4, reason: "Not a phone number: abc" },
    ]);
  });

  it("needs a Name column", () => {
    expect(() => parseSheetTable([["Email"], ["a@b.in"]])).toThrow(/Name/);
  });
});

describe("contacts API", () => {
  it("imports a CSV, merges repeats and reports bad rows", async () => {
    const res = await upload("contacts.csv", Buffer.from(CSV), "HR Lucknow");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 3, updated: 0, duplicatesInFile: 1 });
    expect(res.json().errors).toEqual([
      { line: 4, reason: "Needs at least one of LinkedIn URL, Contact Number or Email" },
      { line: 5, reason: "Not a LinkedIn profile URL: https://example.com/rahul" },
    ]);

    const list = (await call("GET", "/api/contacts?hasLinkedIn=true")).json();
    expect(list.total).toBe(2);
    const priya = list.items.find((c: { name: string }) => c.name === "Priya Sharma");
    expect(priya).toMatchObject({ linkedinUrl: "https://www.linkedin.com/in/priya-sharma", email: "priya@example.com", phone: "+91 98765 43210", listName: "HR Lucknow" });

    // Upload again with a changed designation: updates, no copies.
    const again = await upload("contacts.csv", Buffer.from(CSV.replace("HR Manager", "HR Head")));
    expect(again.json()).toMatchObject({ created: 0, updated: 3 });
    const facets = (await call("GET", "/api/contacts/facets")).json();
    expect(facets).toMatchObject({ total: 3, withLinkedIn: 2, withEmail: 3, withPhone: 1, lists: [{ value: "HR Lucknow", count: 3 }] });
    const updated = (await call("GET", `/api/contacts/${priya.id}`)).json().contact;
    expect(updated.designation).toBe("HR Head");
  });

  it("imports an .xlsx made from the downloadable template", async () => {
    const template = await call("GET", "/api/contacts/template.xlsx");
    expect(template.statusCode).toBe(200);
    expect(template.headers["content-type"]).toContain("spreadsheetml");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(template.rawPayload as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Contacts")!;
    expect((sheet.getRow(1).values as string[]).slice(1)).toEqual(["Name", "LinkedIn URL", "Contact Number", "Email", "Designation", "Company"]);
    sheet.addRow(["Neha Gupta", { text: "Neha", hyperlink: "https://www.linkedin.com/in/neha-gupta" }, "+91 90000 00000", "neha@example.com", "Director", "Gupta & Co"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await upload("my sheet.xlsx", buffer);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 2, errors: [] }); // the example row + Neha
    const list = (await call("GET", "/api/contacts?q=neha")).json();
    expect(list.items[0]).toMatchObject({ name: "Neha Gupta", linkedinUrl: "https://www.linkedin.com/in/neha-gupta", company: "Gupta & Co" });
  });

  it("rejects other file types and edits/deletes contacts", async () => {
    const bad = await upload("contacts.pdf", Buffer.from("x"));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toMatch(/xlsx or \.csv/);

    await upload("c.csv", Buffer.from(CSV));
    const { items } = (await call("GET", "/api/contacts")).json();
    const rahul = items.find((c: { name: string }) => c.name === "Rahul Verma");
    const patched = await call("PATCH", `/api/contacts/${rahul.id}`, { linkedinUrl: "https://www.linkedin.com/in/priya-sharma" });
    expect(patched.statusCode).toBe(409);
    const ok = await call("PATCH", `/api/contacts/${rahul.id}`, { company: "  ", email: "R@X.IN" });
    expect(ok.json().contact).toMatchObject({ company: null, email: "r@x.in" });
    const del = await call("POST", "/api/contacts/delete", { ids: [rahul.id] });
    expect(del.json()).toEqual({ deleted: 1 });
  });
});

describe("SMS and LinkedIn templates", () => {
  it("renders contact variables with fallbacks", () => {
    const data = contactData({ name: "Dr. Priya Sharma", company: null, designation: "HR", email: null, phone: null });
    expect(renderContactText("Hi {{first_name}}, how is {{company|your team}}?  \n", data)).toBe("Hi Priya, how is your team?");
    expect(smsParts("a".repeat(161))).toEqual({ encoding: "GSM-7", characters: 161, parts: 2 });
    expect(smsParts("नमस्ते")).toMatchObject({ encoding: "Unicode", parts: 1 });
  });

  it("creates, previews, lists by channel and refuses unknown variables", async () => {
    const created = await call("POST", "/api/channel-templates", { channel: "sms", name: "Intro", body: "Hi {{first_name}} from {{company}}" });
    expect(created.statusCode, created.body).toBe(201);
    const bad = await call("POST", "/api/channel-templates", { channel: "linkedin", name: "X", body: "Hi {{city}}" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toMatch(/Unknown variable \{\{city\}\}/);

    const preview = await call("POST", "/api/channel-templates/preview", { channel: "sms", body: "Hi {{first_name}} from {{company}}" });
    expect(preview.json()).toMatchObject({ contact: "Priya Sharma (sample)", text: "Hi Priya from Example Pvt Ltd", sms: { parts: 1 } });

    expect((await call("GET", "/api/channel-templates?channel=sms")).json().items).toHaveLength(1);
    expect((await call("GET", "/api/channel-templates?channel=linkedin")).json().items).toHaveLength(0);
    // Email templates are not reachable through these routes.
    const email = await call("POST", "/api/templates", { name: "E", subject: "S", body: "B" });
    expect((await call("DELETE", `/api/channel-templates/${email.json().template.id}`)).statusCode).toBe(404);
    await call("DELETE", `/api/templates/${email.json().template.id}`);
  });
});

describe("LinkedIn campaigns and the extension queue", () => {
  async function setup(mode: "assisted" | "auto" = "assisted") {
    await upload("c.csv", Buffer.from(CSV), "HR Lucknow");
    const template = (await call("POST", "/api/channel-templates", { channel: "linkedin", name: "Hello", body: "Hi {{first_name}}, I saw you work at {{company|your company}}." })).json().template;
    const res = await call("POST", "/api/linkedin-outreach/campaigns", {
      name: "HR intro",
      templateId: template.id,
      mode,
      recipients: { filters: { listName: "HR Lucknow" } },
      intervalSec: 60,
      dailyLimit: 20,
      windowStart: "00:00",
      windowEnd: "23:59",
    });
    expect(res.statusCode, res.body).toBe(201);
    return { template, campaign: res.json().campaign, queued: res.json().queued };
  }

  it("queues only contacts with a LinkedIn URL and hands out one message at a time", async () => {
    const { campaign, queued } = await setup("auto");
    expect(queued).toBe(2);

    // Not started yet.
    expect((await call("POST", "/api/linkedin-outreach/next")).json()).toEqual({ wait: { reason: "no_running_campaigns", nextCheckAt: null } });
    expect((await call("POST", `/api/linkedin-outreach/campaigns/${campaign.id}/start`)).statusCode).toBe(200);

    const first = (await call("POST", "/api/linkedin-outreach/next")).json();
    expect(first.message).toMatchObject({
      campaignName: "HR intro",
      mode: "auto",
      profileUrl: "https://www.linkedin.com/in/priya-sharma",
      contactName: "Priya Sharma",
      body: "Hi Priya, I saw you work at Example Pvt Ltd.",
    });
    // While it is out, nothing else is handed out.
    expect((await call("POST", "/api/linkedin-outreach/next")).json().wait.reason).toBe("in_flight");

    const sent = await call("POST", `/api/linkedin-outreach/messages/${first.message.id}/result`, { status: "sent" });
    expect(sent.json().message).toMatchObject({ status: "sent", error: null });
    // A repeated report is refused.
    expect((await call("POST", `/api/linkedin-outreach/messages/${first.message.id}/result`, { status: "failed" })).statusCode).toBe(409);

    // Fixed gap between messages.
    const wait = (await call("POST", "/api/linkedin-outreach/next")).json();
    expect(wait.wait).toMatchObject({ reason: "interval", campaignName: "HR intro" });

    const detail = (await call("GET", `/api/linkedin-outreach/campaigns/${campaign.id}`)).json();
    expect(detail).toMatchObject({ counts: { sent: 1, queued: 1 }, sentToday: 1, waitingFor: "interval" });
  });

  it("pauses every running LinkedIn campaign when LinkedIn blocks, and gives the message back", async () => {
    const { campaign } = await setup();
    await call("POST", `/api/linkedin-outreach/campaigns/${campaign.id}/start`);
    const { message } = (await call("POST", "/api/linkedin-outreach/next")).json();
    expect(message.mode).toBe("assisted");
    const res = await call("POST", `/api/linkedin-outreach/messages/${message.id}/result`, { status: "blocked", error: "LinkedIn shows a security check" });
    expect(res.json().message).toMatchObject({ status: "queued", error: "LinkedIn shows a security check" });
    const detail = (await call("GET", `/api/linkedin-outreach/campaigns/${campaign.id}`)).json();
    expect(detail.campaign).toMatchObject({ status: "paused", statusReason: "LinkedIn shows a security check" });
    expect(detail.counts).toEqual({ queued: 2 });
  });

  it("enforces LinkedIn limits and template channel", async () => {
    const { template } = await setup();
    const base = { name: "x", templateId: template.id, mode: "auto", recipients: { filters: {} }, intervalSec: 60, dailyLimit: 20, windowStart: "09:00", windowEnd: "18:00" };
    expect((await call("POST", "/api/linkedin-outreach/campaigns", { ...base, dailyLimit: 500 })).statusCode).toBe(400);
    expect((await call("POST", "/api/linkedin-outreach/campaigns", { ...base, intervalSec: 10 })).statusCode).toBe(400);
    const sms = (await call("POST", "/api/channel-templates", { channel: "sms", name: "s", body: "hi" })).json().template;
    const wrong = await call("POST", "/api/linkedin-outreach/campaigns", { ...base, templateId: sms.id });
    expect(wrong.json().error.message).toMatch(/LinkedIn message template/);
    // In use by a campaign: cannot be deleted.
    expect((await call("DELETE", `/api/channel-templates/${template.id}`)).statusCode).toBe(409);
  });

  it("stop cancels queued messages; campaign logs show LinkedIn messages and events", async () => {
    const { campaign } = await setup();
    await call("POST", `/api/linkedin-outreach/campaigns/${campaign.id}/start`);
    const { message } = (await call("POST", "/api/linkedin-outreach/next")).json();
    await call("POST", `/api/linkedin-outreach/messages/${message.id}/result`, { status: "skipped", error: "Not a 1st-degree connection" });
    await call("POST", `/api/linkedin-outreach/campaigns/${campaign.id}/stop`);

    const campaigns = (await call("GET", "/api/campaign-logs/campaigns?channel=linkedin")).json().items;
    expect(campaigns[0]).toMatchObject({ id: campaign.id, channel: "linkedin", status: "stopped", mode: "assisted", counts: { skipped: 1, cancelled: 1 }, total: 2 });

    const logs = (await call("GET", "/api/campaign-logs/messages?status=skipped")).json();
    expect(logs.total).toBe(1);
    expect(logs.items[0]).toMatchObject({ channel: "linkedin", campaignName: "HR intro", recipient: "Priya Sharma", status: "skipped", error: "Not a 1st-degree connection" });
    const all = (await call("GET", "/api/campaign-logs/messages?q=rahul")).json();
    expect(all.items.map((i: { recipient: string }) => i.recipient)).toEqual(["Rahul Verma"]);

    const events = (await call("GET", "/api/campaign-logs/events")).json().items.map((e: { action: string }) => e.action);
    expect(events).toEqual(expect.arrayContaining(["linkedin_campaign_created", "linkedin_campaign_started", "linkedin_campaign_stopped"]));
  });
});
