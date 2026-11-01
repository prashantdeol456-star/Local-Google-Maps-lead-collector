// Quick Send: emails / phone numbers typed or uploaded by the user become leads (source
// "quick_send", grouped by a list name), so the normal email and WhatsApp campaigns can send
// templates to them with all their safeguards (pacing, opt-outs, tracking, consent).

import { normalizePhone, normalizeWhitespace } from "@platform/shared";
import type { LeadRecord, Repositories } from "../../database/repositories/index.js";
import type { DedupeService } from "../lead/dedupeService.js";
import { whatsappConsent } from "../whatsapp/consent.js";
import { leadAddresses, suppressedSet } from "./preferenceService.js";

export const QUICK_SEND_SOURCE = "quick_send";
export const QUICK_SEND_MAX = 5000;

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

export interface QuickContactInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface QuickSendResult {
  leadIds: string[];
  created: number;
  existing: number;
  /** Rows that were not saved, with the reason (1-based row number). */
  skipped: { row: number; value: string; reason: string }[];
  /** WhatsApp consent recorded now / already present / refused because the person opted out. */
  whatsapp: { optedIn: number; alreadyAllowed: number; optedOut: number };
}

export class QuickSendService {
  constructor(
    private readonly repos: Repositories,
    private readonly dedupe: DedupeService,
  ) {}

  async save(input: { list: string; contacts: QuickContactInput[]; whatsappConsent: boolean }): Promise<QuickSendResult> {
    const list = normalizeWhitespace(input.list) ?? "Quick Send";
    const result: QuickSendResult = { leadIds: [], created: 0, existing: 0, skipped: [], whatsapp: { optedIn: 0, alreadyAllowed: 0, optedOut: 0 } };
    const ids = new Set<string>();

    for (const [i, c] of input.contacts.entries()) {
      const row = i + 1;
      const rawEmail = normalizeWhitespace(c.email)?.toLowerCase() ?? null;
      const rawPhone = normalizeWhitespace(c.phone);
      const shown = [c.name, rawEmail, rawPhone].filter(Boolean).join(" · ");
      if (rawEmail && !EMAIL.test(rawEmail)) {
        result.skipped.push({ row, value: shown, reason: "Not a valid email" });
        continue;
      }
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      if (rawPhone && !phone) {
        result.skipped.push({ row, value: shown, reason: "Not a valid phone number (use +country code for numbers outside India)" });
        continue;
      }
      if (!rawEmail && !phone) {
        result.skipped.push({ row, value: shown || "(empty)", reason: "No email or phone number" });
        continue;
      }

      let lead: LeadRecord | undefined = rawEmail ? (await this.repos.leads.findByEmail(rawEmail))[0] : undefined;
      if (lead) {
        result.existing++;
      } else {
        const name = normalizeWhitespace(c.name) ?? rawEmail?.split("@")[0] ?? phone!;
        const saved = await this.dedupe.save({ name, email: rawEmail, phone, category: "Quick Send", searchKeyword: list, source: QUICK_SEND_SOURCE });
        lead = saved.lead;
        if (saved.result === "new") result.created++;
        else result.existing++;
      }
      if (ids.has(lead.id)) continue;
      ids.add(lead.id);

      if (input.whatsappConsent && lead.normalizedPhone) await this.recordConsent(lead, list, result);
    }

    result.leadIds = [...ids];
    return result;
  }

  /**
   * The user confirmed these people agreed to WhatsApp messages. Unlike a manual opt-in on one
   * lead, a pasted list never overrides an earlier STOP / opt-out.
   */
  private async recordConsent(lead: LeadRecord, list: string, result: QuickSendResult) {
    const pref = await this.repos.preferences.find(lead.id);
    const state = whatsappConsent(pref);
    if (state === "allowed") return void result.whatsapp.alreadyAllowed++;
    const suppressed = await suppressedSet(this.repos, "whatsapp", await leadAddresses(this.repos, lead, "whatsapp"));
    if (state === "opted_out" || suppressed.size) return void result.whatsapp.optedOut++;
    await this.repos.preferences.upsert(lead.id, {
      whatsappAllowed: true,
      whatsappOptInAt: new Date(),
      whatsappOptInSource: `Quick Send list "${list}": consent confirmed by the sender`,
    });
    result.whatsapp.optedIn++;
  }
}
