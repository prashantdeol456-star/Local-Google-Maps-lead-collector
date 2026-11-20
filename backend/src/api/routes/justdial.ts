import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JustdialService } from "../../services/justdial/justdialService.js";
import { formatWallClock } from "../../utils/time.js";
import { IdParams, Pagination, parse, toSkipTake } from "../validation.js";

// Justdial leads (collected by the Maps Data Collector extension in Justdial mode).

const ListQuery = Pagination.extend({
  q: z.string().trim().max(200).optional(),
  keyword: z.string().trim().max(100).optional(),
  has: z.enum(["phone", "email", "website", "maps"]).optional(),
});

const AutoCampaignBody = z.object({ templateId: z.string().min(1).max(64).nullable() });

const ExportQuery = ListQuery.omit({ page: true, pageSize: true });

export async function justdialRoutes(app: FastifyInstance, opts: { justdial: JustdialService; timeZone: string }) {
  const { justdial } = opts;

  app.get("/api/justdial/leads", async (request) => {
    const query = parse(ListQuery, request.query);
    const { items, total } = await justdial.list({ q: query.q || undefined, keyword: query.keyword || undefined, has: query.has, ...toSkipTake(query) });
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get("/api/justdial/facets", async () => justdial.facets());

  app.get("/api/justdial/export.csv", async (request, reply) => {
    const query = parse(ExportQuery, request.query);
    const stamp = formatWallClock(new Date(), opts.timeZone).replace(" ", "_").replace(":", "");
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="justdial-leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    try {
      await justdial.writeCsv({ q: query.q || undefined, keyword: query.keyword || undefined, has: query.has }, res);
      res.end();
    } catch (err) {
      request.log.error(err, "justdial export failed");
      res.destroy(err as Error);
    }
  });

  /** Called by the extension when a Justdial collection starts: send its leads to an email campaign? */
  app.post("/api/justdial/jobs/:id/auto-campaign", async (request) => {
    const { id } = parse(IdParams, request.params);
    const body = parse(AutoCampaignBody, request.body);
    return { job: await justdial.setAutoCampaign(id, body.templateId) };
  });
}
