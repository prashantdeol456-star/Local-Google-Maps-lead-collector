import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { WebhookVerificationFailed, type EmailProvider } from "../../providers/email/index.js";
import type { TrackingService } from "../../services/email/trackingService.js";
import { Errors } from "../../utils/errors.js";
import { IdParams, parse } from "../validation.js";

/**
 * Public, unauthenticated endpoints, protected in other ways:
 * - POST /api/webhooks/email/:provider — only accepted with a valid provider signature;
 * - GET  /t/c/:id — click redirect; ids are random and only lead to URLs we stored when sending.
 */
export async function trackingWebhookRoutes(app: FastifyInstance, opts: { provider: EmailProvider; tracking: TrackingService }) {
  // Signatures are computed over the exact body bytes, so keep the body as text here.
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));

  app.post<{ Params: { provider: string } }>(
    "/api/webhooks/email/:provider",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (request.params.provider !== opts.provider.name) throw Errors.notFound("Unknown webhook");
      let events;
      try {
        events = await opts.provider.handleWebhook({
          headers: request.headers as Record<string, string | string[] | undefined>,
          body: typeof request.body === "string" ? request.body : "",
        });
      } catch (err) {
        if (err instanceof WebhookVerificationFailed) {
          request.log.warn({ provider: request.params.provider }, "email webhook rejected: bad signature");
          return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
        }
        if (err instanceof SyntaxError) throw Errors.badRequest("Invalid JSON");
        throw err;
      }
      return opts.tracking.applyProviderEvents(events, opts.provider.name);
    },
  );
}

export async function clickRoutes(app: FastifyInstance, opts: { tracking: TrackingService }) {
  app.get<{ Params: { id: string } }>("/t/c/:id", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const id = request.params.id;
    const url = /^[A-Za-z0-9_-]{8,64}$/.test(id) ? await opts.tracking.click(id, request.headers["user-agent"]) : null;
    if (!url) {
      return reply.code(404).type("text/html; charset=utf-8").header("Cache-Control", "no-store").send("<!doctype html><title>Link not found</title><p>This link is not valid.</p>");
    }
    // Stored URLs are always http(s) (checked when sending), so this is never an open redirect.
    return reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").redirect(url, 302);
  });
}

const ReplyBody = z.object({ message: z.string().trim().min(1).max(10_000) });

export async function replyRoutes(app: FastifyInstance, opts: { tracking: TrackingService }) {
  // Logged by the admin from their inbox (automatic reply detection needs inbound email/IMAP).
  app.post("/api/email/attempts/:id/reply", async (request) => {
    const { id } = parse(IdParams, request.params);
    const { message } = parse(ReplyBody, request.body);
    await opts.tracking.logReply(id, message);
    return { ok: true };
  });
}
