// Communication preferences: per-lead flags (LeadCommunicationPreference) plus the
// address-based suppression list. Every opt-out goes through here so it is recorded on the
// lead AND on its addresses: the suppression still applies if the lead is deleted and the
// same business is collected again later.

import { normalizePhone } from "@platform/shared";
import type { Channel, LeadRecord, Repositories, SuppressionRecord } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import type { EventBus } from "../events.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Suppression key for an email address (lowercase), or null if it is not one. */
export function emailAddress(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v && EMAIL.test(v) ? v : null;
}

/** Suppression key for a phone number (E.164 with "+"), or null if it is not one. */
export function phoneAddress(raw: string | null | undefined): string | null {
  return normalizePhone(raw);
}

export const addressFor = (channel: Channel, raw: string | null | undefined) => (channel === "email" ? emailAddress(raw) : phoneAddress(raw));

/** Every address a lead can be reached at on a channel: its current one and those we already used. */
export async function leadAddresses(repos: Repositories, lead: LeadRecord, channel: Channel): Promise<string[]> {
  const { items } = await repos.attempts.list({ leadId: lead.id, skip: 0, take: 500 });
  const used = items.filter((a) => a.channel === channel).map((a) => addressFor(channel, a.toAddress));
  const current = channel === "email" ? emailAddress(lead.email) : (lead.normalizedPhone ?? phoneAddress(lead.phone));
  return [...new Set([current, ...used].filter((a): a is string => !!a))];
}

/** The addresses of `candidates` that are suppressed on a channel. */
export async function suppressedSet(repos: Repositories, channel: Channel, candidates: string[]): Promise<Set<string>> {
  const unique = [...new Set(candidates)];
  const found: SuppressionRecord[] = [];
  for (let i = 0; i < unique.length; i += 500) found.push(...(await repos.suppressions.findByAddresses(channel, unique.slice(i, i + 500))));
  return new Set(found.map((s) => s.address));
}

export interface SuppressInput {
  reason: string;
  /** unsubscribe_link, spam_complaint, stop_reply, whatsapp_stop, whatsapp_error, do_not_contact, admin, import */
  source: string;
}

/** Adds suppression entries and announces the new ones (live admin updates, integrations). */
export async function addSuppressions(repos: Repositories, rows: Omit<SuppressionRecord, "id" | "createdAt">[], bus?: EventBus): Promise<SuppressionRecord[]> {
  const created = await repos.suppressions.addMany(rows);
  for (const s of created) bus?.publish({ type: "optout.recorded", suppressionId: s.id });
  return created;
}

/** Suppresses all of a lead's addresses on a channel. Returns how many entries were new. */
export async function suppressLead(repos: Repositories, lead: LeadRecord, channel: Channel, input: SuppressInput, bus?: EventBus): Promise<number> {
  const addresses = await leadAddresses(repos, lead, channel);
  const rows = addresses.map((address) => ({ channel, address, reason: input.reason, source: input.source, leadId: lead.id }));
  return (await addSuppressions(repos, rows, bus)).length;
}

export class PreferenceService {
  constructor(
    private readonly repos: Repositories,
    private readonly bus?: EventBus,
  ) {}

  private async lead(leadId: string) {
    const lead = await this.repos.leads.findById(leadId);
    if (!lead) throw Errors.notFound("Lead not found");
    return lead;
  }

  private async log(action: string, status: "info" | "warning", message: string, leadId?: string) {
    await this.repos.agentLogs.create({ jobId: null, action, status, message });
    if (leadId) this.bus?.publish({ type: "lead.updated", leadId });
  }

  /** The lead's flags, and the suppression entries covering its addresses. */
  async get(leadId: string) {
    const lead = await this.lead(leadId);
    const [preference, emails, phones] = await Promise.all([
      this.repos.preferences.find(leadId),
      leadAddresses(this.repos, lead, "email"),
      leadAddresses(this.repos, lead, "whatsapp"),
    ]);
    const [email, whatsapp] = await Promise.all([
      this.repos.suppressions.findByAddresses("email", emails),
      this.repos.suppressions.findByAddresses("whatsapp", phones),
    ]);
    return { preference, suppressions: { email, whatsapp }, addresses: { email: emails, whatsapp: phones } };
  }

  /** Stop emailing this lead (e.g. they asked by phone). */
  async optOutEmail(leadId: string, input: SuppressInput, at = new Date()) {
    const lead = await this.lead(leadId);
    await this.repos.preferences.upsert(leadId, { emailAllowed: false, optOutReason: input.source, optedOutAt: at });
    await suppressLead(this.repos, lead, "email", input, this.bus);
    await this.log("email_opt_out", "warning", `${lead.name}: ${input.reason}`, leadId);
    return this.get(leadId);
  }

