import { once } from "node:events";
import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import type { LeadListQuery, LeadRecord, Repositories } from "../../database/repositories/index.js";
import { formatWallClock, toWallClock } from "../../utils/time.js";
import { csvRow, UTF8_BOM } from "./csv.js";

export type ExportFilters = Omit<LeadListQuery, "skip" | "take" | "createdBefore">;

/** Either the selected ids, or everything matching the filters. */
export type ExportSelection = { ids: string[] } | { filters: ExportFilters };

interface Column {
  header: string;
  width: number;
  value: (lead: LeadRecord) => string | number | null;
}

/** Export columns, in order (from the spec). */
export const EXPORT_COLUMNS: Column[] = [
  { header: "Name", width: 36, value: (l) => l.name },
  { header: "Category", width: 22, value: (l) => l.category },
  { header: "Phone", width: 18, value: (l) => l.phone },
  { header: "Email", width: 28, value: (l) => l.email },
  { header: "Website", width: 32, value: (l) => l.website },
  { header: "Address", width: 50, value: (l) => l.address },
  { header: "City", width: 16, value: (l) => l.city },
  { header: "State", width: 16, value: (l) => l.state },
  { header: "Country", width: 12, value: (l) => l.country },
  { header: "Rating", width: 8, value: (l) => l.rating },
  { header: "Reviews", width: 10, value: (l) => l.reviewCount },
  { header: "Maps URL", width: 40, value: (l) => l.mapsUrl },
  { header: "Search Keyword", width: 18, value: (l) => l.searchKeyword },
  { header: "Source", width: 12, value: (l) => l.source },
  { header: "Created At", width: 18, value: () => null }, // written per format below
];

const BATCH = 500;

async function write(out: Writable, chunk: string) {
  // Respect backpressure so a slow download never buffers the whole export in memory.
  if (!out.write(chunk)) await once(out, "drain");
}

export class ExportService {
  constructor(
    private readonly repos: Repositories,
    private readonly timeZone: string,
  ) {}

  /** Leads in batches. Filtered exports only include leads that existed when the export started. */
  async *batches(selection: ExportSelection): AsyncGenerator<LeadRecord[]> {
    if ("ids" in selection) {
      if (selection.ids.length) yield await this.repos.leads.findByIds(selection.ids);
      return;
    }
    const createdBefore = new Date();
    for (let skip = 0; ; skip += BATCH) {
      const { items } = await this.repos.leads.list({ ...selection.filters, createdBefore, skip, take: BATCH });
      if (items.length) yield items;
      if (items.length < BATCH) return;
    }
  }

  async writeCsv(selection: ExportSelection, out: Writable): Promise<number> {
    let count = 0;
    await write(out, UTF8_BOM + csvRow(EXPORT_COLUMNS.map((c) => c.header)));
    for await (const leads of this.batches(selection)) {
      let chunk = "";
      for (const lead of leads) {
        const values = EXPORT_COLUMNS.map((c) => c.value(lead));
        values[values.length - 1] = formatWallClock(lead.createdAt, this.timeZone);
        chunk += csvRow(values);
      }
      await write(out, chunk);
      count += leads.length;
    }
    return count;
  }

  async writeXlsx(selection: ExportSelection, out: Writable): Promise<number> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
    workbook.creator = "Google Maps Lead Platform";
    const sheet = workbook.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = EXPORT_COLUMNS.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width }));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.commit();

    let count = 0;
    for await (const leads of this.batches(selection)) {
      for (const lead of leads) {
        // Strings are written as text cells (never formulas), so phones like "+91…" keep their "+".
        const values: (string | number | Date | null)[] = EXPORT_COLUMNS.map((c) => c.value(lead));
        values[values.length - 1] = toWallClock(lead.createdAt, this.timeZone);
        const row = sheet.addRow(values);
        row.getCell(EXPORT_COLUMNS.length).numFmt = "yyyy-mm-dd hh:mm";
        row.commit();
      }
      count += leads.length;
    }
    sheet.commit();
    await workbook.commit();
    return count;
  }

  /** Audit trail entry for an export. */
  async logExport(format: "csv" | "xlsx", count: number, selection: ExportSelection) {
    let scope: string;
    if ("ids" in selection) scope = "selected leads";
    else {
      const f = selection.filters;
      const parts = [f.q && `search "${f.q}"`, f.city && `city=${f.city}`, f.category && `category=${f.category}`, f.searchKeyword && `keyword=${f.searchKeyword}`].filter(Boolean);
      scope = parts.length ? parts.join(", ") : "all leads";
    }
    await this.repos.agentLogs.create({
      jobId: null,
      action: "leads_exported",
      status: "info",
      message: `${count} leads as ${format.toUpperCase()} (${scope})`,
    });
  }
}
