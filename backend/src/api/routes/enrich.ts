import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EnrichmentService } from "../../services/enrich/enrichmentService.js";
import { requireSession } from "../middleware/auth.js";
import { parse } from "../validation.js";

const text = (max: number) => z.string().trim().max(max).nullish();

const FindBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  domain: text(253),
  company: text(200),
  linkedinUrl: text(500),
});

export async function enrichRoutes(app: FastifyInstance, opts: { enrich: EnrichmentService }) {
  const { enrich } = opts;

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
