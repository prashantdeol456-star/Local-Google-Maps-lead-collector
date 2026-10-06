import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Repositories } from "../../database/repositories/index.js";
import type { RecipientSelection } from "../../services/outreach/campaignLifecycle.js";
import type { WhatsAppConsentService } from "../../services/whatsapp/consent.js";
import type { WhatsAppCampaignService } from "../../services/whatsapp/whatsappCampaignService.js";
import { APPROVAL_STATUSES, TEMPLATE_CATEGORIES, type WhatsAppTemplateService } from "../../services/whatsapp/whatsappTemplateService.js";
import { IdParams, Pagination, parse, toSkipTake } from "../validation.js";
import { AttemptsQuery, CampaignBody, Recipients } from "./campaigns.js";

const ParamFormat = z.enum(["positional", "named"]);

const TemplateBody = z.object({
  name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Use the exact template name from WhatsApp Manager (lowercase letters, digits and _)"),
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'Language code like "en", "en_US" or "hi"'),
  category: z.enum(TEMPLATE_CATEGORIES),
  paramFormat: ParamFormat,
  // WhatsApp allows at most 1024 characters in a template body.
  body: z.string().trim().min(1).max(1024),
  externalTemplateId: z.string().trim().regex(/^\d{1,30}$/, "Template ID is the number shown in WhatsApp Manager").nullish(),
  approvalStatus: z.enum(APPROVAL_STATUSES),
});

const PreviewBody = z.object({
  body: z.string().max(1024),
  paramFormat: ParamFormat,
  leadId: z.string().min(1).max(64).optional(),
});

const OptInBody = z.object({
  /** How the person agreed, e.g. "Asked us on the phone, 6 Oct" or "Website enquiry form". */
  source: z.string().trim().min(3).max(300),
});
const WithdrawBody = z.object({ reason: z.string().trim().min(1).max(300).default("Withdrawn by admin") });

export async function whatsappCampaignRoutes(
  app: FastifyInstance,
  opts: { templates: WhatsAppTemplateService; campaigns: WhatsAppCampaignService; consent: WhatsAppConsentService; repos: Repositories },
) {
  const { templates, campaigns, consent } = opts;

  // ---- Templates ----
  app.get("/api/whatsapp/templates", async () => ({ items: await templates.list() }));
  app.post("/api/whatsapp/templates", async (request, reply) =>
    reply.code(201).send({ template: await templates.create(parse(TemplateBody, request.body)) }),
  );
  app.post("/api/whatsapp/templates/preview", async (request) => {
    const body = parse(PreviewBody, request.body);
    return templates.preview(body, body.leadId);
  });
  app.get("/api/whatsapp/templates/:id", async (request) => ({ template: await templates.get(parse(IdParams, request.params).id) }));
  app.patch("/api/whatsapp/templates/:id", async (request) => ({
    template: await templates.update(parse(IdParams, request.params).id, parse(TemplateBody.partial().strict(), request.body)),
  }));
  app.delete("/api/whatsapp/templates/:id", async (request) => {
    await templates.delete(parse(IdParams, request.params).id);
    return { ok: true };
  });

  // ---- Opt-in ----
  app.post("/api/leads/:id/whatsapp-opt-in", async (request) => ({
    preference: await consent.recordOptIn(parse(IdParams, request.params).id, parse(OptInBody, request.body).source),
  }));
  app.delete("/api/leads/:id/whatsapp-opt-in", async (request) => ({
    preference: await consent.withdraw(parse(IdParams, request.params).id, parse(WithdrawBody, request.body ?? {}).reason),
  }));

  // ---- Received messages (replies and messages from unknown numbers) ----
  app.get("/api/whatsapp/inbox", async (request) => {
    const page = parse(Pagination, request.query);
    const { items, total } = await opts.repos.whatsappEvents.listReceived(toSkipTake(page));
    return {
      items: items.map((e) => ({ ...e, metadata: e.metadata ? (JSON.parse(e.metadata) as unknown) : null })),
      total,
      page: page.page,
      pageSize: page.pageSize,
    };
  });

  // ---- Campaigns ----
  app.post("/api/whatsapp/campaigns/recipients", async (request) => {
    const body = parse(z.object({ recipients: Recipients, templateId: z.string().min(1).max(64).optional() }), request.body);
    return campaigns.recipientSummary(body.recipients as RecipientSelection, body.templateId);
  });

  app.post("/api/whatsapp/campaigns", async (request, reply) => {
    const body = parse(CampaignBody, request.body);
    const created = await campaigns.create(
      { ...body, recipients: body.recipients as RecipientSelection, startAt: body.startAt ? new Date(body.startAt) : null },
      request.admin!.id,
    );
    return reply.code(201).send(created);
  });

  app.get("/api/whatsapp/campaigns", async (request) => {
    const page = parse(Pagination, request.query);
    const { items, total } = await campaigns.list(toSkipTake(page));
    return { items, total, page: page.page, pageSize: page.pageSize };
  });

  app.get("/api/whatsapp/campaigns/:id", async (request) => campaigns.get(parse(IdParams, request.params).id));

  app.get("/api/whatsapp/campaigns/:id/attempts", async (request) => {
    const { id } = parse(IdParams, request.params);
    const query = parse(AttemptsQuery, request.query);
    await campaigns.get(id); // 404
    const { items, total } = await campaigns.attempts(id, { status: query.status, ...toSkipTake(query) });
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.post("/api/whatsapp/campaigns/:id/start", async (request) => ({ campaign: await campaigns.start(parse(IdParams, request.params).id) }));
  app.post("/api/whatsapp/campaigns/:id/pause", async (request) => ({ campaign: await campaigns.pause(parse(IdParams, request.params).id) }));
  app.post("/api/whatsapp/campaigns/:id/stop", async (request) => ({ campaign: await campaigns.stop(parse(IdParams, request.params).id) }));
}
