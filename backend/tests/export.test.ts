import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { csvCell, csvRow, neutralizeFormula } from "../src/services/export/csv.js";
import { createTestApp } from "./helpers.js";

describe("csv helpers", () => {
  it.each([
    ["=HYPERLINK(\"http://evil\")", "'=HYPERLINK(\"http://evil\")"],
    ["@SUM(1)", "'@SUM(1)"],
    ["+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"],
    ["-2+3+cmd|' /C calc'!A0", "'-2+3+cmd|' /C calc'!A0"],
    ["\tTab", "'\tTab"],
    ["+91 89579 26677", "+91 89579 26677"],
    ["+918957926677", "+918957926677"],
    ["-12.5", "-12.5"],
    ["(0522) 400-0000", "(0522) 400-0000"],
    ["ABC University", "ABC University"],
  ])("neutralizeFormula(%j) = %j", (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it("quotes commas, quotes and new lines; empty for null", () => {
    expect(csvCell('Babuganj, "Main" Gate\nLucknow')).toBe('"Babuganj, ""Main"" Gate\nLucknow"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(4.4)).toBe("4.4");
    expect(csvRow(["a", null, 3])).toBe("a,,3\r\n");
  });
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
let seq = 0;

function lead(data: Record<string, unknown>) {
  seq++;
  const name = (data.name as string) ?? `Lead ${seq}`;
  return t.db.lead.create({ data: { name, normalizedName: name.toLowerCase(), dedupeKey: `exp:${seq}`, ...data } });
}

/** Minimal CSV parser for assertions (handles quotes and embedded new lines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADER = ["Name", "Category", "Phone", "Email", "Website", "Address", "City", "State", "Country", "Rating", "Reviews", "Maps URL", "Search Keyword", "Source", "Created At"];

beforeAll(async () => {
  t = await createTestApp();
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/token",
    payload: { email: t.credentials.email, password: t.credentials.password },
  });
  auth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.lead.deleteMany();
  await t.db.agentLog.deleteMany();
});

const get = (url: string) => t.app.inject({ method: "GET", url, headers: auth });

describe("GET /api/export/csv", () => {
  it("requires login", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/export/csv" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: "/api/export/xlsx" })).statusCode).toBe(401);
  });

  it("exports the spec columns with BOM, quoting, Hindi text, safe formulas and IST times", async () => {
    await lead({
      name: "ERA University",
      category: "University",
      phone: "+91 89579 26677",
      website: "http://www.erauniversity.in/",
      address: 'Tondan Marg, "Gate 2"\nSarfarazganj, Lucknow',
      city: "Lucknow",
      state: "Uttar Pradesh",
      country: "India",
      rating: 4.2,
      reviewCount: 1262,
      mapsUrl: "https://www.google.com/maps/place/ERA+University/",
      searchKeyword: "University",
      createdAt: new Date("2026-10-05T14:29:00Z"), // 19:59 IST
    });
    await lead({ name: "=HYPERLINK(\"http://evil.example\",\"click\")", city: "Lucknow", createdAt: new Date("2026-10-04T10:00:00Z") });
    await lead({ name: "एरा युनिवर्सिटी", city: "Lucknow", createdAt: new Date("2026-10-03T10:00:00Z") });

    const res = await get("/api/export/csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="leads-\d{4}-\d{2}-\d{2}_\d{4}\.csv"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.startsWith("﻿")).toBe(true);

    const rows = parseCsv(res.body.slice(1));
    expect(rows[0]).toEqual(HEADER);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual([
      "ERA University", "University", "+91 89579 26677", "", "http://www.erauniversity.in/",
      'Tondan Marg, "Gate 2"\nSarfarazganj, Lucknow', "Lucknow", "Uttar Pradesh", "India", "4.2", "1262",
      "https://www.google.com/maps/place/ERA+University/", "University", "google_maps", "2026-10-05 19:59",
    ]);
    expect(rows[2]![0]).toBe("'=HYPERLINK(\"http://evil.example\",\"click\")");
    expect(rows[3]![0]).toBe("एरा युनिवर्सिटी");
  });

  it("applies the same filters and sort as the leads list", async () => {
    await lead({ name: "B College", city: "Lucknow", category: "College", rating: 3.5 });
    await lead({ name: "A College", city: "Lucknow", category: "College", rating: 4.5 });
    await lead({ name: "Agra College", city: "Agra", category: "College", rating: 5 });

    const rows = parseCsv((await get("/api/export/csv?city=Lucknow&sort=rating&order=desc")).body.slice(1));
    expect(rows.slice(1).map((r) => r[0])).toEqual(["A College", "B College"]);

    const searched = parseCsv((await get("/api/export/csv?q=agra")).body.slice(1));
    expect(searched.slice(1).map((r) => r[0])).toEqual(["Agra College"]);
  });

  it("exports only selected ids", async () => {
    const a = await lead({ name: "Selected A" });
    await lead({ name: "Not selected" });
    const b = await lead({ name: "Selected B" });
    const rows = parseCsv((await get(`/api/export/csv?ids=${a.id},${b.id},${a.id},missing-id`)).body.slice(1));
    expect(rows.slice(1).map((r) => r[0]).sort()).toEqual(["Selected A", "Selected B"]);
  });

  it("rejects bad parameters with a JSON error", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `id${i}`).join(",");
    for (const qs of [`ids=${tooMany}`, "sort=password", "order=up"]) {
      const res = await get(`/api/export/csv?${qs}`);
      expect(res.statusCode, qs).toBe(400);
      expect(res.json().error.code).toBe("BAD_REQUEST");
    }
  });

  it("streams large exports across batches without gaps or repeats", async () => {
    const base = Date.parse("2026-01-01T00:00:00Z");
    await t.db.lead.createMany({
      data: Array.from({ length: 1205 }, (_, i) => ({
        name: `Bulk ${String(i).padStart(4, "0")}`,
        normalizedName: `bulk ${i}`,
        dedupeKey: `bulk:${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    });
    const rows = parseCsv((await get("/api/export/csv")).body.slice(1)).slice(1);
    expect(rows).toHaveLength(1205);
    expect(new Set(rows.map((r) => r[0])).size).toBe(1205);
    expect(rows[0]![0]).toBe("Bulk 1204"); // newest first by default
  });

  it("writes an audit log entry", async () => {
    await lead({ name: "Logged", city: "Lucknow" });
    await get("/api/export/csv?city=Lucknow");
    const log = await t.db.agentLog.findFirstOrThrow({ where: { action: "leads_exported" } });
    expect(log.message).toBe("1 leads as CSV (city=Lucknow)");
  });

  it("an empty result is just the header", async () => {
    const rows = parseCsv((await get("/api/export/csv?city=Nowhere")).body.slice(1));
    expect(rows).toEqual([HEADER]);
  });
});

describe("GET /api/export/xlsx", () => {
  it("produces a valid workbook with text phones, numbers, dates and a frozen filtered header", async () => {
    await lead({
      name: "ERA University",
      phone: "+918957926677",
      rating: 4.2,
      reviewCount: 1262,
      city: "Lucknow",
      createdAt: new Date("2026-10-05T14:29:00Z"),
    });
    await lead({ name: "=1+1", createdAt: new Date("2026-10-01T00:00:00Z") });

    const res = await get("/api/export/xlsx");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toMatch(/\.xlsx"$/);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Leads")!;
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(HEADER);
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.rowCount).toBe(3);

    const row = sheet.getRow(2);
    expect(row.getCell(1).value).toBe("ERA University");
    expect(row.getCell(3).value).toBe("+918957926677"); // text, "+" kept
    expect(row.getCell(10).value).toBe(4.2);
    expect(row.getCell(11).value).toBe(1262);
    const created = row.getCell(15).value as Date;
    expect(created.toISOString()).toBe("2026-10-05T19:59:00.000Z"); // IST wall clock
    expect(row.getCell(15).numFmt).toBe("yyyy-mm-dd hh:mm");

    // A formula-looking name is stored as plain text, never as a formula.
    expect(sheet.getRow(3).getCell(1).value).toBe("=1+1");
    expect(sheet.getRow(3).getCell(1).formula).toBeUndefined();
  });
});
