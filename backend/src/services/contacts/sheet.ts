// Reads the contacts sheet (.xlsx or .csv) and writes the empty template to download.
// Columns: Name, LinkedIn URL, Contact Number, Email, Designation, Company.
// Headers are matched loosely (case, spaces, common synonyms) so a sheet made by hand works too.

import ExcelJS from "exceljs";
import { normalizeInstagramUrl, normalizeLinkedInProfileUrl } from "@platform/shared";
import { parseCsv } from "../linkedin/csvImport.js";

export const SHEET_COLUMNS = [
  { key: "name", header: "Name", example: "Priya Sharma", width: 26 },
  { key: "linkedinUrl", header: "LinkedIn URL", example: "https://www.linkedin.com/in/priya-sharma-example", width: 46 },
  { key: "instagramUrl", header: "Instagram URL", example: "https://www.instagram.com/priya.sharma.example/", width: 40 },
  { key: "phone", header: "Contact Number", example: "+91 98765 43210", width: 18 },
  { key: "email", header: "Email", example: "priya@example.com", width: 28 },
  { key: "designation", header: "Designation", example: "HR Manager", width: 22 },
  { key: "company", header: "Company", example: "Example Pvt Ltd", width: 26 },
] as const;

export type SheetField = (typeof SHEET_COLUMNS)[number]["key"];

const ALIASES: Record<string, SheetField> = {
  name: "name",
  "user name": "name",
  username: "name",
  "full name": "name",
  "contact name": "name",
  "linkedin url": "linkedinUrl",
  linkedin: "linkedinUrl",
  "linkedin profile": "linkedinUrl",
  "linkedin profile url": "linkedinUrl",
  "profile url": "linkedinUrl",
  url: "linkedinUrl",
  "instagram url": "instagramUrl",
  instagram: "instagramUrl",
  "instagram profile": "instagramUrl",
  "instagram profile url": "instagramUrl",
  "instagram id": "instagramUrl",
  "instagram username": "instagramUrl",
  "insta id": "instagramUrl",
  insta: "instagramUrl",
  ig: "instagramUrl",
  "contact number": "phone",
  "contact no": "phone",
  contact: "phone",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  "mobile number": "phone",
  whatsapp: "phone",
  email: "email",
  emails: "email",
  "email address": "email",
  "email id": "email",
  "e-mail": "email",
  mail: "email",
  designation: "designation",
  title: "designation",
  "job title": "designation",
  position: "designation",
  role: "designation",
  company: "company",
  "company name": "company",
  organisation: "company",
  organization: "company",
};

const headerKey = (cell: string) =>
  cell
    .toLowerCase()
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\(.*\)\s*$/, "") // "Email (optional)"
    .trim();

export interface SheetContact {
  name: string;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
  company: string | null;
}

export interface SheetRowError {
  line: number;
  reason: string;
}

