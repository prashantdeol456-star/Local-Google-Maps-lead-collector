// Lead credits: every customer gets FREE_LEADS new Google Maps / LinkedIn leads for free, then
// each new lead costs PRICE_PER_LEAD_PAISE from their prepaid balance. Saving a lead they already
// have is free, Quick Send contacts are free, and super admins are never charged. With no free
// leads and no balance left, new leads are refused (HTTP 402) until the customer recharges.

import { ownerScope } from "../../database/ownerScope.js";
import type { Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";

export const FREE_LEADS = 1000;
export const PRICE_PER_LEAD_PAISE = 50;

export const inr = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

/** The customer who pays for leads saved in this request (null: nobody is charged). */
export function payingCustomer(): string | null {
  const scope = ownerScope.getStore();
  return scope?.customer ? scope.userId : null;
}

/**
 * Pays for one new lead; call it inside the transaction that creates the lead, so a refused
 * charge also cancels the lead.
 */
export async function chargeNewLead(tx: Repositories, what: string): Promise<void> {
  const payer = payingCustomer();
  if (!payer) return;
  if (await tx.credits.useFreeLead(payer, FREE_LEADS)) return;
  const charged = await tx.credits.change(payer, -PRICE_PER_LEAD_PAISE, { type: "lead_charge", note: what });
  if (!charged) {
    throw Errors.paymentRequired(
      `Your ${FREE_LEADS.toLocaleString("en-IN")} free leads are used up and your balance is below ${inr(PRICE_PER_LEAD_PAISE)}. Recharge on the Billing page to save new leads (leads you already have stay free).`,
    );
  }
}

export interface CreditSummary {
  freeLeads: number;
  freeLeadsUsed: number;
  freeLeadsLeft: number;
  balancePaise: number;
  pricePerLeadPaise: number;
  /** New leads that can still be saved (free ones + what the balance pays for) */
  leadsLeft: number;
}

export function summarize(account: { freeLeadsUsed: number; creditBalancePaise: number }): CreditSummary {
  const freeLeadsLeft = Math.max(0, FREE_LEADS - account.freeLeadsUsed);
  return {
    freeLeads: FREE_LEADS,
    freeLeadsUsed: Math.min(FREE_LEADS, account.freeLeadsUsed),
    freeLeadsLeft,
    balancePaise: account.creditBalancePaise,
    pricePerLeadPaise: PRICE_PER_LEAD_PAISE,
    leadsLeft: freeLeadsLeft + Math.floor(Math.max(0, account.creditBalancePaise) / PRICE_PER_LEAD_PAISE),
  };
}
