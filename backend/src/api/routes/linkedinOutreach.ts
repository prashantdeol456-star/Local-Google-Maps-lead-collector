import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MAX_LINKEDIN_DAILY_LIMIT,
  MIN_LINKEDIN_INTERVAL_SEC,
  type LinkedInOutreachService,
  type LinkedInRecipients,
} from "../../services/linkedin/outreachService.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const Recipients = z.union([
  z.object({ contactIds: z.array(z.string().min(1).max(64)).min(1).max(5000) }),
  z.object({ filters: z.object({ listName: optionalText(100), q: optionalText(200) }) }),
]);

const Platform = z.enum(["linkedin", "instagram"]);

const CampaignBody = z.object({
  platform: Platform.default("linkedin"),
  name: z.string().trim().min(1).max(120),
  templateId: z.string().min(1).max(64),
  mode: z.enum(["assisted", "auto"]),
  recipients: Recipients,
  intervalSec: z.number().int().min(MIN_LINKEDIN_INTERVAL_SEC).max(86_400),
  dailyLimit: z.number().int().min(1).max(MAX_LINKEDIN_DAILY_LIMIT),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/),
  startAt: z.iso.datetime().nullish(),
});

const MessagesQuery = Pagination.extend({
  status: z.enum(["queued", "sending", "sent", "delivered", "failed", "skipped", "cancelled"]).optional(),
});

const ResultBody = z.object({
  status: z.enum(["sent", "failed", "skipped", "blocked"]),
  error: z.string().trim().max(1000).nullish(),
});

export async function linkedinOutreachRoutes(app: FastifyInstance, opts: { outreach: LinkedInOutreachService }) {
  const { outreach } = opts;

  // ---- Admin panel ----
  app.post("/api/linkedin-outreach/recipients", async (request) => {
    const { recipients, platform } = parse(z.object({ recipients: Recipients, platform: Platform.default("linkedin") }), request.body);
    return outreach.recipients(recipients as LinkedInRecipients, platform);
  });

  app.post("/api/linkedin-outreach/campaigns", async (request, reply) => {
    const body = parse(CampaignBody, request.body);
    const created = await outreach.create(
      { ...body, recipients: body.recipients as LinkedInRecipients, startAt: body.startAt ? new Date(body.startAt) : null },
      request.admin!.id,
    );
    return reply.code(201).send(created);
  });

  app.get("/api/linkedin-outreach/campaigns", async (request) => {
    const page = parse(Pagination.extend({ platform: Platform.optional() }), request.query);
    const { items, total } = await outreach.list({ ...toSkipTake(page), platform: page.platform });
    return { items, total, page: page.page, pageSize: page.pageSize };
  });

  app.get("/api/linkedin-outreach/campaigns/:id", async (request) => outreach.get(parse(IdParams, request.params).id));

  app.get("/api/linkedin-outreach/campaigns/:id/messages", async (request) => {
    const { id } = parse(IdParams, request.params);
    const query = parse(MessagesQuery, request.query);
    await outreach.get(id); // 404
    const { items, total } = await outreach.messages(id, { status: query.status, ...toSkipTake(query) });
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.patch("/api/linkedin-outreach/campaigns/:id/schedule", async (request) => {
    const body = parse(
      z
        .object({
          intervalSec: z.number().int().min(MIN_LINKEDIN_INTERVAL_SEC).max(86_400),
          dailyLimit: z.number().int().min(1).max(MAX_LINKEDIN_DAILY_LIMIT),
          windowStart: z.string().regex(/^\d{2}:\d{2}$/),
          windowEnd: z.string().regex(/^\d{2}:\d{2}$/),
        })
        .partial()
        .strict()
        .refine((b) => (b.windowStart === undefined) === (b.windowEnd === undefined), "Send windowStart and windowEnd together"),
      request.body,
    );
    return { campaign: await outreach.updateSchedule(parse(IdParams, request.params).id, body) };
  });

  app.post("/api/linkedin-outreach/campaigns/:id/start", async (request) => ({ campaign: await outreach.start(parse(IdParams, request.params).id) }));
  app.post("/api/linkedin-outreach/campaigns/:id/pause", async (request) => ({ campaign: await outreach.pause(parse(IdParams, request.params).id) }));
  app.post("/api/linkedin-outreach/campaigns/:id/stop", async (request) => ({ campaign: await outreach.stop(parse(IdParams, request.params).id) }));

  // ---- LinkedIn Messenger extension ----
  // The LinkedIn Messenger asks without a platform (= linkedin); the Meta Helper asks for instagram.
  const platformOf = (query: unknown) => parse(z.object({ platform: Platform.default("linkedin") }), query ?? {}).platform;
  app.get("/api/linkedin-outreach/overview", async (request) => ({ campaigns: await outreach.overview(undefined, platformOf(request.query)) }));
  app.post("/api/linkedin-outreach/next", async (request) => outreach.next(undefined, platformOf(request.query)));
  app.post("/api/linkedin-outreach/messages/:id/result", async (request) => {
    const { id } = parse(IdParams, request.params);
    const body = parse(ResultBody, request.body);
    return { message: await outreach.report(id, body.status, body.error ?? null) };
  });
}
