import type { DbClient } from "../../client.js";

// Lead credits: the free allowance, the prepaid balance and its ledger. Balance changes are
// conditional single-row updates, so two requests can never spend the same paise twice.

export type CreditEntryType = "recharge" | "manual_credit" | "manual_debit" | "lead_charge";

export interface CreditEntryRecord {
  id: string;
  userId: string;
  type: string;
  amountPaise: number;
  balanceAfterPaise: number;
  note: string | null;
  paymentId: string | null;
  createdById: string | null;
  createdAt: Date;
}

export class PrismaCreditRepository {
  constructor(private readonly db: DbClient) {}

  account(userId: string) {
    return this.db.adminUser.findUnique({ where: { id: userId }, select: { id: true, freeLeadsUsed: true, creditBalancePaise: true } });
  }

  /** Uses one free lead if any is left. */
  async useFreeLead(userId: string, freeLeads: number): Promise<boolean> {
    const { count } = await this.db.adminUser.updateMany({ where: { id: userId, freeLeadsUsed: { lt: freeLeads } }, data: { freeLeadsUsed: { increment: 1 } } });
    return count === 1;
  }

  /**
   * Adds (positive) or removes (negative) paise and records it. A debit that would make the
   * balance negative is refused (returns null) unless allowNegative.
   */
  async change(
    userId: string,
    amountPaise: number,
    entry: { type: CreditEntryType; note?: string | null; paymentId?: string | null; createdById?: string | null },
    allowNegative = false,
  ): Promise<CreditEntryRecord | null> {
    const where = amountPaise < 0 && !allowNegative ? { id: userId, creditBalancePaise: { gte: -amountPaise } } : { id: userId };
    const { count } = await this.db.adminUser.updateMany({ where, data: { creditBalancePaise: { increment: amountPaise } } });
    if (count !== 1) return null;
    const after = await this.db.adminUser.findUniqueOrThrow({ where: { id: userId }, select: { creditBalancePaise: true } });
    return this.db.creditEntry.create({
      data: {
        userId,
        type: entry.type,
        amountPaise,
        balanceAfterPaise: after.creditBalancePaise,
        note: entry.note ?? null,
        paymentId: entry.paymentId ?? null,
        createdById: entry.createdById ?? null,
      },
    });
  }

  async entries(query: { userId?: string; type?: string; createdFrom?: Date; createdUntil?: Date; skip: number; take: number }) {
    const where = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.createdFrom || query.createdUntil ? { createdAt: { ...(query.createdFrom ? { gte: query.createdFrom } : {}), ...(query.createdUntil ? { lt: query.createdUntil } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.creditEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: query.skip, take: query.take }),
      this.db.creditEntry.count({ where }),
    ]);
    return { items, total };
  }
}