  /** The person asked to receive emails again: lifts the email opt-out and its suppressions. */
  async allowEmailAgain(leadId: string, note: string) {
    const lead = await this.lead(leadId);
    if ((await this.repos.preferences.find(leadId))?.optedOut) {
      throw Errors.conflict("DO_NOT_CONTACT", "This lead is marked do-not-contact; clear that first");
    }
    await this.repos.preferences.upsert(leadId, { emailAllowed: true, optOutReason: null, optedOutAt: null });
    const removed = await this.repos.suppressions.deleteAddresses("email", await leadAddresses(this.repos, lead, "email"));
    await this.log("email_opt_in", "info", `${lead.name}: email allowed again (${removed} suppression(s) removed). ${note}`, leadId);
    return this.get(leadId);
  }

  /** No marketing on any channel. Also suppresses the lead's email and phone. */
  async setDoNotContact(leadId: string, reason: string, at = new Date()) {
    const lead = await this.lead(leadId);
    await this.repos.preferences.upsert(leadId, { optedOut: true, optOutReason: reason, optedOutAt: at });
    const input = { reason, source: "do_not_contact" };
    await suppressLead(this.repos, lead, "email", input, this.bus);
    await suppressLead(this.repos, lead, "whatsapp", input, this.bus);
    await this.log("do_not_contact", "warning", `${lead.name}: ${reason}`, leadId);
    return this.get(leadId);
  }

  /**
   * Lifts do-not-contact. Only the suppressions it created are removed; an earlier
   * unsubscribe or STOP stays in force.
   */
  async clearDoNotContact(leadId: string, note: string) {
    const lead = await this.lead(leadId);
    await this.repos.preferences.upsert(leadId, { optedOut: false, optOutReason: null, optedOutAt: null });
    for (const channel of ["email", "whatsapp"] as const) {
      await this.repos.suppressions.deleteAddresses(channel, await leadAddresses(this.repos, lead, channel), "do_not_contact");
    }
    await this.log("do_not_contact_cleared", "info", `${lead.name}: ${note}`, leadId);
    return this.get(leadId);
  }

  // ---- Suppression list ----

  async list(query: { channel?: Channel; q?: string; skip: number; take: number }) {
    const { items, total } = await this.repos.suppressions.list({ ...query, q: query.q?.trim().toLowerCase() || undefined });
    const leads = new Map((await this.repos.leads.findByIds([...new Set(items.flatMap((s) => (s.leadId ? [s.leadId] : [])))])).map((l) => [l.id, l.name]));
    const [email, whatsapp] = await Promise.all([this.repos.suppressions.count("email"), this.repos.suppressions.count("whatsapp")]);
    return { items: items.map((s) => ({ ...s, leadName: s.leadId ? (leads.get(s.leadId) ?? null) : null })), total, counts: { email, whatsapp } };
  }

  /** Adds addresses from another list (e.g. a do-not-contact list you received). */
  async add(channel: Channel, raw: string[], reason: string) {
    const invalid: string[] = [];
    const addresses = new Set<string>();
    for (const value of raw.map((r) => r.trim()).filter(Boolean)) {
      const address = addressFor(channel, value);
      if (address) addresses.add(address);
      else invalid.push(value);
    }
    const added = (await addSuppressions(this.repos, [...addresses].map((address) => ({ channel, address, reason, source: "import", leadId: null })), this.bus)).length;
    // Leads with these addresses: reflect it on their flags too.
    if (channel === "whatsapp") {
      for (const address of addresses) {
        for (const lead of await this.repos.leads.findByNormalizedPhone(address)) await this.repos.preferences.upsert(lead.id, { whatsappAllowed: false });
      }
    }
    await this.log(`${channel}_suppressions_added`, "warning", `${added} new of ${addresses.size} (${invalid.length} invalid): ${reason}`);
    return { added, alreadySuppressed: addresses.size - added, invalid };
  }

  /** Removes one entry: only when the person asked to hear from you again. */
  async remove(id: string, note: string) {
    const entry = await this.repos.suppressions.findById(id);
    if (!entry) throw Errors.notFound("Entry not found");
    await this.repos.suppressions.delete(id);
    await this.log(`${entry.channel}_suppression_removed`, "info", `${entry.address} (was: ${entry.reason}). ${note}`, entry.leadId ?? undefined);
    return entry;
  }
}
