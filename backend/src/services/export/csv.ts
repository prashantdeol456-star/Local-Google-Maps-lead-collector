// CSV helpers (RFC 4180) with spreadsheet formula-injection protection.

/**
 * Spreadsheet apps execute cells starting with = + - @ (and tab/CR) as formulas.
 * Collected data is untrusted, so such cells get a leading apostrophe (OWASP guidance).
 * Plain numbers and phone numbers like "+91 89579 26677" or "-12.5" are left as they are:
 * they contain no letters or function calls, so they cannot run anything.
 */
export function neutralizeFormula(value: string): string {
  if (/^[=@\t\r]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && !/^[+-][\d\s().,-]*$/.test(value)) return `'${value}`;
  return value;
}

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : neutralizeFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: (string | number | null | undefined)[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

/** Byte-order mark so Excel opens UTF-8 (e.g. Hindi names) correctly. */
export const UTF8_BOM = "﻿";
