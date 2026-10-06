import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { WhatsAppWebhookRejected, type WhatsAppProvider } from "../../providers/whatsapp/index.js";
import type { WhatsAppService } from "../../services/whatsapp/whatsappService.js";
import { Errors } from "../../utils/errors.js";
import { parse } from "../validation.js";

const SendTestBody = z.object({
  to: z.string().trim().min(6).max(30),
  templateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "template names use lowercase letters, digits and _"),
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'language code like "en", "en_US" or "hi"'),
  params: z
    .array(z.object({ name: z.string().trim().regex(/^[a-z0-9_]+$/).optional(), value: z.string().min(1).max(1024) }))
    .max(20)
    .default([]),
});

export async function whatsappRoutes(app: FastifyInstance, opts: { whatsapp: WhatsAppService }) {
  app.get("/api/whatsapp/provider", async () => opts.whatsapp.info());

  app.post("/api/whatsapp/send-test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    return opts.whatsapp.sendTest(parse(SendTestBody, request.body));
  });
}

/**
 * Public webhook for the WhatsApp provider.
 * GET: Meta's subscription check (hub.verify_token must match META_WA_VERIFY_TOKEN).
 * POST: accepted only with a valid X-Hub-Signature-256; verified events go to `onEvents`
 * (delivery/read statuses, replies, opt-outs). Answers 200 quickly so Meta does not retry.
 */
export async function whatsappWebhookRoutes(
  app: FastifyInstance,
  opts: { provider: WhatsAppProvider; onEvents?: (events: Awaited<ReturnType<WhatsAppProvider["handleWebhook"]>>) => Promise<unknown> },
) {
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get<{ Params: { provider: string }; Querystring: Record<string, string | undefined> }>("/api/webhooks/whatsapp/:provider", async (request, reply) => {
    if (request.params.provider !== opts.provider.name) throw Errors.notFound("Unknown webhook");
    const challenge = opts.provider.verifySubscription(request.query);
    if (challenge === null) return reply.code(403).send({ error: { code: "VERIFY_TOKEN_MISMATCH", message: "Verification failed" } });
    return reply.type("text/plain").send(challenge);
  });

  app.post<{ Params: { provider: string } }>(
    "/api/webhooks/whatsapp/:provider",
    { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (request.params.provider !== opts.provider.name) throw Errors.notFound("Unknown webhook");
      try {
        const events = await opts.provider.handleWebhook({
          headers: request.headers as Record<string, string | string[] | undefined>,
          body: typeof request.body === "string" ? request.body : "",
        });
        const handled = opts.onEvents ? await opts.onEvents(events) : null;
        return { received: events.length, handled };
      } catch (err) {
        if (err instanceof WhatsAppWebhookRejected) {
          request.log.warn("whatsapp webhook rejected: bad signature");
          return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
        }
        if (err instanceof SyntaxError) throw Errors.badRequest("Invalid JSON");
        throw err;
      }
    },
  );
}
