// Marketplace leads: each user's IndiaMART / TradeIndia / other portal enquiries, pulled every
// 5 minutes with the portal's own API. Every new enquiry:
//   1. is saved once (the portal's enquiry id),
//   2. goes to Contacts (list "IndiaMART" / "TradeIndia" / the source's name), reusing a contact
//      with the same mobile,
//   3. when the source has an approved WhatsApp template, gets it on WhatsApp right away through
//      the user's own number (the chat then continues in All messages).

import type { MarketplaceLead, MarketplaceSource, PrismaClient } from "../../generated/prisma/client.js";
import { containsInsensitive } from "../../database/client.js";
import { ownerScope } from "../../database/ownerScope.js";
import { Errors } from "../../utils/errors.js";
import type { SecretBox } from "../../utils/secretBox.js";
import { csvRow, UTF8_BOM } from "../export/csv.js";
import type { EventBus } from "../events.js";
import { MAX_WINDOW_MS, PortalError, type PortalClient, type PortalConfig, type PortalKind, type PortalLead } from "./portals.js";

export const PORTAL_KINDS: PortalKind[] = ["indiamart", "tradeindia", "custom"];
const LABEL: Record<PortalKind, string> = { indiamart: "IndiaMART", tradeindia: "TradeIndia", custom: "Portal" };
/** IndiaMART allows one call every 5 minutes. */
export const MIN_POLL_MS = 5 * 60 * 1000;
/** First read of a new source: the last 7 days. */
const FIRST_WINDOW_MS = MAX_WINDOW_MS;

export interface FollowUp {
  /** Starts a WhatsApp chat with an approved template (inside the lead owner's data scope). */
  whatsapp: (input: { phone: string; templateId: string; name: string }) => Promise<{ chatId: string }>;
}

const hint = (s: string) => `…${s.slice(-4)}`;

