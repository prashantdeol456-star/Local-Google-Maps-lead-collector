import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CampaignService, RecipientSelection } from "../../services/email/campaignService.js";
import type { TemplateService } from "../../services/email/templateService.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const TemplateBody = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});

const PreviewBody = z.object({
  subject: z.string().max(200),
  body: z.string().max(10_000),
  leadId: z.string().min(1).max(64).optional(),
});

export const Recipients = z.union([
  z.object({ leadIds: z.array(z.string().min(1).max(64)).min(1).max(5000) }),
  z.object({
    filters: z.object({
      q: optionalText(200),
      city: optionalText(100),
      category: optionalText(100),
      searchKeyword: optionalText(100),
    }),
  }),
]);

export const CampaignBody = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().min(1).max(64),
  recipients: Recipients,
  intervalSec: z.number().int().min(30).max(86_400),
  dailyLimit: z.number().int().min(1).max(2000),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/),
  startAt: z.iso.datetime().nullish(),
});

export const AttemptsQuery = Pagination.extend({
  status: z.enum(["queued", "sending", "sent", "delivered", "failed", "skipped", "cancelled"]).optional(),
});

export async function campaignRoutes(app: FastifyInstance, opts: { templates: TemplateService; campaigns: CampaignService }) {
  const { templates, campaigns } = opts;

  // ---- Templates ----
  app.get("/api/templates", async () => ({ items: await templates.list() }));
  app.post("/api/templates", async (request, reply) => reply.code(201).send({ template: await templates.create(parse(TemplateBody, request.body)) }));
  app.post("/api/templates/preview", async (request) => {
    const body = parse(PreviewBody, request.body);
    return templates.preview(body, body.leadId);
  });
  app.get("/api/templates/:id", async (request) => ({ template: await templates.get(parse(IdParams, request.params).id) }));
  app.patch("/api/templates/:id", async (request) => ({
    template: await templates.update(parse(IdParams, request.params).id, parse(TemplateBody.partial().strict(), request.body)),
  }));
  app.delete("/api/templates/:id", async (request) => {
    await templates.delete(parse(IdParams, request.params).id);
    return { ok: true };
  });

  // ---- Campaigns ----
  /** Recipient counts before creating (who has an email, who opted out…). */
  app.post("/api/email/campaigns/recipients", async (request) => {
    const selection = parse(z.object({ recipients: Recipients }), request.body).recipients as RecipientSelection;
    return (await campaigns.recipients(selection)).summary;
  });

  app.post("/api/email/campaigns", async (request, reply) => {
    const body = parse(CampaignBody, request.body);
    const created = await campaigns.create(
      { ...body, recipients: body.recipients as RecipientSelection, startAt: body.startAt ? new Date(body.startAt) : null },
      request.admin!.id,
    );
    return reply.code(201).send(created);
  });

  app.get("/api/email/campaigns", async (request) => {
    const page = parse(Pagination, request.query);
    const { items, total } = await campaigns.list(toSkipTake(page));
    return { items, total, page: page.page, pageSize: page.pageSize };
  });

  app.get("/api/email/campaigns/:id", async (request) => campaigns.get(parse(IdParams, request.params).id));

  app.get("/api/email/campaigns/:id/attempts", async (request) => {
    const { id } = parse(IdParams, request.params);
    const query = parse(AttemptsQuery, request.query);
    await campaigns.get(id); // 404
    const { items, total } = await campaigns.attempts(id, { status: query.status, ...toSkipTake(query) });
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get("/api/leads/:id/communications", async (request) => campaigns.leadHistory(parse(IdParams, request.params).id));

  app.post("/api/email/campaigns/:id/start", async (request) => ({ campaign: await campaigns.start(parse(IdParams, request.params).id) }));
  app.post("/api/email/campaigns/:id/pause", async (request) => ({ campaign: await campaigns.pause(parse(IdParams, request.params).id) }));
  app.post("/api/email/campaigns/:id/stop", async (request) => ({ campaign: await campaigns.stop(parse(IdParams, request.params).id) }));
}