export interface ParsedSheet {
  rows: { line: number; contact: SheetContact }[];
  errors: SheetRowError[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Phone kept as written (spaces allowed), but only digits, +, spaces, dashes, dots and brackets. */
function cleanPhone(raw: string): string | null {
  const v = raw.replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (!/^\+?[\d\s\-().]{6,25}$/.test(v)) return null;
  return (v.match(/\d/g) ?? []).length >= 6 ? v : null;
}

const text = (v: string | undefined, max: number) => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Table (first row with a "Name" column is the header) → contacts. */
export function parseSheetTable(table: string[][]): ParsedSheet {
  const headerIndex = table.findIndex((r) => r.some((c) => ALIASES[headerKey(c)] === "name"));
  if (headerIndex < 0) throw new Error('No header row found. The sheet needs a "Name" column (download the template to see the format)');
  const columns = table[headerIndex]!.map((c) => ALIASES[headerKey(c)]);
  if (!columns.some((c) => c && c !== "name")) {
    throw new Error("The sheet has a Name column but none of: LinkedIn URL, Instagram URL, Contact Number, Email, Designation, Company");
  }

  const rows: ParsedSheet["rows"] = [];
  const errors: SheetRowError[] = [];
  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i]!;
    if (cells.every((c) => !c?.trim())) continue;
    const line = i + 1;
    const v: Partial<Record<SheetField, string>> = {};
    columns.forEach((key, idx) => {
      const value = cells[idx]?.trim();
      if (key && value && !v[key]) v[key] = value;
    });

    const name = text(v.name, 300);
    if (!name) {
      errors.push({ line, reason: "No name" });
      continue;
    }
    let linkedinUrl: string | null = null;
    if (v.linkedinUrl) {
      linkedinUrl = normalizeLinkedInProfileUrl(v.linkedinUrl);
      if (!linkedinUrl) {
        errors.push({ line, reason: `Not a LinkedIn profile URL: ${v.linkedinUrl.slice(0, 80)}` });
        continue;
      }
    }
    let instagramUrl: string | null = null;
    if (v.instagramUrl) {
      instagramUrl = normalizeInstagramUrl(v.instagramUrl);
      if (!instagramUrl) {
        errors.push({ line, reason: `Not an Instagram profile URL or username: ${v.instagramUrl.slice(0, 80)}` });
        continue;
      }
    }
    // A cell may hold several addresses ("a@x.com; b@y.com"): the first valid one is used.
    const email = (v.email ?? "")
      .split(/[;,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .find((e) => EMAIL.test(e) && e.length <= 254) ?? null;
    if (v.email && !email) {
      errors.push({ line, reason: `Not an email address: ${v.email.slice(0, 80)}` });
      continue;
    }
    const phone = v.phone ? cleanPhone(v.phone.split(/[;,/]/)[0]!) : null;
    if (v.phone && !phone) {
      errors.push({ line, reason: `Not a phone number: ${v.phone.slice(0, 40)}` });
      continue;
    }
    if (!linkedinUrl && !instagramUrl && !email && !phone) {
      errors.push({ line, reason: "Needs at least one of LinkedIn URL, Instagram URL, Contact Number or Email" });
      continue;
    }
    rows.push({ line, contact: { name, linkedinUrl, instagramUrl, email, phone, designation: text(v.designation, 300), company: text(v.company, 300) } });
  }
  return { rows, errors };
}

/** Excel cell → text. Hyperlink cells give their address text; formulas their result. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      const t = (value as { text?: unknown }).text;
      const shown = typeof t === "string" ? t : "";
      return /linkedin\.com|^mailto:/i.test(value.hyperlink) ? value.hyperlink.replace(/^mailto:/i, "") : shown || value.hyperlink;
    }
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof value.text === "string") return value.text;
  }
  return "";
}

export const MAX_SHEET_ROWS = 20_000;

export async function readSheet(fileName: string, data: Buffer): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(data.toString("utf8"));
  if (!lower.endsWith(".xlsx")) throw new Error("Upload an .xlsx or .csv file (old .xls files: open in Excel and save as .xlsx)");

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new Error("Could not read this .xlsx file");
  }
  const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) throw new Error("The file has no rows");
  if (sheet.actualRowCount > MAX_SHEET_ROWS + 1) throw new Error(`At most ${MAX_SHEET_ROWS} rows per upload`);
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    const values = row.values as ExcelJS.CellValue[]; // 1-based
    for (let c = 1; c < values.length; c++) cells.push(cellText(values[c] ?? null));
    table[rowNumber - 1] = cells;
  });
  for (let i = 0; i < table.length; i++) table[i] ??= [];
  return table;
}

export async function templateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contacts");
  sheet.columns = SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.addRow(Object.fromEntries(SHEET_COLUMNS.map((c) => [c.key, c.example])));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const help = workbook.addWorksheet("How to fill");
  help.columns = [{ width: 110 }];
  for (const line of [
    "One contact per row on the Contacts sheet. Keep the header row; replace the example row.",
    "Name is required, plus at least one of LinkedIn URL, Instagram URL, Contact Number or Email.",
    "Instagram URL: the profile link (https://www.instagram.com/username/) or just the username (needed for Instagram messages).",
    "LinkedIn URL: the profile link, e.g. https://www.linkedin.com/in/someone (needed for LinkedIn messages).",
    "Contact Number: with country code, e.g. +91 98765 43210.",
    "Uploading the same LinkedIn URL (or email) again updates that contact instead of adding a copy.",
  ]) help.addRow([line]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function templateCsv(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [SHEET_COLUMNS.map((c) => c.header), SHEET_COLUMNS.map((c) => c.example)].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
