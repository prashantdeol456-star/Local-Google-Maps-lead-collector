import {
  normalizeLinkedInProfileUrl,
  normalizeWhitespace,
  type LinkedInEducation,
  type LinkedInExperience,
  type LinkedInLeadInput,
  type LinkedInWebsite,
} from "@platform/shared";
import { isUniqueViolation } from "../../database/client.js";
import type { LinkedInLeadData, LinkedInLeadFilters, LinkedInLeadRecord, Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { csvRow, UTF8_BOM } from "../export/csv.js";
import { parseConnectionsCsv, type CsvRowError } from "./csvImport.js";

// LinkedIn profiles saved by hand (LinkedIn Helper extension, CSV import, admin edits).
// Separate from Google Maps leads: no dedupe with them, no campaigns.

export type LinkedInSource = "extension" | "csv" | "admin";

const MAX_ITEMS = 20;
const SCALARS = ["name", "headline", "company", "location", "birthday", "address", "connectedSince", "notes", "tag"] as const;

export interface LinkedInLeadView extends Omit<LinkedInLeadRecord, "emails" | "phones" | "websites" | "ims" | "experience" | "education"> {
  emails: string[];
  phones: string[];
  websites: LinkedInWebsite[];
  ims: string[];
  experience: LinkedInExperience[];
  education: LinkedInEducation[];
}

function parseJson<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function toLinkedInView(r: LinkedInLeadRecord): LinkedInLeadView {
  return {
    ...r,
    emails: parseJson(r.emails),
    phones: parseJson(r.phones),
    websites: parseJson(r.websites),
    ims: parseJson(r.ims),
    experience: parseJson(r.experience),
    education: parseJson(r.education),
  };
}

/** Union of two lists, first occurrence wins; `key` decides what counts as the same entry. */
function union<T>(a: T[], b: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of [...a, ...b]) {
    const k = key(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.slice(0, MAX_ITEMS);
}

const clean = (v: string | null | undefined) => {
  const s = v ? normalizeWhitespace(v) : "";
  return s || null;
};
const emailKey = (e: string) => e.trim().toLowerCase();
const phoneKey = (p: string) => p.replace(/[^\d+]/g, "");
const websiteKey = (w: LinkedInWebsite) => w.url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
const imKey = (s: string) => s.trim().toLowerCase();
const MAX_HISTORY = 30;

/** Experience/education as read from the profile: cleaned, empty entries dropped. */
function cleanHistory(input: Pick<LinkedInLeadInput, "experience" | "education">) {
  return {
    experience: (input.experience ?? [])
      .map((e) => ({ title: clean(e.title) ?? "", company: clean(e.company), employmentType: clean(e.employmentType), dates: clean(e.dates), location: clean(e.location) }))
      .filter((e) => e.title)
      .slice(0, MAX_HISTORY),
    education: (input.education ?? [])
      .map((e) => ({ school: clean(e.school) ?? "", degree: clean(e.degree), dates: clean(e.dates) }))
      .filter((e) => e.school)
      .slice(0, MAX_HISTORY),
  };
}

const experienceText = (e: LinkedInExperience) => [e.title, e.company && `at ${e.company}`, e.dates && `(${e.dates})`].filter(Boolean).join(" ");
const educationText = (e: LinkedInEducation) => [e.degree, e.school].filter(Boolean).join(", ") + (e.dates ? ` (${e.dates})` : "");

function cleanLists(input: LinkedInLeadInput) {
  return {
    emails: union((input.emails ?? []).map(emailKey), [], (x) => x),
    phones: union((input.phones ?? []).map((p) => clean(p) ?? ""), [], phoneKey),
    websites: union(
      (input.websites ?? []).map((w) => ({ url: w.url.trim(), label: clean(w.label) })),
      [],
      websiteKey,
    ),
    ims: union((input.ims ?? []).map((s) => clean(s) ?? ""), [], imKey),
  };
}

export interface SaveResult {
  result: "new" | "updated";
  lead: LinkedInLeadView;
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: CsvRowError[];
}

export class LinkedInService {
  constructor(private readonly repos: Repositories) {}

  /**
   * Saves one profile, keyed by its canonical profile URL. On an existing profile, filled-in
   * values replace the stored ones (the newest reading wins), empty values never clear anything,
   * and emails/phones/websites/IMs are merged.
   */
  async save(input: LinkedInLeadInput, source: LinkedInSource): Promise<SaveResult> {
    const profileUrl = normalizeLinkedInProfileUrl(input.profileUrl);
    if (!profileUrl) throw Errors.badRequest("profileUrl: not a LinkedIn profile URL (linkedin.com/in/…)");
    const name = clean(input.name);
    if (!name) throw Errors.badRequest("name: required");
    const lists = cleanLists(input);
    const history = cleanHistory(input);

    const [existing] = await this.repos.linkedinLeads.findByProfileUrls([profileUrl]);
    if (!existing) {
      const data: LinkedInLeadData = {
        profileUrl,
        name,
        headline: clean(input.headline),
        company: clean(input.company),
        location: clean(input.location),
        birthday: clean(input.birthday),
        address: clean(input.address),
        connectedSince: clean(input.connectedSince),
        notes: clean(input.notes),
        tag: clean(input.tag),
        source,
        emails: JSON.stringify(lists.emails),
        phones: JSON.stringify(lists.phones),
        websites: JSON.stringify(lists.websites),
        ims: JSON.stringify(lists.ims),
        experience: JSON.stringify(history.experience),
        education: JSON.stringify(history.education),
        hasEmail: lists.emails.length > 0,
        hasPhone: lists.phones.length > 0,
      };
      try {
        return { result: "new", lead: toLinkedInView(await this.repos.linkedinLeads.create(data)) };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        return this.save(input, source); // saved by a parallel request a moment ago: merge into it
      }
    }

    const current = toLinkedInView(existing);
    const patch: Partial<LinkedInLeadData> = {};
    for (const field of SCALARS) {
      const value = clean(input[field]);
      if (value && value !== current[field]) patch[field] = value;
    }
    const emails = union(current.emails, lists.emails, emailKey);
    const phones = union(current.phones, lists.phones, phoneKey);
    const websites = union(current.websites, lists.websites, websiteKey);
    const ims = union(current.ims, lists.ims, imKey);
    Object.assign(patch, {
      emails: JSON.stringify(emails),
      phones: JSON.stringify(phones),
      websites: JSON.stringify(websites),
      ims: JSON.stringify(ims),
      hasEmail: emails.length > 0,
      hasPhone: phones.length > 0,
    });
    // A newer reading of the profile replaces the whole history (positions change, not add up).
    if (history.experience.length) patch.experience = JSON.stringify(history.experience);
    if (history.education.length) patch.education = JSON.stringify(history.education);
    return { result: "updated", lead: toLinkedInView(await this.repos.linkedinLeads.update(existing.id, patch)) };
  }

  async importCsv(text: string, tag: string | null): Promise<ImportResult> {
    let parsed;
    try {
      parsed = parseConnectionsCsv(text);
    } catch (err) {
      throw Errors.badRequest((err as Error).message);
    }
    const result: ImportResult = { total: parsed.rows.length + parsed.errors.length, created: 0, updated: 0, skipped: parsed.errors.length, errors: [...parsed.errors] };
    for (const { line, input } of parsed.rows) {
      try {
        const saved = await this.save({ ...input, tag: input.tag ?? tag }, "csv");
        result[saved.result === "new" ? "created" : "updated"]++;
      } catch (err) {
        result.skipped++;
        result.errors.push({ line, reason: (err as Error).message });
      }
    }
    result.errors = result.errors.sort((a, b) => a.line - b.line).slice(0, 50);
    return result;
  }

  /** Which of these profile URLs are saved already (for the extension's queue). */
  async check(urls: string[]): Promise<Record<string, string>> {
    const canonical = new Map<string, string[]>();
    for (const url of urls) {
      const c = normalizeLinkedInProfileUrl(url);
      if (c) canonical.set(c, [...(canonical.get(c) ?? []), url]);
    }
    const found = await this.repos.linkedinLeads.findByProfileUrls([...canonical.keys()]);
    const saved: Record<string, string> = {};
    for (const lead of found) for (const original of canonical.get(lead.profileUrl) ?? []) saved[original] = lead.id;
    return saved;
  }

  async list(filters: LinkedInLeadFilters & { skip: number; take: number }) {
    const { items, total } = await this.repos.linkedinLeads.list(filters);
    return { items: items.map(toLinkedInView), total };
  }

  facets() {
    return this.repos.linkedinLeads.facets();
  }

  async get(id: string) {
    const lead = await this.repos.linkedinLeads.findById(id);
    if (!lead) throw Errors.notFound("LinkedIn lead not found");
    return toLinkedInView(lead);
  }

  /** Admin edit: given fields replace the stored ones (null clears; lists are replaced, not merged). */
  async update(id: string, changes: Partial<Omit<LinkedInLeadInput, "profileUrl">>) {
    const lead = await this.get(id);
    const patch: Partial<LinkedInLeadData> = {};
    for (const field of SCALARS) {
      if (changes[field] === undefined) continue;
      const value = clean(changes[field]);
      if (field === "name" && !value) throw Errors.badRequest("name: required");
      patch[field] = value as never;
    }
    const lists = cleanLists({ profileUrl: lead.profileUrl, name: lead.name, ...changes });
    if (changes.emails) Object.assign(patch, { emails: JSON.stringify(lists.emails), hasEmail: lists.emails.length > 0 });
    if (changes.phones) Object.assign(patch, { phones: JSON.stringify(lists.phones), hasPhone: lists.phones.length > 0 });
    if (changes.websites) patch.websites = JSON.stringify(lists.websites);
    if (changes.ims) patch.ims = JSON.stringify(lists.ims);
    const history = cleanHistory(changes);
    if (changes.experience) patch.experience = JSON.stringify(history.experience);
    if (changes.education) patch.education = JSON.stringify(history.education);
    return toLinkedInView(await this.repos.linkedinLeads.update(id, patch));
  }

  async delete(id: string) {
    if (!(await this.repos.linkedinLeads.delete(id))) throw Errors.notFound("LinkedIn lead not found");
  }

  /** Streams the filtered profiles as CSV (with formula-injection protection); returns the row count. */
  async writeCsv(filters: LinkedInLeadFilters, out: { write(chunk: string): unknown }): Promise<number> {
    out.write(UTF8_BOM);
    out.write(
      csvRow(["Name", "Profile URL", "Headline", "Company", "Location", "Emails", "Phones", "Websites", "IMs", "Experience", "Education", "Birthday", "Address", "Connected since", "Tag", "Source", "Notes", "Saved at"]),
    );
    let cursor: string | null = null;
    let count = 0;
    for (;;) {
      const batch = await this.repos.linkedinLeads.listBatch(filters, cursor, 500);
      for (const r of batch.map(toLinkedInView)) {
        out.write(
          csvRow([
            r.name,
            r.profileUrl,
            r.headline,
            r.company,
            r.location,
            r.emails.join("; "),
            r.phones.join("; "),
            r.websites.map((w) => (w.label ? `${w.url} (${w.label})` : w.url)).join("; "),
            r.ims.join("; "),
            r.experience.map(experienceText).join("; "),
            r.education.map(educationText).join("; "),
            r.birthday,
            r.address,
            r.connectedSince,
            r.tag,
            r.source,
            r.notes,
            r.createdAt.toISOString(),
          ]),
        );
      }
      count += batch.length;
      if (batch.length < 500) return count;
      cursor = batch[batch.length - 1]!.id;
    }
  }
}
