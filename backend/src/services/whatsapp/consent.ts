// WhatsApp consent. A phone number found on Google Maps is NOT an opt-in: a lead can only
// receive WhatsApp campaign messages after the admin records how that person opted in.

import type { PreferenceRecord, Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import type { EventBus } from "../events.js";
import { leadAddresses } from "../outreach/preferenceService.js";
import { recordWhatsAppOptOut } from "./trackingService.js";

export type WhatsAppConsent = "allowed" | "no_opt_in" | "opted_out";

export function whatsappConsent(pref: PreferenceRecord | null | undefined): WhatsAppConsent {
  if (!pref) return "no_opt_in";
  if (pref.optedOut) return "opted_out";
  if (!pref.whatsappOptInAt) return "no_opt_in";
  return pref.whatsappAllowed ? "allowed" : "opted_out";
}

export class WhatsAppConsentService {
  constructor(
    private readonly repos: Repositories,
    private readonly bus?: EventBus,
  ) {}

  private async lead(leadId: string) {
    const lead = await this.repos.leads.findById(leadId);
    if (!lead) throw Errors.notFound("Lead not found");
    return lead;
  }

  /** Records that this lead agreed to receive WhatsApp messages, and how. */
  async recordOptIn(leadId: string, source: string, now = new Date()) {
    const lead = await this.lead(leadId);
    const current = await this.repos.preferences.find(leadId);
    if (current?.optedOut) {
      throw Errors.conflict("OPTED_OUT", "This lead opted out of all communication; that has to be cleared first");
    }
    const pref = await this.repos.preferences.upsert(leadId, { whatsappAllowed: true, whatsappOptInAt: now, whatsappOptInSource: source });
    // A new, explicit opt-in replaces an earlier STOP / opt-out for this lead's numbers.
    const lifted = await this.repos.suppressions.deleteAddresses("whatsapp", await leadAddresses(this.repos, lead, "whatsapp"));
    await this.repos.agentLogs.create({
      jobId: null,
      action: "whatsapp_opt_in",
      status: "info",
      message: `${lead.name}: ${source}${lifted ? ` (replaces an earlier opt-out)` : ""}`,
    });
    this.bus?.publish({ type: "lead.updated", leadId });
    return pref;
  }

  /** The lead no longer wants WhatsApp messages (asked by phone, replied STOP…). Queued messages are skipped. */
  async withdraw(leadId: string, reason: string) {
    const lead = await this.lead(leadId);
    await recordWhatsAppOptOut(
      this.repos,
      { leadId, phone: lead.normalizedPhone, reason: `${reason} (recorded by admin)`, provider: "admin", occurredAt: new Date() },
      this.bus,
    );
    return (await this.repos.preferences.find(leadId))!;
  }
}
