// Online recharge with Razorpay, the credit ledger and the super admin's payment overview.
//
// Flow: the customer asks for an order (amount) → Razorpay Checkout opens in the browser →
// on success the browser sends Razorpay's signed ids, which we check (HMAC with the key secret)
// and confirm with Razorpay → the payment is marked paid and the balance credited, once.
// The Razorpay webhook (payment.captured / payment.failed) does the same independently, so a
// closed browser tab still gets its recharge. Nothing is credited without a valid signature.

import type { PrismaClient } from "../../database/client.js";
import { PrismaCreditRepository } from "../../database/repositories/prisma/PrismaCreditRepository.js";
import { Errors } from "../../utils/errors.js";
import { startOfDayInZone } from "../../utils/time.js";
import type { PlatformIntegrations } from "../integrations/platformIntegrations.js";
import { inr, summarize } from "./credits.js";
import { checkoutSignatureValid, RazorpayError, razorpayMode, webhookSignatureValid, type RazorpayPayment } from "./razorpay.js";

export const MIN_RECHARGE_PAISE = 100_00;
export const MAX_RECHARGE_PAISE = 1_00_000_00;

export class PaymentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly integrations: PlatformIntegrations,
    private readonly opts: { timeZone: string; brandName?: string },
  ) {}

  private credits(db: PrismaClient = this.db) {
    return new PrismaCreditRepository(db);
  }

  private client() {
    const client = this.integrations.razorpayClient();
    if (!client) throw Errors.badRequest("Online recharge is not set up yet. Contact the administrator.");
    return client;
  }

  /** The customer's free leads, balance, recent ledger and payments. */
  async mine(userId: string) {
    const account = await this.credits().account(userId);
    if (!account) throw Errors.notFound("User not found");
    const keys = this.integrations.razorpay();
    const [entries, payments] = await Promise.all([
      this.credits().entries({ userId, skip: 0, take: 20 }),
      this.db.payment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return {
      credits: summarize(account),
      razorpay: keys ? { enabled: true, keyId: keys.keyId, mode: razorpayMode(keys.keyId) } : { enabled: false },
      limits: { minPaise: MIN_RECHARGE_PAISE, maxPaise: MAX_RECHARGE_PAISE },
      entries: entries.items,
      payments,
    };
  }

  async createOrder(userId: string, amountPaise: number) {
    const user = await this.db.adminUser.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true, name: true } });
    if (!user) throw Errors.notFound("User not found");
    if (!Number.isInteger(amountPaise) || amountPaise < MIN_RECHARGE_PAISE || amountPaise > MAX_RECHARGE_PAISE) {
      throw Errors.badRequest(`Recharge between ${inr(MIN_RECHARGE_PAISE)} and ${inr(MAX_RECHARGE_PAISE)}`);
    }
    const client = this.client();
    let order;
    try {
      order = await client.createOrder(amountPaise, `rc_${Date.now().toString(36)}`, { userId: user.id, purpose: "lead credits" });
    } catch (err) {
      if (err instanceof RazorpayError) throw Errors.badRequest(err.message);
      throw err;
    }
    await this.db.payment.create({ data: { userId: user.id, orderId: order.id, amountPaise } });
    return {
      orderId: order.id,
      amountPaise,
      currency: "INR",
      keyId: this.integrations.razorpay()!.keyId,
      name: this.opts.brandName ?? "Lead Platform",
      description: `Lead credits (${inr(amountPaise)})`,
      prefill: { email: user.email, contact: user.phone ?? "", name: user.name ?? "" },
    };
  }

  /** The browser's success callback from Razorpay Checkout. */
  async verifyCheckout(userId: string, input: { orderId: string; paymentId: string; signature: string }) {
    const keys = this.integrations.razorpay();
    const payment = await this.db.payment.findUnique({ where: { orderId: input.orderId } });
    if (!keys || !payment || payment.userId !== userId) throw Errors.notFound("Order not found");
    if (!checkoutSignatureValid(keys.keySecret, input.orderId, input.paymentId, input.signature)) {
      throw Errors.badRequest("The payment could not be verified");
    }
    if (payment.status === "paid") return this.mine(userId);
    let rp: RazorpayPayment;
    try {
      rp = await this.client().payment(input.paymentId);
      if (rp.status === "authorized") rp = await this.client().capture(input.paymentId, payment.amountPaise);
    } catch (err) {
      if (err instanceof RazorpayError) throw Errors.badRequest(err.message);
      throw err;
    }
    if (rp.order_id !== input.orderId || rp.amount !== payment.amountPaise || rp.status !== "captured") {
      throw Errors.badRequest(`The payment is ${rp.status}; your balance will update when Razorpay confirms it`);
    }
    await this.markPaid(input.orderId, rp);
    return this.mine(userId);
  }

  /** Razorpay webhook. Returns false when the signature is wrong (nothing is changed). */
  async applyWebhook(rawBody: string, signature: string | undefined): Promise<boolean> {
    const keys = this.integrations.razorpay();
    if (!keys?.webhookSecret || !signature || !webhookSignatureValid(keys.webhookSecret, rawBody, signature)) return false;
    const event = JSON.parse(rawBody) as { event?: string; payload?: { payment?: { entity?: RazorpayPayment } } };
    const p = event.payload?.payment?.entity;
    if (!p?.order_id) return true;
    const payment = await this.db.payment.findUnique({ where: { orderId: p.order_id } });
    if (!payment) return true; // not one of ours
    if (event.event === "payment.captured" || (event.event === "order.paid" && p.status === "captured")) {
      if (p.amount === payment.amountPaise) await this.markPaid(p.order_id, p);
    } else if (event.event === "payment.failed") {
      await this.db.payment.updateMany({
        where: { orderId: p.order_id, status: "created" },
        data: { status: "failed", paymentId: p.id, method: p.method ?? null, failureReason: p.error_description ?? null },
      });
    }
    return true;
  }

  /** Marks the order paid and credits the balance — only the first time. */
  private async markPaid(orderId: string, p: RazorpayPayment) {
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { orderId, status: { not: "paid" } },
        data: { status: "paid", paymentId: p.id, method: p.method ?? null, failureReason: null, paidAt: new Date() },
      });
      if (count !== 1) return;
      const payment = await tx.payment.findUniqueOrThrow({ where: { orderId } });
      await this.credits(tx as unknown as PrismaClient).change(payment.userId, payment.amountPaise, { type: "recharge", paymentId: payment.id, note: `Razorpay ${p.id}${p.method ? ` (${p.method})` : ""}` });
    });
  }

  // ---------- super admin ----------

  async adjust(userId: string, amountPaise: number, note: string, byId: string) {
    if (!Number.isInteger(amountPaise) || amountPaise === 0) throw Errors.badRequest("Enter an amount other than 0");
    const user = await this.db.adminUser.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw Errors.notFound("User not found");
    const entry = await this.credits().change(userId, amountPaise, { type: amountPaise > 0 ? "manual_credit" : "manual_debit", note, createdById: byId });
    if (!entry) throw Errors.badRequest("The balance is smaller than this debit");
    return entry;
  }

  async accounts(query: { q?: string; skip: number; take: number }) {
    const where = {
      role: "customer",
      ...(query.q ? { OR: [{ email: { contains: query.q.toLowerCase() } }, { username: { contains: query.q.toLowerCase() } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.adminUser.findMany({
        where,
        select: { id: true, email: true, username: true, status: true, freeLeadsUsed: true, creditBalancePaise: true },
        orderBy: { createdAt: "desc" },
        skip: query.skip,
        take: query.take,
      }),
      this.db.adminUser.count({ where }),
    ]);
    const paid = await this.db.payment.groupBy({ by: ["userId"], where: { status: "paid", userId: { in: rows.map((r) => r.id) } }, _sum: { amountPaise: true } });
    const paidBy = new Map(paid.map((p) => [p.userId, p._sum.amountPaise ?? 0]));
    return {
      items: rows.map((r) => ({ id: r.id, email: r.email, username: r.username, status: r.status, credits: summarize(r), paidPaise: paidBy.get(r.id) ?? 0 })),
      total,
    };
  }

  entries(query: { userId?: string; type?: string; createdFrom?: Date; createdUntil?: Date; skip: number; take: number }) {
    return this.credits().entries(query);
  }

  async payments(query: { status?: string; userId?: string; createdFrom?: Date; createdUntil?: Date; skip: number; take: number }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.createdFrom || query.createdUntil ? { createdAt: { ...(query.createdFrom ? { gte: query.createdFrom } : {}), ...(query.createdUntil ? { lt: query.createdUntil } : {}) } } : {}),
    };
    const now = new Date();
    const today = startOfDayInZone(now, this.opts.timeZone);
    const yearMonth = new Intl.DateTimeFormat("en-CA", { timeZone: this.opts.timeZone, year: "numeric", month: "2-digit" }).format(now); // "2026-11"
    const month = startOfDayInZone(new Date(`${yearMonth}-01T12:00:00Z`), this.opts.timeZone);
    const sum = async (from?: Date, extra: object = {}) =>
      (await this.db.payment.aggregate({ where: { status: "paid", ...(from ? { paidAt: { gte: from } } : {}), ...extra }, _sum: { amountPaise: true }, _count: true }));
    const [items, total, todayAgg, monthAgg, allAgg, filteredAgg] = await Promise.all([
      this.db.payment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: query.skip, take: query.take }),
      this.db.payment.count({ where }),
      sum(today),
      sum(month),
      sum(),
      this.db.payment.aggregate({ where: { ...where, status: "paid" }, _sum: { amountPaise: true } }),
    ]);
    const users = await this.db.adminUser.findMany({ where: { id: { in: [...new Set(items.map((p) => p.userId))] } }, select: { id: true, email: true, username: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const totalOf = (a: { _sum: { amountPaise: number | null }; _count: number }) => ({ paise: a._sum.amountPaise ?? 0, count: a._count });
    return {
      items: items.map((p) => ({ ...p, user: byId.get(p.userId) ?? null })),
      total,
      totals: { today: totalOf(todayAgg), thisMonth: totalOf(monthAgg), allTime: totalOf(allAgg), filteredPaise: filteredAgg._sum.amountPaise ?? 0 },
    };
  }
}
