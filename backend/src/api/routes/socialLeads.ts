import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SocialLeadService } from "../../services/social/socialLeadService.js";
import { formatWallClock } from "../../utils/time.js";
import { optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const text = (max: number) => z.string().max(max).nullish();

const LeadBody = z.object({
  platform: z.enum(["instagram", "facebook"]),
  kind: z.enum(["profile", "page", "group"]),
  url: z.string().trim().min(1).max(2000),
  handle: text(100),
  name: z.string().trim().min(1).max(300),
  bio: text(4000),
  category: text(300),
  followers: z.number().int().min(0).max(10_000_000_000).nullish(),
  audienceText: text(100),
  privacy: text(30),
  email: text(254),
  phone: text(50),
  website: text(2000),
  location: text(300),
  keyword: text(100),
  tag: text(100),
});

const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

const Filters = z.object({
  platform: z.enum(["instagram", "facebook"]).optional(),
  kind: z.enum(["profile", "page", "group"]).optional(),
  q: optionalText(200),
  keyword: optionalText(100),
  tag: optionalText(100),
  hasEmail: bool,
  hasPhone: bool,
});

const Ids = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(5000) });

export async function socialLeadRoutes(app: FastifyInstance, opts: { socialLeads: SocialLeadService; timeZone: string }) {
  const { socialLeads } = opts;

  // Meta Helper extension
  app.post("/api/social-leads", async (request) => socialLeads.saveMany(parse(z.object({ leads: z.array(LeadBody).min(1).max(200) }), request.body).leads));
  app.post("/api/social-leads/check", async (request) => {
    const body = parse(z.object({ platform: z.enum(["instagram", "facebook"]), urls: z.array(z.string().max(2000)).max(500) }), request.body);
    return { saved: await socialLeads.check(body.platform, body.urls) };
  });

  // Admin panel
  app.get("/api/social-leads", async (request) => {
    const query = parse(Pagination.extend(Filters.shape), request.query);
    const result = await socialLeads.list({ ...query, ...toSkipTake(query) });
    return { ...result, page: query.page, pageSize: query.pageSize };
  });
  app.get("/api/social-leads/facets", async () => socialLeads.facets());
  app.post("/api/social-leads/delete", async (request) => ({ deleted: await socialLeads.deleteMany(parse(Ids, request.body).ids) }));
  app.post("/api/social-leads/to-contacts", async (request) => {
    const body = parse(Ids.extend({ listName: z.string().trim().max(100).nullish() }), request.body);
    return socialLeads.toContacts(body.ids, body.listName || null);
  });
  app.get("/api/social-leads/export.csv", async (request, reply) => {
    const filters = parse(Filters, request.query);
    const stamp = formatWallClock(new Date(), opts.timeZone).replace(" ", "_").replace(":", "");
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="social-leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    try {
      await socialLeads.writeCsv(filters, res);
      res.end();
    } catch (err) {
      request.log.error(err, "social leads export failed");
      res.destroy(err as Error);
    }
  });
}
