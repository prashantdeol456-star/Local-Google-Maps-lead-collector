import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { LEAD_SORT_FIELDS } from "../../database/repositories/index.js";
import type { ExportSelection, ExportService } from "../../services/export/exportService.js";
import { formatWallClock } from "../../utils/time.js";
import { parse } from "../validation.js";
import { LeadFilterShape, toLeadFilters } from "../leadFilters.js";

export const MAX_EXPORT_IDS = 500;

/** Same filters as GET /api/leads (no paging), or `ids` = comma-separated selected lead ids. */
const ExportQuery = z.object({
  ...LeadFilterShape,
  sort: z.enum(LEAD_SORT_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  ids: z
    .string()
    .max(MAX_EXPORT_IDS * 65)
    .optional()
    .transform((v) => (v ? [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))] : undefined))
    .refine((ids) => !ids || (ids.length <= MAX_EXPORT_IDS && ids.every((id) => id.length <= 64)), `ids: at most ${MAX_EXPORT_IDS}`),
});

const FORMATS = {
  csv: { contentType: "text/csv; charset=utf-8", extension: "csv" },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
} as const;

export async function exportRoutes(app: FastifyInstance, opts: { exporter: ExportService; timeZone: string }) {
  const { exporter } = opts;

  async function send(format: keyof typeof FORMATS, request: FastifyRequest, reply: FastifyReply) {
    const query = parse(ExportQuery, request.query); // validation errors are normal JSON 400s
    const selection: ExportSelection = query.ids
      ? { ids: query.ids }
      : { filters: { ...toLeadFilters(query, opts.timeZone), sort: query.sort, order: query.order } };

    const stamp = formatWallClock(new Date(), opts.timeZone).replace(" ", "_").replace(":", "");
    const { contentType, extension } = FORMATS[format];

    // Stream straight to the client: memory use stays flat for any number of leads.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="leads-${stamp}.${extension}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    try {
      const count = format === "csv" ? await exporter.writeCsv(selection, res) : await exporter.writeXlsx(selection, res);
      if (!res.writableEnded) res.end();
      await exporter.logExport(format, count, selection);
    } catch (err) {
      // Headers are already sent; abort the connection so the client sees a failed download, not a truncated file.
      request.log.error(err, "export failed");
      res.destroy(err as Error);
    }
  }

  app.get("/api/export/csv", (request, reply) => send("csv", request, reply));
  app.get("/api/export/xlsx", (request, reply) => send("xlsx", request, reply));
}
