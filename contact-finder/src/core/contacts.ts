// One saved contact per website (by its domain) or per LinkedIn profile/company page, with every
// email and phone found for it, where each came from and when. Pure functions; storage is in
// storage/contacts.ts.

import type { FoundHow, PageFindings } from "./find";

export type ContactKind = "website" | "linkedin_profile" | "linkedin_company";
/** Where a value was found: on the page, on one of the site's Contact/About pages, or in LinkedIn's Contact info */
export type ValueSource = FoundHow | "contact_page" | "contact_info" | "hunter";

export interface SavedValue {
  value: string;
  how: ValueSource;
  /** Hunter's confidence 0–100 */
  score?: number | null;
  /** Deliverability from an email check */
  verified?: string | null;
  /** Page it was read on */
  source: string;
  foundAt: number;
}

export interface Contact {
  /** "site:shop.in", "li:in/asha-verma", "li:company/acme" */
  id: string;
  kind: ContactKind;
  name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  website: string | null;
  linkedinUrl: string | null;
  emails: SavedValue[];
  phones: SavedValue[];
  socials: string[];
  firstSeen: number;
  lastSeen: number;
  /** Last time it was sent to the Lead Platform */
  sentAt: number | null;
}

/** What one page showed, ready to merge into the saved contacts. */
export interface Sighting {
  id: string;
  kind: ContactKind;
  url: string;
  name: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  findings: PageFindings;
  /** Overrides the "how" of every value (e.g. "contact_info", "contact_page") */
  how?: ValueSource;
}

export const MAX_CONTACTS = 20_000;
const MAX_VALUES = 20;

const phoneKey = (v: string) => v.replace(/\D/g, "").replace(/^(0091|91|0)(?=[6-9]\d{9}$)/, "");

type Incoming = { value: string; how: ValueSource; score?: number | null; verified?: string | null };

function mergeValues(list: SavedValue[], incoming: Incoming[], source: string, now: number, key: (v: string) => string) {
  const out = [...list];
  for (const v of incoming) {
    const k = key(v.value);
    const at = out.findIndex((x) => key(x.value) === k);
    if (at >= 0) {
      // Known already: only add a check result or a confidence it did not have.
      const cur = out[at]!;
      if ((v.verified && v.verified !== cur.verified) || (v.score != null && cur.score == null)) out[at] = { ...cur, verified: v.verified ?? cur.verified, score: cur.score ?? v.score };
      continue;
    }
    if (out.length >= MAX_VALUES) continue;
    out.push({ value: v.value, how: v.how, source, foundAt: now, ...(v.score != null ? { score: v.score } : {}), ...(v.verified ? { verified: v.verified } : {}) });
  }
  return out;
}

/** True when the page showed anything worth keeping. */
export function hasSomething(s: Sighting): boolean {
  return s.findings.emails.length > 0 || s.findings.phones.length > 0 || s.kind !== "website";
}

/** Adds what a page showed to the saved contact (or a new one). Existing values are never removed. */
export function mergeSighting(existing: Contact | undefined, s: Sighting, now = Date.now()): Contact {
  const base: Contact = existing ?? {
    id: s.id,
    kind: s.kind,
    name: null,
    title: null,
    company: null,
    location: null,
    website: null,
    linkedinUrl: null,
    emails: [],
    phones: [],
    socials: [],
    firstSeen: now,
    lastSeen: now,
    sentAt: null,
  };
  const how = (v: { value: string; how: FoundHow; score?: number | null; verified?: string | null }): Incoming => ({ value: v.value, how: s.how ?? v.how, score: v.score, verified: v.verified });
  return {
    ...base,
    name: s.name || base.name,
    title: s.title || base.title,
    company: s.company || base.company,
    location: s.location || base.location,
    website: s.website || base.website,
    linkedinUrl: s.linkedinUrl || base.linkedinUrl,
    emails: mergeValues(base.emails, s.findings.emails.map(how), s.url, now, (v) => v.toLowerCase()),
    phones: mergeValues(base.phones, s.findings.phones.map(how), s.url, now, phoneKey),
    socials: [...new Set([...base.socials, ...s.findings.socials])].slice(0, 20),
    lastSeen: now,
  };
}

/** Keeps the newest MAX_CONTACTS (by last seen), so storage cannot grow without end. */
export function trimContacts(all: Record<string, Contact>, max = MAX_CONTACTS): Record<string, Contact> {
  const ids = Object.keys(all);
  if (ids.length <= max) return all;
  const keep = Object.values(all)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, max);
  return Object.fromEntries(keep.map((c) => [c.id, c]));
}

const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Spreadsheet formulas are not run from a cell that starts with = + - @.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** All contacts as CSV for Excel / Google Sheets (UTF-8 with BOM). */
export function contactsToCsv(contacts: Contact[]): string {
  const head = ["Name", "Title", "Company", "Emails", "Phones", "Website", "LinkedIn", "Location", "Type", "Found on", "First seen", "Last seen"];
  const rows = contacts.map((c) => [
    c.name,
    c.title,
    c.company,
    c.emails.map((e) => e.value).join("; "),
    c.phones.map((p) => p.value).join("; "),
    c.website,
    c.linkedinUrl,
    c.location,
    c.kind === "website" ? "Website" : c.kind === "linkedin_profile" ? "LinkedIn profile" : "LinkedIn company",
    c.emails[0]?.source ?? c.phones[0]?.source ?? c.website ?? c.linkedinUrl,
    new Date(c.firstSeen).toISOString(),
    new Date(c.lastSeen).toISOString(),
  ]);
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/**
 * The Lead Platform's contact sheet (Contacts → upload): one row per contact, first email and
 * phone. Only people and companies with an email, a phone or a LinkedIn link are sent.
 */
export function contactsToPlatformCsv(contacts: Contact[]): { csv: string; rows: number } {
  const head = ["Name", "LinkedIn URL", "Contact Number", "Email", "Designation", "Company"];
  const rows = contacts
    .filter((c) => c.emails.length || c.phones.length || c.kind === "linkedin_profile")
    .map((c) => [
      c.name ?? c.company ?? c.website ?? "Unknown",
      c.kind === "linkedin_profile" ? c.linkedinUrl : null,
      c.phones[0]?.value ?? null,
      c.emails[0]?.value ?? null,
      c.title,
      c.company ?? (c.kind === "website" ? c.name : null),
    ]);
  return { csv: [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n", rows: rows.length };
}
