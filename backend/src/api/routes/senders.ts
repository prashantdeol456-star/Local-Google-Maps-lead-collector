import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ownerScope } from "../../database/ownerScope.js";
import { WebhookVerificationFailed } from "../../providers/email/index.js";
import { WhatsAppWebhookRejected } from "../../providers/whatsapp/index.js";
import type { SenderService } from "../../services/senders/senderService.js";
import type { TrackingService } from "../../services/email/trackingService.js";
import type { WhatsAppTrackingService } from "../../services/whatsapp/trackingService.js";
import { Errors } from "../../utils/errors.js";
import { parse } from "../validation.js";

// "My sender": a customer's own email and WhatsApp accounts (phase C), and the webhook URLs
// that report delivery, opens, replies and opt-outs for messages sent with them.

const ADDRESS = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/;
const NAMED_ADDRESS = /^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/;
const text = (max: number) => z.string().trim().max(max).nullish();

const EmailBody = z.object({
  provider: z.enum(["resend", "smtp", "log"]),
  from: z
    .string()
    .trim()
    .max(254)
    .refine((v) => ADDRESS.test(v) || NAMED_ADDRESS.test(v), 'From must look like "you@domain.com" or "Name <you@domain.com>"'),
  replyTo: z.string().trim().max(254).regex(ADDRESS, "Reply-to must be an email address").or(z.literal("")).nullish(),
  apiKey: text(500),
  webhookSecret: text(500),
  host: text(255),
  port: z.number().int().min(1).max(65535).nullish(),
  secure: z.boolean().nullish(),
  user: text(255),
  password: text(500),
});

const WhatsAppBody = z.object({
  provider: z.enum(["meta", "log"]),
  accessToken: text(2000),
  phoneNumberId: text(40),
  appSecret: text(200),
  verifyToken: text(200),
});

const Channel = z.object({ channel: z.enum(["email", "whatsapp"]) });
const TestBody = z.object({
  channel: z.enum(["email", "whatsapp"]),
  to: z.string().trim().min(3).max(254),
  templateName: z.string().trim().min(1).max(100).optional(),
  language: z.string().trim().min(2).max(20).optional(),
});

export async function senderRoutes(app: FastifyInstance, opts: { senders: SenderService }) {
  const { senders } = opts;
  const me = (request: { admin: { id: string } | null }) => request.admin!.id;

  app.get("/api/senders", async (request) => senders.view(me(request)));
  app.put("/api/senders/email", async (request) => senders.saveEmail(me(request), parse(EmailBody, request.body)));
  app.put("/api/senders/whatsapp", async (request) => senders.saveWhatsApp(me(request), parse(WhatsAppBody, request.body)));
  app.delete("/api/senders/:channel", async (request) => senders.clear(me(request), parse(Channel, request.params).channel));
  app.post("/api/senders/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const body = parse(TestBody, request.body);
    if (body.channel === "email" && !ADDRESS.test(body.to)) throw Errors.badRequest("Enter an email address");
    return senders.sendTest(me(request), body.channel, body.to, { name: body.templateName ?? "hello_world", language: body.language ?? "en_US" });
  });
}

/**
 * Webhooks for a customer's own sender: /api/webhooks/u/<token>/email/resend and
 * /api/webhooks/u/<token>/whatsapp/meta. Verified with that customer's secrets, and handled in
 * their data scope, so they can only touch their own messages.
 */
export async function senderWebhookRoutes(
  app: FastifyInstance,
  opts: { senders: SenderService; tracking: TrackingService; whatsappTracking: WhatsAppTrackingService },
) {
  // Signatures are computed over the exact body bytes.
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));

  const owner = async (token: string) => {
    const found = /^[A-Za-z0-9_-]{16,64}$/.test(token) ? await opts.senders.byWebhookToken(token) : null;
    if (!found) throw Errors.notFound("Unknown webhook");
    return found;
  };
  const inScope = <T>(ownerId: string, fn: () => Promise<T>) => ownerScope.run({ userId: ownerId, ownerId, customer: true }, fn);
  const raw = (request: { headers: unknown; body: unknown }) => ({
    headers: request.headers as Record<string, string | string[] | undefined>,
    body: typeof request.body === "string" ? request.body : "",
  });

  app.post<{ Params: { token: string; provider: string } }>(
    "/api/webhooks/u/:token/email/:provider",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { ownerId, email } = await owner(request.params.token);
      if (!email || email.name !== request.params.provider) throw Errors.notFound("Unknown webhook");
      let events;
      try {
        events = await email.handleWebhook(raw(request));
      } catch (err) {
        if (err instanceof WebhookVerificationFailed) {
          return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
        }
        if (err instanceof SyntaxError) throw Errors.badRequest("Invalid JSON");
        throw err;
      }
      return inScope(ownerId, () => opts.tracking.applyProviderEvents(events, email.name));
    },
  );

  app.get<{ Params: { token: string; provider: string }; Querystring: Record<string, string | undefined> }>(
    "/api/webhooks/u/:token/whatsapp/:provider",
    async (request, reply) => {
      const { whatsapp } = await owner(request.params.token);
      if (!whatsapp || whatsapp.name !== request.params.provider) throw Errors.notFound("Unknown webhook");
      const challenge = whatsapp.verifySubscription(request.query);
      if (challenge === null) return reply.code(403).send({ error: { code: "VERIFY_TOKEN_MISMATCH", message: "Verification failed" } });
      return reply.type("text/plain").send(challenge);
    },
  );

  app.post<{ Params: { token: string; provider: string } }>(
    "/api/webhooks/u/:token/whatsapp/:provider",
    { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { ownerId, whatsapp } = await owner(request.params.token);
      if (!whatsapp || whatsapp.name !== request.params.provider) throw Errors.notFound("Unknown webhook");
      try {
        const events = await whatsapp.handleWebhook(raw(request));
        const handled = await inScope(ownerId, () => opts.whatsappTracking.handle(events));
        return { received: events.length, handled };
      } catch (err) {
        if (err instanceof WhatsAppWebhookRejected) {
          return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
        }
        if (err instanceof SyntaxError) throw Errors.badRequest("Invalid JSON");
        throw err;
      }
    },
  );
}
