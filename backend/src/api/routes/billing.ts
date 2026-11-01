import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PaymentService } from "../../services/billing/paymentService.js";
import type { PlatformIntegrations } from "../../services/integrations/platformIntegrations.js";
import { PLATFORM_PROVIDERS } from "../../services/integrations/platformIntegrations.js";
import { RazorpayError } from "../../services/billing/razorpay.js";
import { Errors } from "../../utils/errors.js";
import { day, dayRange } from "../leadFilters.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import { IdParams, Pagination, parse, toSkipTake } from "../validation.js";

// Lead credits and online recharge (every signed-in user), the payment overview and manual
// credit changes (super admins), and the platform Integrations page (super admins).

const rupees = (min: number, max: number) => z.coerce.number().min(min).max(max).transform((v) => Math.round(v * 100));

const OrderBody = z.object({ amountInr: rupees(1, 100_000) });
const VerifyBody = z.object({
  orderId: z.string().trim().regex(/^order_[A-Za-z0-9]+$/),
  paymentId: z.string().trim().regex(/^pay_[A-Za-z0-9]+$/),
  signature: z.string().trim().regex(/^[a-f0-9]{64}$/),
});
const AdjustBody = z.object({ amountInr: rupees(-100_000, 100_000), note: z.string().trim().min(3, "Write why (e.g. “Paid by bank transfer”)").max(300) });
const Range = { from: day, to: day };

export async function billingRoutes(app: FastifyInstance, opts: { payments: PaymentService; integrations: PlatformIntegrations; timeZone: string }) {
  const { payments, integrations } = opts;
  const me = (request: { admin?: { id: string } | null }) => request.admin!.id;

  // ---- Every signed-in user: their own credits ----
  app.get("/api/billing/me", async (request) => payments.mine(me(request)));

  app.get("/api/billing/me/entries", async (request) => {
    const q = parse(Pagination, request.query);
    return { ...(await payments.entries({ userId: me(request), ...toSkipTake(q) })), page: q.page, pageSize: q.pageSize };
  });

  app.post("/api/billing/orders", async (request) => {
    return payments.createOrder(me(request), parse(OrderBody, request.body).amountInr);
  });

  app.post("/api/billing/verify", async (request) => payments.verifyCheckout(me(request), parse(VerifyBody, request.body)));

  // ---- Super admins: payments, balances, manual changes ----
  app.get("/api/billing/payments", async (request) => {
    requireSuperAdmin(request);
    const q = parse(Pagination.extend({ status: z.enum(["created", "paid", "failed"]).optional(), userId: z.string().max(64).optional(), ...Range }), request.query);
    return { ...(await payments.payments({ status: q.status, userId: q.userId, ...dayRange(q.from, q.to, opts.timeZone), ...toSkipTake(q) })), page: q.page, pageSize: q.pageSize };
  });

  app.get("/api/billing/accounts", async (request) => {
    requireSuperAdmin(request);
    const q = parse(Pagination.extend({ q: z.string().trim().max(100).optional() }), request.query);
    return { ...(await payments.accounts({ q: q.q || undefined, ...toSkipTake(q) })), page: q.page, pageSize: q.pageSize };
  });

  app.get("/api/billing/entries", async (request) => {
    requireSuperAdmin(request);
    const q = parse(Pagination.extend({ userId: z.string().max(64).optional(), type: z.enum(["recharge", "manual_credit", "manual_debit", "lead_charge"]).optional(), ...Range }), request.query);
    return { ...(await payments.entries({ userId: q.userId, type: q.type, ...dayRange(q.from, q.to, opts.timeZone), ...toSkipTake(q) })), page: q.page, pageSize: q.pageSize };
  });

  app.post("/api/billing/accounts/:id/adjust", async (request) => {
    requireSuperAdmin(request);
    const body = parse(AdjustBody, request.body);
    return { entry: await payments.adjust(parse(IdParams, request.params).id, body.amountInr, body.note, me(request)) };
  });

  // ---- Super admins: platform integrations ----
  const Provider = z.object({ provider: z.enum(PLATFORM_PROVIDERS) });
  app.get("/api/platform-integrations", async (request) => {
    requireSuperAdmin(request);
    return integrations.status();
  });
  app.put("/api/platform-integrations/:provider", async (request) => {
    requireSuperAdmin(request);
    return integrations.save(parse(Provider, request.params).provider, request.body);
  });
  app.delete("/api/platform-integrations/:provider", async (request) => {
    requireSuperAdmin(request);
    return integrations.remove(parse(Provider, request.params).provider);
  });
  app.post("/api/platform-integrations/razorpay/test", async (request) => {
    requireSuperAdmin(request);
    try {
      return await integrations.testRazorpay();
    } catch (err) {
      if (err instanceof RazorpayError) throw Errors.badRequest(err.message);
      throw err;
    }
  });
}

/** Razorpay webhook: verified with the webhook secret over the exact raw body. */
export async function razorpayWebhookRoutes(app: FastifyInstance, opts: { payments: PaymentService }) {
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
  app.post("/api/webhooks/razorpay", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const signature = request.headers["x-razorpay-signature"];
    let ok: boolean;
    try {
      ok = await opts.payments.applyWebhook(typeof request.body === "string" ? request.body : "", typeof signature === "string" ? signature : undefined);
    } catch (err) {
      if (err instanceof SyntaxError) throw Errors.badRequest("Invalid JSON");
      throw err;
    }
    if (!ok) {
      request.log.warn("razorpay webhook rejected: bad or missing signature");
      return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
    }
    return { ok: true };
  });
}
