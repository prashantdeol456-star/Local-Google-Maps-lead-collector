import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebhookWorker } from "../../jobs/webhookWorker.js";
import { EVENT_DESCRIPTIONS, INTEGRATION_EVENTS, type IntegrationService } from "../../services/integrations/integrationService.js";
import { Errors } from "../../utils/errors.js";
import { requireSession } from "../middleware/auth.js";
import { IdParams, Pagination, parse, toSkipTake } from "../validation.js";

const EndpointBody = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.enum(INTEGRATION_EVENTS)).min(1, "Choose at least one event"),
  enabled: z.boolean().optional(),
});

const DeliveriesQuery = Pagination.extend({ status: z.enum(["pending", "delivered", "failed"]).optional() });

/** Integration settings: admin panel only (a bearer token, e.g. n8n\x27s, cannot change them). */
export async function integrationRoutes(app: FastifyInstance, opts: { integrations: IntegrationService; worker: WebhookWorker }) {
  const { integrations, worker } = opts;
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/integrations")) requireSession(request);
  });

  app.get("/api/integrations/events", async () => ({
    events: INTEGRATION_EVENTS.map((type) => ({ type, description: EVENT_DESCRIPTIONS[type] })),
  }));

  app.get("/api/integrations/webhooks", async () => ({ items: await integrations.list() }));

  app.post("/api/integrations/webhooks", async (request, reply) => reply.code(201).send(await integrations.create(parse(EndpointBody, request.body))));

  app.patch("/api/integrations/webhooks/:id", async (request) => ({
    endpoint: await integrations.update(parse(IdParams, request.params).id, parse(EndpointBody.partial().strict(), request.body)),
  }));

  app.post("/api/integrations/webhooks/:id/rotate-secret", async (request) => integrations.rotateSecret(parse(IdParams, request.params).id));

  app.delete("/api/integrations/webhooks/:id", async (request) => {
    await integrations.remove(parse(IdParams, request.params).id);
    return { ok: true };
  });

  /** Sends a "ping" event now and reports what the receiver answered. */
  app.post("/api/integrations/webhooks/:id/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const { id } = parse(IdParams, request.params);
    const eventId = await integrations.queuePing(id);
    const delivery = (await integrations.deliveries(id, { skip: 0, take: 20 })).items.find((d) => d.eventId === eventId);
    if (!delivery) throw Errors.notFound("Test event was not queued");
    return { result: await worker.deliver(delivery, { retry: false }), deliveryId: delivery.id };
  });

  app.get("/api/integrations/webhooks/:id/deliveries", async (request) => {
    const { id } = parse(IdParams, request.params);
    await integrations.get(id); // 404
    const query = parse(DeliveriesQuery, request.query);
    const { items, total } = await integrations.deliveries(id, { status: query.status, ...toSkipTake(query) });
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  /** Sends a delivery again now (e.g. after fixing the n8n workflow). */
  app.post("/api/integrations/deliveries/:id/retry", async (request) => {
    const { id } = parse(IdParams, request.params);
    const delivery = await worker.find(id);
    if (!delivery) throw Errors.notFound("Delivery not found");
    return { result: await worker.deliver(delivery, { retry: false }) };
  });
}
