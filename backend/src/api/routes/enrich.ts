import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EnrichmentService } from "../../services/enrich/enrichmentService.js";
import { templateCsv, type BulkEnrichService } from "../../services/enrich/bulkEnrich.js";
import { IdParams } from "../validation.js";
import { requireSession } from "../middleware/auth.js";
import { parse } from "../validation.js";

const text = (max: number) => z.string().trim().max(max).nullish();

const FindBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  domain: text(253),
  company: text(200),
  linkedinUrl: text(500),
});

const MAX_BASE64 = Math.ceil((5 * 1024 * 1024 * 4) / 3); // 5 MB sheet

const JobBody = z.object({
  name: z.string().trim().max(120).default(""),
  fileName: z.string().trim().min(1).max(255),
  data: z.string().min(1).max(MAX_BASE64),
  useWebsites: z.boolean().default(true),
  useHunter: z.boolean().default(false),
  hunterBudget: z.number().int().min(0).max(1000).default(0),
});

export async function enrichRoutes(app: FastifyInstance, opts: { enrich: EnrichmentService; bulk: BulkEnrichService }) {
  const { enrich, bulk } = opts;

  // ---- Bulk: a sheet of companies / people ----
  app.get("/api/enrich/template.csv", async (_request, reply) =>
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="email-finder-sheet.csv"').send(templateCsv()),
  );
  app.post("/api/enrich/jobs", { bodyLimit: MAX_BASE64 + 64 * 1024 }, async (request) => {
    const body = parse(JobBody, request.body);
    return { job: await bulk.create({ ...body, data: Buffer.from(body.data, "base64") }) };
  });
  app.get("/api/enrich/jobs", async () => ({ items: await bulk.list() }));
  app.get("/api/enrich/jobs/:id", async (request) => {
    const q = parse(z.object({ page: z.coerce.number().int().min(1).max(100).default(1) }), request.query);
    return bulk.get(parse(IdParams, request.params).id, q.page);
  });
  app.post("/api/enrich/jobs/:id/:action", async (request) => {
    const { id, action } = parse(z.object({ id: z.string().min(1).max(64), action: z.enum(["pause", "resume", "stop"]) }), request.params);
    return { job: await bulk.setStatus(id, action) };
  });
  app.delete("/api/enrich/jobs/:id", async (request) => {
    await bulk.remove(parse(IdParams, request.params).id);
    return { ok: true };
  });
  app.get("/api/enrich/jobs/:id/export.csv", async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    let out = "";
    await bulk.exportCsv(id, (chunk) => void (out += chunk));
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="email-finder-results.csv"').send(out);
  });
  app.post("/api/enrich/jobs/:id/to-contacts", async (request) => {
    const { listName } = parse(z.object({ listName: z.string().trim().max(100).nullish() }), request.body ?? {});
    return bulk.toContacts(parse(IdParams, request.params).id, listName ?? null);
  });


  app.get("/api/enrich/status", async () => enrich.status());
  // The key is typed in the admin panel only (never in an extension).
  app.put("/api/enrich/hunter-key", async (request) => {
    requireSession(request);
    const { key } = parse(z.object({ key: z.string().max(200).nullable() }), request.body);
    return enrich.setKey(key);
  });
  app.post("/api/enrich/refresh", async () => enrich.refresh());

  // Contact Finder (extension, bearer token) and the admin panel.
  app.post("/api/enrich/find-email", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => enrich.findEmail(parse(FindBody, request.body)));
  app.post("/api/enrich/verify-email", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) =>
    enrich.verifyEmail(parse(z.object({ email: z.string().trim().min(3).max(254) }), request.body).email),
  );
  app.post("/api/enrich/domain-emails", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request) => {
    const body = parse(z.object({ domain: z.string().trim().min(3).max(253), limit: z.number().int().min(1).max(5).optional() }), request.body);
    return enrich.domainEmails(body.domain, body.limit);
  });
}
