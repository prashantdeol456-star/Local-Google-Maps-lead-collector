// Reads LinkedIn's own "Connections.csv" export (Settings → Data privacy → Get a copy of your
// data → Connections) and this platform's LinkedIn export, so a file can be re-imported.
// LinkedIn's file starts with a few "Notes:" lines before the header row.

import { normalizeLinkedInProfileUrl, type LinkedInLeadInput } from "@platform/shared";

/** RFC 4180: quoted fields, "" inside quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const HEADERS: Record<string, keyof LinkedInLeadInput | "firstName" | "lastName"> = {
  "first name": "firstName",
  "last name": "lastName",
  name: "name",
  "full name": "name",
  url: "profileUrl",
  "profile url": "profileUrl",
  "email address": "emails",
  email: "emails",
  emails: "emails",
  phone: "phones",
  phones: "phones",
  company: "company",
  position: "headline",
  headline: "headline",
  designation: "headline",
  location: "location",
  "connected on": "connectedSince",
  "connected since": "connectedSince",
  birthday: "birthday",
  address: "address",
  tag: "tag",
  notes: "notes",
};

export interface CsvRowError {
  line: number;
  reason: string;
}

export interface ParsedConnections {
  rows: { line: number; input: LinkedInLeadInput }[];
  errors: CsvRowError[];
}

const list = (v: string) =>
  v
    .split(/[;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function parseConnectionsCsv(text: string): ParsedConnections {
  const table = parseCsv(text);
  const headerIndex = table.findIndex((r) => {
    const cells = r.map((c) => c.trim().toLowerCase());
    return (cells.includes("url") || cells.includes("profile url")) && cells.some((c) => c === "first name" || c === "name");
  });
  if (headerIndex < 0) throw new Error('No header row found. Expected columns like "First Name", "Last Name", "URL" (LinkedIn Connections.csv)');

  const columns = table[headerIndex]!.map((c) => HEADERS[c.trim().toLowerCase()]);
  const rows: ParsedConnections["rows"] = [];
  const errors: CsvRowError[] = [];

  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i]!;
    if (cells.every((c) => !c.trim())) continue;
    const line = i + 1;
    const v: Partial<Record<string, string>> = {};
    columns.forEach((key, idx) => {
      const value = cells[idx]?.trim();
      if (key && value) v[key] = value;
    });

    const name = v.name ?? [v.firstName, v.lastName].filter(Boolean).join(" ");
    const profileUrl = normalizeLinkedInProfileUrl(v.profileUrl);
    if (!profileUrl) {
      // LinkedIn leaves URL empty for some members (privacy settings).
      errors.push({ line, reason: v.profileUrl ? "Not a LinkedIn profile URL" : "No profile URL" });
      continue;
    }
    if (!name) {
      errors.push({ line, reason: "No name" });
      continue;
    }
    rows.push({
      line,
      input: {
        profileUrl,
        name,
        headline: v.headline ?? null,
        company: v.company ?? null,
        location: v.location ?? null,
        emails: v.emails ? list(v.emails) : [],
        phones: v.phones ? list(v.phones) : [],
        birthday: v.birthday ?? null,
        address: v.address ?? null,
        connectedSince: v.connectedSince ?? null,
        notes: v.notes ?? null,
        tag: v.tag ?? null,
      },
    });
  }
  return { rows, errors };
}
