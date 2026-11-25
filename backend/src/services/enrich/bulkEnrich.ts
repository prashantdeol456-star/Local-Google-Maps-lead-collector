// Email finder → Bulk: a sheet of companies or people whose emails and phones are filled in, one
// row at a time in the background.
//
//   1. the row's website: its home page and up to 3 Contact/About pages on the same site, for the
//      emails and phones it publishes (public sites only; see websiteEmail.ts for the safety rules);
//   2. only when the website shows no email, the row names a person and Hunter is switched on for
//      the job: Hunter's Email Finder, through EnrichmentService (balance checked, credits held,
//      never over quota), up to the job's own credit budget.
// Results download as CSV, or go to Contacts (Contacts (Sheets)) under a list name.

import { contactPageLinks, findContacts, htmlToParts } from "@platform/shared";
import type { PrismaClient, EnrichJob, EnrichJobRow } from "../../generated/prisma/client.js";
import { ownerScope } from "../../database/ownerScope.js";
import { AppError, Errors } from "../../utils/errors.js";
import { csvRow, UTF8_BOM } from "../export/csv.js";
import { readSheet } from "../contacts/sheet.js";
import { fetchPublicPage, type FetchText } from "../justdial/websiteEmail.js";
import { cleanDomain, type EnrichmentService } from "./enrichmentService.js";

export const MAX_ROWS = 2000;
const CONTACT_PAGES = 3;

export interface Found {
  value: string;
  source: "given" | "website" | "contact_page" | "hunter";
}

/** Header names people use for each column (lower-case, without spaces and punctuation). */
const HEADERS: Record<"name" | "company" | "website" | "linkedinUrl" | "designation" | "email" | "phone", string[]> = {
  name: ["name", "fullname", "person", "contactname", "contactperson"],
  company: ["company", "companyname", "business", "businessname", "organisation", "organization", "firm"],
  website: ["website", "web", "url", "site", "domain", "websiteurl", "companywebsite"],
  linkedinUrl: ["linkedin", "linkedinurl", "linkedinprofile", "profileurl", "profile"],
  designation: ["designation", "title", "jobtitle", "position", "role"],
  email: ["email", "emailaddress", "mail", "emailid"],
  phone: ["phone", "mobile", "contactnumber", "phonenumber", "number", "contact", "whatsapp"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const cell = (v: string | undefined) => v?.replace(/\s+/g, " ").trim() || null;

/** Rows of a sheet as people/companies; throws a readable error when it cannot be used. */
export function parseEnrichSheet(table: string[][]) {
  const headerAt = table.findIndex((r) => r.some((c) => c.trim()));
  if (headerAt < 0) throw Errors.badRequest("The sheet is empty");
  const header = table[headerAt]!.map(norm);
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))])) as Record<keyof typeof HEADERS, number>;
  if (col.website < 0 && col.company < 0 && col.linkedinUrl < 0) {
    throw Errors.badRequest("Add a column “Website” (or “Company” / “LinkedIn URL”). Download the sample sheet to see the columns.");
  }
  const rows = table
    .slice(headerAt + 1)
    .map((r) => ({
      name: cell(r[col.name]),
      company: cell(r[col.company]),
      website: cell(r[col.website]),
      linkedinUrl: cell(r[col.linkedinUrl]),
      designation: cell(r[col.designation]),
      inputEmail: cell(r[col.email])?.toLowerCase() ?? null,
      inputPhone: cell(r[col.phone]),
    }))
    .filter((r) => r.name || r.company || r.website || r.linkedinUrl);
  if (!rows.length) throw Errors.badRequest("No rows under the header");
  if (rows.length > MAX_ROWS) throw Errors.badRequest(`At most ${MAX_ROWS} rows per sheet (this one has ${rows.length}); split it into smaller sheets`);
  return rows;
}

export function templateCsv(): string {
  return UTF8_BOM + csvRow(["Name", "Company", "Website", "LinkedIn URL", "Designation", "Email", "Phone"]) + csvRow(["Asha Verma", "Acme Healthcare", "acme.in", "", "HR Manager", "", ""]) + csvRow(["", "Sunrise Clinic", "https://sunriseclinic.example.in", "", "", "", ""]);
}

const parseList = (json: string): Found[] => {
  try {
    return JSON.parse(json) as Found[];
  } catch {
    return [];
  }
};

export class BulkEnrichService {
  constructor(
    private readonly db: PrismaClient,
    private readonly enrich: EnrichmentService,
    private readonly opts: { fetchText?: FetchText; importContacts?: (fileName: string, data: Buffer, listName: string | null) => Promise<{ created: number; updated: number }> } = {},
  ) {}

  private get fetchText() {
    return this.opts.fetchText ?? fetchPublicPage;
  }

  // ---- Jobs ----

