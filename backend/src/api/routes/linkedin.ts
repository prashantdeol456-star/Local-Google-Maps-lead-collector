import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LINKEDIN_SORT_FIELDS, type LinkedInLeadFilters } from "../../database/repositories/index.js";
import type { LinkedInService } from "../../services/linkedin/linkedinService.js";
import { formatWallClock } from "../../utils/time.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const text = (max: number) => z.string().max(max).nullish();
const list = <T extends z.ZodType>(item: T) => z.array(item).max(20).optional();

const LeadFields = {
  name: z.string().trim().min(1).max(300),
  headline: text(500),
  company: text(300),
  location: text(300),
  emails: list(z.email().max(254)),
  phones: list(z.string().trim().min(1).max(50)),
  websites: list(z.object({ url: z.string().trim().min(1).max(2000), label: z.string().max(100).nullish().transform((v) => v ?? null) })),
  ims: list(z.string().trim().min(1).max(300)),
  experience: z
    .array(
      z.object({
        title: z.string().max(300),
        company: z.string().max(300).nullish().transform((v) => v ?? null),
        employmentType: z.string().max(100).nullish().transform((v) => v ?? null),
        dates: z.string().max(200).nullish().transform((v) => v ?? null),
        location: z.string().max(300).nullish().transform((v) => v ?? null),
      }),
    )
    .max(50)
    .optional(),
  education: z
    .array(
      z.object({
        school: z.string().max(300),
        degree: z.string().max(300).nullish().transform((v) => v ?? null),
        dates: z.string().max(200).nullish().transform((v) => v ?? null),
      }),
    )
    .max(50)
    .optional(),
  birthday: text(50),
  address: text(500),
  connectedSince: text(50),
  notes: text(2000),
  tag: text(100),
};

const SaveBody = z.object({
  lead: z.object({ profileUrl: z.string().trim().min(1).max(2000), ...LeadFields }),
});

const UpdateBody = z.object(LeadFields).partial().strict();

const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

const Filters = z.object({
  q: optionalText(200),
  company: optionalText(300),
  tag: optionalText(100),
  source: z.enum(["extension", "csv", "admin"]).optional(),
  hasEmail: bool,
  hasPhone: bool,
  hasWebsite: bool,
  sort: z.enum(LINKEDIN_SORT_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const ListQuery = Pagination.extend(Filters.shape);

const CheckBody = z.object({ profileUrls: z.array(z.string().max(2000)).max(500) });

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const ImportBody = z.object({ csv: z.string().min(1).max(MAX_CSV_BYTES), tag: z.string().trim().max(100).nullish() });

function filtersOf(q: z.infer<typeof Filters>): LinkedInLeadFilters {
  return { q: q.q, company: q.company, tag: q.tag, source: q.source, hasEmail: q.hasEmail, hasPhone: q.hasPhone, hasWebsite: q.hasWebsite, sort: q.sort, order: q.order };
}

export async function linkedinRoutes(app: FastifyInstance, opts: { linkedin: LinkedInService; timeZone: string }) {
  const { linkedin } = opts;

  // LinkedIn Helper extension: save the profile the user has open (create or merge).
  app.post("/api/linkedin/leads", async (request, reply) => {
    const { lead } = parse(SaveBody, request.body);
    const saved = await linkedin.save(lead, request.authMethod === "token" ? "extension" : "admin");
    return reply.code(saved.result === "new" ? 201 : 200).send(saved);
  });

  app.post("/api/linkedin/leads/check", async (request) => ({ saved: await linkedin.check(parse(CheckBody, request.body).profileUrls) }));

  app.post("/api/linkedin/import", { bodyLimit: MAX_CSV_BYTES + 64 * 1024 }, async (request) => {
    const body = parse(ImportBody, request.body);
    return linkedin.importCsv(body.csv, body.tag ?? null);
  });

  app.get("/api/linkedin/leads", async (request) => {
    const query = parse(ListQuery, request.query);
    const result = await linkedin.list({ ...filtersOf(query), ...toSkipTake(query) });
    return { ...result, page: query.page, pageSize: query.pageSize };
  });

  app.get("/api/linkedin/facets", async () => linkedin.facets());

  app.get("/api/linkedin/leads/:id", async (request) => ({ lead: await linkedin.get(parse(IdParams, request.params).id) }));

  app.patch("/api/linkedin/leads/:id", async (request) => ({
    lead: await linkedin.update(parse(IdParams, request.params).id, parse(UpdateBody, request.body)),
  }));

  app.delete("/api/linkedin/leads/:id", async (request) => {
    await linkedin.delete(parse(IdParams, request.params).id);
    return { deleted: true };
  });

  app.get("/api/linkedin/export.csv", async (request, reply) => {
    const filters = filtersOf(parse(Filters, request.query));
    const stamp = formatWallClock(new Date(), opts.timeZone).replace(" ", "_").replace(":", "");
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="linkedin-leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    try {
      await linkedin.writeCsv(filters, res);
      res.end();
    } catch (err) {
      request.log.error(err, "linkedin export failed");
      res.destroy(err as Error);
    }
  });
}
