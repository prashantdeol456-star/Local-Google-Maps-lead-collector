import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ENGAGEMENT_KINDS, ENGAGEMENT_PLATFORMS, PERSON_STATUSES, type EngagementService } from "../../services/engagement/engagementService.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const Platform = z.enum(ENGAGEMENT_PLATFORMS).optional();
const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const ActivityQuery = Pagination.extend({
  platform: Platform,
  kind: z.enum(ENGAGEMENT_KINDS).optional(),
  accountId: z.string().max(64).optional(),
  postId: z.string().max(64).optional(),
  leadOnly: bool,
  unreplied: bool,
  q: optionalText(200),
});

const PostsQuery = Pagination.extend({ platform: Platform, accountId: z.string().max(64).optional() });

const PeopleQuery = Pagination.extend({
  platform: Platform,
  status: z.enum(PERSON_STATUSES).optional(),
  leadOnly: bool,
  q: optionalText(200),
  sort: z.enum(["recent", "active"]).optional(),
});

const PersonPatch = z
  .object({ status: z.enum(PERSON_STATUSES), notes: z.string().max(2000).nullable() })
  .partial()
  .strict();

export async function engagementRoutes(app: FastifyInstance, opts: { engagement: EngagementService }) {
  const { engagement } = opts;

  app.get("/api/engagement/summary", async () => engagement.summary());
  app.get("/api/engagement/accounts", async () => ({ items: await engagement.accounts() }));
  app.post("/api/engagement/accounts/:id/sync", async (request) => engagement.syncAccount(parse(IdParams, request.params).id));

  app.get("/api/engagement/activity", async (request) => {
    const q = parse(ActivityQuery, request.query);
    return { ...(await engagement.activity({ ...q, ...toSkipTake(q) })), page: q.page, pageSize: q.pageSize };
  });
  app.get("/api/engagement/posts", async (request) => {
    const q = parse(PostsQuery, request.query);
    return { ...(await engagement.posts({ ...q, ...toSkipTake(q) })), page: q.page, pageSize: q.pageSize };
  });
  app.get("/api/engagement/people", async (request) => {
    const q = parse(PeopleQuery, request.query);
    return { ...(await engagement.people({ ...q, ...toSkipTake(q) })), page: q.page, pageSize: q.pageSize };
  });
  app.get("/api/engagement/people/export.csv", async (request, reply) => {
    const q = parse(PeopleQuery.pick({ platform: true, status: true, leadOnly: true }), request.query);
    reply.raw.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="social-engagement-people.csv"`,
    });
    await engagement.exportPeople((chunk) => void reply.raw.write(chunk), q);
    reply.raw.end();
    return reply;
  });
  app.get("/api/engagement/people/:id", async (request) => engagement.personDetail(parse(IdParams, request.params).id));
  app.patch("/api/engagement/people/:id", async (request) => ({ person: await engagement.updatePerson(parse(IdParams, request.params).id, parse(PersonPatch, request.body)) }));
  app.delete("/api/engagement/people/:id", async (request) => {
    await engagement.removePerson(parse(IdParams, request.params).id);
    return { ok: true };
  });
  app.post("/api/engagement/people/:id/contact", async (request) => ({ person: await engagement.addToContacts(parse(IdParams, request.params).id) }));
  app.post("/api/engagement/comments/:id/reply", async (request) => {
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), request.body);
    return { engagement: await engagement.reply(parse(IdParams, request.params).id, text) };
  });

  // Webhook settings for the Meta app (super admins).
  app.get("/api/engagement/setup", async (request) => {
    requireSuperAdmin(request);
    return engagement.setup();
  });
}

/** Meta webhooks for Page feeds and Instagram comments. Own plugin: it reads the raw body. */
export async function engagementWebhookRoutes(app: FastifyInstance, opts: { engagement: EngagementService }) {
  const { engagement } = opts;
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get("/api/webhooks/meta/social", async (request, reply) => {
    const challenge = engagement.verifySubscription(request.query as Record<string, string | undefined>);
    if (!challenge) return reply.code(403).send("Forbidden");
    return reply.type("text/plain").send(challenge);
  });

  app.post("/api/webhooks/meta/social", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"];
    const ok = await engagement.handleWebhook(typeof request.body === "string" ? request.body : "", typeof signature === "string" ? signature : undefined);
    return reply.code(ok ? 200 : 401).send(ok ? "OK" : "Invalid signature");
  });
}
