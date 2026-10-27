import type { ContactData, ContactFilters, ContactRecord, Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { parseSheetTable, readSheet, type SheetContact, type SheetRowError } from "./sheet.js";

export interface ImportResult {
  created: number;
  updated: number;
  /** Rows that repeat a contact already earlier in the same file. */
  duplicatesInFile: number;
  errors: SheetRowError[];
  total: number;
}

export type ContactUpdate = Partial<Pick<ContactData, "name" | "linkedinUrl" | "instagramUrl" | "email" | "phone" | "designation" | "company" | "listName">>;

const CHUNK = 200;

export class ContactService {
  constructor(private readonly repos: Repositories) {}

  /**
   * Imports a sheet. A row whose LinkedIn URL (or, without one, email) is already saved updates
   * that contact: filled cells replace the saved values, empty cells keep them.
   */
  async importSheet(fileName: string, data: Buffer, listName: string | null): Promise<ImportResult> {
    let parsed;
    try {
      parsed = parseSheetTable(await readSheet(fileName, data));
    } catch (err) {
      throw Errors.badRequest(err instanceof Error ? err.message : String(err));
    }

    // Same person twice in one file: keep the first row, count the rest.
    const seen = new Set<string>();
    const unique: SheetContact[] = [];
    let duplicatesInFile = 0;
    for (const { contact } of parsed.rows) {
      const keys = [contact.linkedinUrl && `li:${contact.linkedinUrl}`, contact.instagramUrl && `ig:${contact.instagramUrl}`, contact.email && `em:${contact.email}`].filter(Boolean) as string[];
      if (keys.some((k) => seen.has(k))) {
        duplicatesInFile++;
        continue;
      }
      keys.forEach((k) => seen.add(k));
      unique.push(contact);
    }

    let created = 0;
    let updated = 0;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      await this.repos.transaction(async (tx) => {
        const byUrl = new Map((await tx.contacts.findByLinkedInUrls(chunk.flatMap((c) => (c.linkedinUrl ? [c.linkedinUrl] : [])))).map((c) => [c.linkedinUrl!, c]));
        const byIg = new Map((await tx.contacts.findByInstagramUrls(chunk.flatMap((c) => (c.instagramUrl ? [c.instagramUrl] : [])))).map((c) => [c.instagramUrl!, c]));
        const byEmail = new Map((await tx.contacts.findByEmails(chunk.flatMap((c) => (c.email ? [c.email] : [])))).map((c) => [c.email!, c]));
        for (const row of chunk) {
          let existing = row.linkedinUrl ? byUrl.get(row.linkedinUrl) : undefined;
          if (!existing && row.instagramUrl) {
            const candidate = byIg.get(row.instagramUrl);
            if (candidate && (!candidate.linkedinUrl || !row.linkedinUrl)) existing = candidate;
          }
          // Match by email only when that would not join two different LinkedIn profiles.
          if (!existing && row.email) {
            const candidate = byEmail.get(row.email);
            if (candidate && (!candidate.linkedinUrl || !row.linkedinUrl)) existing = candidate;
          }
          if (existing) {
            const patch: Partial<ContactData> = {};
            for (const key of ["name", "linkedinUrl", "instagramUrl", "email", "phone", "designation", "company"] as const) {
              const value = row[key];
              if (value && value !== existing[key]) patch[key] = value;
            }
            if (listName && listName !== existing.listName) patch.listName = listName;
            if (Object.keys(patch).length) {
              const saved = await tx.contacts.update(existing.id, patch);
              if (saved.linkedinUrl) byUrl.set(saved.linkedinUrl, saved);
              if (saved.instagramUrl) byIg.set(saved.instagramUrl, saved);
              if (saved.email) byEmail.set(saved.email, saved);
            }
            updated++;
          } else {
            const saved = await tx.contacts.create({ ...row, listName, source: "sheet" });
            if (saved.linkedinUrl) byUrl.set(saved.linkedinUrl, saved);
            if (saved.instagramUrl) byIg.set(saved.instagramUrl, saved);
            if (saved.email) byEmail.set(saved.email, saved);
            created++;
          }
        }
      });
    }
    await this.repos.agentLogs.create({
      jobId: null,
      action: "contacts_imported",
      status: parsed.errors.length ? "warning" : "success",
      message: `${fileName}: ${created} new, ${updated} updated, ${parsed.errors.length} skipped${listName ? ` (list "${listName}")` : ""}`,
    });
    return { created, updated, duplicatesInFile, errors: parsed.errors.slice(0, 200), total: parsed.rows.length + parsed.errors.length };
  }

  list(query: ContactFilters & { skip: number; take: number }) {
    return this.repos.contacts.list(query);
  }

  facets() {
    return this.repos.contacts.facets();
  }

  async get(id: string): Promise<ContactRecord> {
    const contact = await this.repos.contacts.findById(id);
    if (!contact) throw Errors.notFound("Contact not found");
    return contact;
  }

  async update(id: string, data: ContactUpdate) {
    await this.get(id);
    if (data.linkedinUrl) {
      const [other] = await this.repos.contacts.findByLinkedInUrls([data.linkedinUrl]);
      if (other && other.id !== id) throw Errors.conflict("DUPLICATE_CONTACT", `Another contact already has this LinkedIn URL (${other.name})`);
    }
    if (data.instagramUrl) {
      const [other] = await this.repos.contacts.findByInstagramUrls([data.instagramUrl]);
      if (other && other.id !== id) throw Errors.conflict("DUPLICATE_CONTACT", `Another contact already has this Instagram URL (${other.name})`);
    }
    return this.repos.contacts.update(id, data);
  }

  deleteMany(ids: string[]) {
    return this.repos.contacts.deleteMany([...new Set(ids)]);
  }
}