export class MarketplaceService {
  constructor(
    private readonly db: PrismaClient,
    private readonly portals: PortalClient,
    private readonly box: SecretBox,
    private readonly opts: { followUp?: FollowUp; bus?: EventBus; now?: () => Date; log?: (msg: string) => void } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  private view(s: MarketplaceSource) {
    const { configEnc: _c, ...rest } = s;
    return rest;
  }

  // ---- Sources ----

  async sources() {
    const rows = await this.db.marketplaceSource.findMany({ orderBy: { createdAt: "asc" } });
    const counts = await this.db.marketplaceLead.groupBy({ by: ["sourceId"], _count: { _all: true } });
    return rows.map((s) => ({ ...this.view(s), leads: counts.find((c) => c.sourceId === s.id)?._count._all ?? 0 }));
  }

  private validConfig(kind: PortalKind, c: PortalConfig): PortalConfig {
    const t = (v?: string) => v?.trim() || undefined;
    const config = { key: t(c.key), userId: t(c.userId), profileId: t(c.profileId), url: t(c.url) };
    if (kind === "indiamart" && !config.key) throw Errors.badRequest("Paste the IndiaMART CRM key (Lead Manager → Import/Export Leads → Pull API)");
    if (kind === "tradeindia" && (!config.key || !config.userId || !config.profileId)) throw Errors.badRequest("Enter the TradeIndia User ID, Profile ID and Key (Inquiries & Contacts → My Inquiry API)");
    if (kind === "custom" && !/^https:\/\/[^\s]+$/i.test(config.url ?? "")) throw Errors.badRequest("Paste the full https API link from the portal's member panel");
    return config;
  }

  async create(input: { kind: PortalKind; name?: string | null; config: PortalConfig; waTemplateId?: string | null }) {
    const config = this.validConfig(input.kind, input.config);
    const secret = config.key ?? config.url ?? "";
    const row = await this.db.marketplaceSource.create({
      data: { kind: input.kind, name: input.name?.trim() || LABEL[input.kind], configEnc: this.box.seal(JSON.stringify(config)), configHint: hint(secret), waTemplateId: input.waTemplateId ?? null },
    });
    return this.view(row);
  }

  async update(id: string, patch: { name?: string; enabled?: boolean; waTemplateId?: string | null; config?: PortalConfig }) {
    const s = await this.db.marketplaceSource.findUnique({ where: { id } });
    if (!s) throw Errors.notFound("Source not found");
    let config: { configEnc: string; configHint: string; status: string; lastError: null } | object = {};
    if (patch.config) {
      const c = this.validConfig(s.kind as PortalKind, patch.config);
      config = { configEnc: this.box.seal(JSON.stringify(c)), configHint: hint(c.key ?? c.url ?? ""), status: "ok", lastError: null };
    }
    if (patch.waTemplateId) {
      const tpl = await this.db.messageTemplate.findFirst({ where: { id: patch.waTemplateId, channel: "whatsapp" } });
      if (!tpl) throw Errors.badRequest("Choose one of your WhatsApp templates");
      if (tpl.approvalStatus !== "approved") throw Errors.badRequest("Only an approved WhatsApp template can be sent to new enquiries");
    }
    const row = await this.db.marketplaceSource.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() || s.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.waTemplateId !== undefined ? { waTemplateId: patch.waTemplateId } : {}),
        ...config,
      },
    });
    return this.view(row);
  }

  async remove(id: string, withLeads: boolean) {
    const s = await this.db.marketplaceSource.findUnique({ where: { id } });
    if (!s) throw Errors.notFound("Source not found");
    if (withLeads) await this.db.marketplaceLead.deleteMany({ where: { sourceId: id } });
    await this.db.marketplaceSource.delete({ where: { id } });
  }

  // ---- Pulling enquiries ----

  /** Reads new enquiries of one source now (the worker calls it every 5 minutes). Returns how many were new. */
  async pull(id: string, opts: { force?: boolean } = {}): Promise<{ added: number }> {
    const s = await this.db.marketplaceSource.findUnique({ where: { id } });
    if (!s) throw Errors.notFound("Source not found");
    const now = this.now();
    if (s.lastPolledAt && now.getTime() - s.lastPolledAt.getTime() < MIN_POLL_MS) {
      if (opts.force) throw Errors.conflict("TOO_SOON", "Checked less than 5 minutes ago (IndiaMART allows one check every 5 minutes)");
      return { added: 0 };
    }
    let config: PortalConfig;
    try {
      config = JSON.parse(this.box.open(s.configEnc)) as PortalConfig;
    } catch {
      await this.db.marketplaceSource.update({ where: { id }, data: { status: "error", lastError: "The saved key cannot be read: enter it again" } });
      throw Errors.badRequest("The saved key cannot be read: enter it again");
    }
    // From where the last read ended (a little overlap: the same enquiry is never saved twice), at most 7 days.
    const from = new Date(Math.max((s.cursorAt ?? new Date(now.getTime() - FIRST_WINDOW_MS)).getTime() - 10 * 60_000, now.getTime() - MAX_WINDOW_MS));
    await this.db.marketplaceSource.update({ where: { id }, data: { lastPolledAt: now } });
    let leads: PortalLead[];
    try {
      leads = await this.portals.enquiries(s.kind as PortalKind, config, from, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db.marketplaceSource.update({ where: { id }, data: { status: "error", lastError: message.slice(0, 300) } });
      if (opts.force) throw Errors.badRequest(message);
      if (!(err instanceof PortalError)) this.opts.log?.(`Marketplace ${s.name}: ${message}`);
      return { added: 0 };
    }
    let added = 0;
    let newest = s.lastLeadAt;
    for (const l of leads.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
      if (await this.db.marketplaceLead.findUnique({ where: { sourceId_externalId: { sourceId: s.id, externalId: l.externalId } } })) continue;
      const lead = await this.db.marketplaceLead.create({ data: { ...l, ownerId: s.ownerId, sourceId: s.id, kind: s.kind } });
      added++;
      if (!newest || l.receivedAt > newest) newest = l.receivedAt;
      await this.afterNew(s, lead);
    }
    await this.db.marketplaceSource.update({ where: { id }, data: { cursorAt: now, status: "ok", lastError: null, lastLeadAt: newest } });
    return { added };
  }

  /** A new enquiry: to Contacts, then the automatic WhatsApp message if the source has one. */
  private async afterNew(s: MarketplaceSource, lead: MarketplaceLead) {
    const listName = s.kind === "custom" ? s.name : LABEL[s.kind as PortalKind];
    let contactId: string | null = null;
    try {
      const tail = lead.mobile?.replace(/\D/g, "").slice(-10);
      const same = tail ? (await this.db.outreachContact.findMany({ where: { ownerId: s.ownerId, phone: { contains: tail.slice(-4) } }, take: 100 })).find((c) => c.phone?.replace(/\D/g, "").slice(-10) === tail) : null;
      const contact =
        same ??
        (await this.db.outreachContact.create({
          data: { ownerId: s.ownerId, name: lead.name, phone: lead.mobile, email: lead.email, company: lead.company, designation: null, listName, source: "admin" },
        }));
      contactId = contact.id;
    } catch (err) {
      this.opts.log?.(`Marketplace: contact for ${lead.name}: ${String(err)}`);
    }
    let followUp: MarketplaceLead["followUp"] = "none";
    let note: string | null = null;
    let waChatId: string | null = null;
    if (s.waTemplateId && this.opts.followUp) {
      if (!lead.mobile) {
        followUp = "skipped";
        note = "No mobile number in the enquiry";
      } else {
        try {
          // The WhatsApp message goes out as the lead's owner (their own number).
          const run = () => this.opts.followUp!.whatsapp({ phone: lead.mobile!, templateId: s.waTemplateId!, name: lead.name });
          const r = s.ownerId ? await ownerScope.run({ userId: s.ownerId, ownerId: s.ownerId, customer: true }, run) : await run();
          followUp = "sent";
          waChatId = r.chatId;
        } catch (err) {
          followUp = "failed";
          note = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        }
      }
    }
    await this.db.marketplaceLead.update({ where: { id: lead.id }, data: { contactId, followUp, followUpNote: note, waChatId } });
    this.opts.bus?.publish({ type: "lead.saved", leadId: lead.id, result: "new", jobId: null });
  }

  // ---- Reading ----

  async leads(f: { sourceId?: string; q?: string; followUp?: string; skip: number; take: number }) {
    const where = {
      ...(f.sourceId ? { sourceId: f.sourceId } : {}),
      ...(f.followUp ? { followUp: f.followUp } : {}),
      ...(f.q ? { OR: [{ name: containsInsensitive(f.q) }, { company: containsInsensitive(f.q) }, { product: containsInsensitive(f.q) }, { mobile: { contains: f.q.replace(/\D/g, "") || f.q } }, { city: containsInsensitive(f.q) }] } : {}),
    };
    const [items, total] = await Promise.all([this.db.marketplaceLead.findMany({ where, orderBy: { receivedAt: "desc" }, skip: f.skip, take: f.take }), this.db.marketplaceLead.count({ where })]);
    const since = new Date(this.now().getTime() - 24 * 3600_000);
    const today = await this.db.marketplaceLead.count({ where: { receivedAt: { gte: since } } });
    return { items, total, today };
  }

  async exportCsv(write: (chunk: string) => void, f: { sourceId?: string }) {
    write(UTF8_BOM + csvRow(["Received", "Portal", "Name", "Mobile", "Email", "Company", "City", "State", "Country", "Product", "Subject", "Message", "Type", "WhatsApp follow-up"]));
    for (let skip = 0; ; skip += 500) {
      const rows = await this.db.marketplaceLead.findMany({ where: f.sourceId ? { sourceId: f.sourceId } : {}, orderBy: { receivedAt: "desc" }, skip, take: 500 });
      if (!rows.length) break;
      write(rows.map((l) => csvRow([l.receivedAt.toISOString(), LABEL[l.kind as PortalKind] ?? l.kind, l.name, l.mobile, l.email, l.company, l.city, l.state, l.country, l.product, l.subject, l.message, l.queryType, l.followUp])).join(""));
    }
  }

  /** Every enabled source of every user (the worker reads each in its owner's scope). */
  allEnabled() {
    return this.db.marketplaceSource.findMany({ where: { enabled: true } });
  }
}