  async create(input: { name: string; fileName: string; data: Buffer; useWebsites: boolean; useHunter: boolean; hunterBudget: number }) {
    let table: string[][];
    try {
      table = await readSheet(input.fileName, input.data);
    } catch (err) {
      throw err instanceof AppError ? err : Errors.badRequest(err instanceof Error ? err.message : "Cannot read this file");
    }
    const rows = parseEnrichSheet(table);
    if (!input.useWebsites && !input.useHunter) throw Errors.badRequest("Choose at least one: websites or Hunter");
    const job = await this.db.enrichJob.create({
      data: {
        name: input.name.trim() || input.fileName,
        fileName: input.fileName,
        useWebsites: input.useWebsites,
        useHunter: input.useHunter,
        hunterBudget: input.useHunter ? Math.max(0, Math.floor(input.hunterBudget)) : 0,
        total: rows.length,
      },
    });
    // Insert in chunks (SQLite has a limit on values per statement).
    for (let i = 0; i < rows.length; i += 200) {
      await this.db.enrichJobRow.createMany({ data: rows.slice(i, i + 200).map((r, j) => ({ ...r, ownerId: job.ownerId, jobId: job.id, idx: i + j })) });
    }
    return job;
  }

  list() {
    return this.db.enrichJob.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  async get(id: string, page = 1, pageSize = 100) {
    const job = await this.db.enrichJob.findUnique({ where: { id } });
    if (!job) throw Errors.notFound("Job not found");
    const rows = await this.db.enrichJobRow.findMany({ where: { jobId: id }, orderBy: { idx: "asc" }, skip: (page - 1) * pageSize, take: pageSize });
    return { job, rows: rows.map((r) => ({ ...r, emails: parseList(r.emails), phones: parseList(r.phones) })) };
  }

  async setStatus(id: string, action: "pause" | "resume" | "stop") {
    const job = await this.db.enrichJob.findUnique({ where: { id } });
    if (!job) throw Errors.notFound("Job not found");
    if (job.status === "done" || job.status === "stopped") throw Errors.conflict("JOB_FINISHED", "This job has finished");
    const status = action === "pause" ? "paused" : action === "resume" ? "running" : "stopped";
    return this.db.enrichJob.update({ where: { id }, data: { status, ...(status === "stopped" ? { finishedAt: new Date() } : {}) } });
  }

  async remove(id: string) {
    const job = await this.db.enrichJob.findUnique({ where: { id } });
    if (!job) throw Errors.notFound("Job not found");
    await this.db.enrichJobRow.deleteMany({ where: { jobId: id } });
    await this.db.enrichJob.delete({ where: { id } });
  }

  async exportCsv(id: string, write: (chunk: string) => void) {
    const job = await this.db.enrichJob.findUnique({ where: { id } });
    if (!job) throw Errors.notFound("Job not found");
    write(UTF8_BOM + csvRow(["Name", "Company", "Website", "LinkedIn URL", "Designation", "Emails", "Phones", "Found on", "Status", "Note"]));
    for (let skip = 0; ; skip += 500) {
      const rows = await this.db.enrichJobRow.findMany({ where: { jobId: id }, orderBy: { idx: "asc" }, skip, take: 500 });
      if (!rows.length) break;
      let chunk = "";
      for (const r of rows) {
        const emails = parseList(r.emails);
        const phones = parseList(r.phones);
        const sources = [...new Set([...emails, ...phones].map((f) => f.source))];
        chunk += csvRow([r.name, r.company, r.website, r.linkedinUrl, r.designation, emails.map((e) => e.value).join("; "), phones.map((p) => p.value).join("; "), sources.join(", "), r.status, r.note]);
      }
      write(chunk);
    }
  }

  /** Rows with an email or a phone go to Contacts (first email and phone of each). */
  async toContacts(id: string, listName: string | null) {
    if (!this.opts.importContacts) throw Errors.badRequest("Contacts are not available");
    const job = await this.db.enrichJob.findUnique({ where: { id } });
    if (!job) throw Errors.notFound("Job not found");
    const rows = await this.db.enrichJobRow.findMany({ where: { jobId: id }, orderBy: { idx: "asc" } });
    let csv = csvRow(["Name", "LinkedIn URL", "Contact Number", "Email", "Designation", "Company"]);
    let n = 0;
    for (const r of rows) {
      const email = parseList(r.emails)[0]?.value ?? null;
      const phone = parseList(r.phones)[0]?.value ?? null;
      if (!email && !phone) continue;
      csv += csvRow([r.name ?? r.company ?? r.website ?? "Unknown", r.linkedinUrl, phone, email, r.designation, r.company]);
      n++;
    }
    if (!n) throw Errors.badRequest("No row has an email or a phone yet");
    const result = await this.opts.importContacts(`${job.name}.csv`, Buffer.from(csv, "utf8"), listName?.trim() || job.name);
    return { sent: n, ...result };
  }

  // ---- Work (called by the worker, one row at a time) ----

  /** Processes the next row of the oldest running job. Returns false when nothing is waiting. */
  async step(): Promise<boolean> {
    const job = await this.db.enrichJob.findFirst({ where: { status: "running" }, orderBy: { updatedAt: "asc" } });
    if (!job) return false;
    const row = await this.db.enrichJobRow.findFirst({ where: { jobId: job.id, status: "pending" }, orderBy: { idx: "asc" } });
    if (!row) {
      await this.db.enrichJob.update({ where: { id: job.id }, data: { status: "done", finishedAt: new Date() } });
      return true;
    }
    const scope = job.ownerId ? { userId: job.ownerId, ownerId: job.ownerId, customer: true } : null;
    const run = () => this.processRow(job, row);
    await (scope ? ownerScope.run(scope, run) : run());
    return true;
  }

  private async processRow(job: EnrichJob, row: EnrichJobRow) {
    const emails: Found[] = [];
    const phones: Found[] = [];
    const add = (list: Found[], value: string, source: Found["source"]) => {
      const key = value.toLowerCase().replace(/[^a-z0-9@.]/g, "");
      if (!list.some((f) => f.value.toLowerCase().replace(/[^a-z0-9@.]/g, "") === key)) list.push({ value, source });
    };
    if (row.inputEmail) add(emails, row.inputEmail, "given");
    if (row.inputPhone) add(phones, row.inputPhone, "given");
    const notes: string[] = [];
    let hunterUsed = 0;
    let jobNote: string | null = null;
    let useHunter = job.useHunter;

    const domain = cleanDomain(row.website);
    if (job.useWebsites && domain) {
      const site = await this.readSite(`https://${domain}`);
      if (!site) notes.push("website did not open");
      for (const e of site?.emails ?? []) add(emails, e.value, e.source);
      for (const p of site?.phones ?? []) add(phones, p.value, p.source);
    }

    const personEmail = emails.some((e) => e.source !== "given");
    const canAsk = !!row.name && (row.name.split(" ").length >= 2 || !!row.linkedinUrl) && (domain || row.company || row.linkedinUrl);
    if (useHunter && !personEmail && !row.inputEmail && canAsk) {
      if (job.hunterUsed + 1 > job.hunterBudget) {
        notes.push("Hunter budget for this job used up");
      } else {
        try {
          const res = await this.enrich.findEmail({ fullName: row.name!, domain, company: domain ? null : row.company, linkedinUrl: row.linkedinUrl });
          if (res.result) {
            add(emails, res.result.email, "hunter");
            if (res.status === "found") hunterUsed = 1;
          } else notes.push("Hunter: not found");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          notes.push(`Hunter: ${message}`);
          if (err instanceof AppError && (err.code === "NO_CREDITS" || err.code === "HUNTER_DISABLED")) {
            // Out of credits or key switched off: the rest of the job goes on with websites only.
            useHunter = false;
            jobNote = `Hunter stopped: ${message}`;
          }
        }
      }
    }

    const found = emails.some((e) => e.source !== "given") || phones.some((p) => p.source !== "given");
    const status = found ? "found" : !domain && !canAsk ? "skipped" : "not_found";
    await this.db.enrichJobRow.update({
      where: { id: row.id },
      data: { status, emails: JSON.stringify(emails.slice(0, 10)), phones: JSON.stringify(phones.slice(0, 10)), note: notes.join("; ").slice(0, 300) || null },
    });
    await this.db.enrichJob.update({
      where: { id: job.id },
      data: {
        done: { increment: 1 },
        found: { increment: found ? 1 : 0 },
        hunterUsed: { increment: hunterUsed },
        ...(useHunter !== job.useHunter ? { useHunter, note: jobNote } : {}),
      },
    });
  }

  /** Emails and phones a website publishes: home page, then up to 3 contact/about pages. */
  private async readSite(home: string): Promise<{ emails: Found[]; phones: Found[] } | null> {
    const first = await this.fetchText(home).catch(() => null);
    if (!first) return null;
    const emails: Found[] = [];
    const phones: Found[] = [];
    const take = (html: string, source: Found["source"]) => {
      const f = findContacts(htmlToParts(html));
      for (const e of f.emails) if (!emails.some((x) => x.value === e.value)) emails.push({ value: e.value, source });
      for (const p of f.phones) if (!phones.some((x) => x.value === p.value)) phones.push({ value: p.value, source });
    };
    take(first.html, "website");
    const parts = htmlToParts(first.html);
    for (const link of contactPageLinks(parts.hrefs, first.url, CONTACT_PAGES)) {
      const page = await this.fetchText(link).catch(() => null);
      if (page) take(page.html, "contact_page");
    }
    // The site's own addresses first.
    const host = new URL(first.url).hostname.replace(/^www\./, "");
    emails.sort((a, b) => Number(b.value.endsWith(`@${host}`)) - Number(a.value.endsWith(`@${host}`)));
    return { emails, phones };
  }
}
