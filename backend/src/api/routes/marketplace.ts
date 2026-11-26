import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PORTAL_KINDS, type MarketplaceService } from "../../services/marketplace/marketplaceService.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const Config = z
  .object({ key: z.string().trim().max(300), userId: z.string().trim().max(100), profileId: z.string().trim().max(100), url: z.string().trim().max(2000) })
  .partial();

const CreateBody = z.object({
  kind: z.enum(PORTAL_KINDS as ["indiamart", "tradeindia", "custom"]),
  name: z.string().trim().max(80).nullish(),
  config: Config,
  waTemplateId: z.string().max(64).nullish(),
});

const PatchBody = z
  .object({ name: z.string().trim().max(80), enabled: z.boolean(), waTemplateId: z.string().max(64).nullable(), config: Config })
  .partial()
  .strict();

const LeadsQuery = Pagination.extend({ sourceId: z.string().max(64).optional(), q: optionalText(200), followUp: z.enum(["none", "sent", "failed", "skipped"]).optional() });

export async function marketplaceRoutes(app: FastifyInstance, opts: { marketplace: MarketplaceService }) {
  const { marketplace } = opts;
  app.get("/api/marketplace/sources", async () => ({ items: await marketplace.sources() }));
  app.post("/api/marketplace/sources", async (request) => ({ source: await marketplace.create(parse(CreateBody, request.body)) }));
  app.patch("/api/marketplace/sources/:id", async (request) => ({ source: await marketplace.update(parse(IdParams, request.params).id, parse(PatchBody, request.body)) }));
  app.delete("/api/marketplace/sources/:id", async (request) => {
    const { withLeads } = parse(z.object({ withLeads: z.enum(["true", "false"]).optional() }), request.query);
    await marketplace.remove(parse(IdParams, request.params).id, withLeads === "true");
    return { ok: true };
  });
  app.post("/api/marketplace/sources/:id/pull", async (request) => marketplace.pull(parse(IdParams, request.params).id, { force: true }));
  app.get("/api/marketplace/leads", async (request) => {
    const q = parse(LeadsQuery, request.query);
    return { ...(await marketplace.leads({ ...q, ...toSkipTake(q) })), page: q.page, pageSize: q.pageSize };
  });
  app.get("/api/marketplace/leads/export.csv", async (request, reply) => {
    const { sourceId } = parse(z.object({ sourceId: z.string().max(64).optional() }), request.query);
    let out = "";
    await marketplace.exportCsv((c) => void (out += c), { sourceId });
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="marketplace-leads.csv"').send(out);
  });
}
