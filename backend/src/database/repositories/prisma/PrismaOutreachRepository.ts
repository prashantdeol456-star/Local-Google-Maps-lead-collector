import type { DbClient } from "../../client.js";
import type {
  AttemptRecord,
  AttemptRepository,
  AttemptStatus,
  CampaignCreateData,
  CampaignRecord,
  CampaignRepository,
  CampaignStatus,
  Channel,
  PreferenceRecord,
  PreferenceRepository,
  TemplateRepository,
  TemplateWriteData,
  TrackedField,
  EmailEventRecord,
  EmailEventRepository,
  TrackedLinkRepository,
  WhatsAppEventRecord,
  SuppressionRecord,
  SuppressionRepository,
  WhatsAppEventRepository,
} from "../types.js";
import { containsInsensitive, isUniqueViolation } from "../../client.js";

export class PrismaTemplateRepository implements TemplateRepository {
  constructor(private readonly db: DbClient) {}

  list(channel: Channel) {
    return this.db.messageTemplate.findMany({ where: { channel }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
  }
  findById(id: string) {
    return this.db.messageTemplate.findUnique({ where: { id } });
  }
  create(data: { channel: Channel } & TemplateWriteData) {
    return this.db.messageTemplate.create({ data });
  }
  async update(id: string, data: Partial<TemplateWriteData>) {
    const { count } = await this.db.messageTemplate.updateMany({ where: { id }, data });
    return count ? this.findById(id) : null;
  }
  async delete(id: string) {
    const { count } = await this.db.messageTemplate.deleteMany({ where: { id } });
    return count > 0;
  }
  countCampaigns(id: string) {
    return this.db.campaign.count({ where: { templateId: id } });
  }
}

export class PrismaCampaignRepository implements CampaignRepository {
  constructor(private readonly db: DbClient) {}

  create(data: CampaignCreateData) {
    return this.db.campaign.create({ data });
  }
  findById(id: string) {
    return this.db.campaign.findUnique({ where: { id } });
  }
  async list(query: { channel: Channel; skip: number; take: number }) {
    const where = { channel: query.channel };
    const [items, total] = await Promise.all([
      this.db.campaign.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: query.skip, take: query.take }),
      this.db.campaign.count({ where }),
    ]);
    return { items, total };
  }
  listByStatus(status: CampaignStatus, channel: Channel) {
    return this.db.campaign.findMany({ where: { status, channel }, orderBy: { createdAt: "asc" } });
  }
  async updateStatus(id: string, from: CampaignStatus[], data: Partial<Pick<CampaignRecord, "status" | "statusReason" | "startedAt" | "completedAt">>) {
    const { count } = await this.db.campaign.updateMany({ where: { id, status: { in: from } }, data });
    return count ? this.findById(id) : null;
  }
  async touchLastSent(id: string, at: Date) {
    await this.db.campaign.update({ where: { id }, data: { lastSentAt: at } });
  }
}

export class PrismaAttemptRepository implements AttemptRepository {
  constructor(private readonly db: DbClient) {}

  findById(id: string) {
    return this.db.contactAttempt.findUnique({ where: { id } });
  }
  findByExternalId(externalMessageId: string) {
    return this.db.contactAttempt.findFirst({ where: { externalMessageId } });
  }
  async markFirst(id: string, field: TrackedField, at: Date) {
    await this.db.contactAttempt.updateMany({ where: { id, [field]: null }, data: { [field]: at } });
  }
  async trackingCounts(campaignId: string) {
    const fields: TrackedField[] = ["deliveredAt", "openedAt", "clickedAt", "bouncedAt", "complainedAt", "repliedAt", "readAt"];
    const counts = await Promise.all(fields.map((f) => this.db.contactAttempt.count({ where: { campaignId, [f]: { not: null } } })));
    return Object.fromEntries(fields.map((f, i) => [f, counts[i]])) as Record<TrackedField, number>;
  }

  async createMany(data: { leadId: string; campaignId: string; channel: Channel; provider: string; templateId: string; toAddress: string }[]) {
    if (data.length === 0) return 0;
    const { count } = await this.db.contactAttempt.createMany({ data });
    return count;
  }
  async countByStatus(campaignId: string) {
    const rows = await this.db.contactAttempt.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<AttemptStatus, number>>;
  }
  async list(query: { campaignId?: string; leadId?: string; status?: AttemptStatus; skip: number; take: number }) {
    const where = {
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.contactAttempt.findMany({
        where,
        include: { campaign: { select: { name: true } } },
        orderBy: [{ createdAt: query.leadId ? "desc" : "asc" }, { id: "asc" }],
        skip: query.skip,
        take: query.take,
      }),
      this.db.contactAttempt.count({ where }),
    ]);
    return { items: rows.map(({ campaign, ...a }) => ({ ...a, campaignName: campaign?.name ?? null })), total };
  }
  countSentSince(campaignId: string, since: Date) {
    return this.db.contactAttempt.count({ where: { campaignId, sentAt: { gte: since } } });
  }
  countSentTotal(channel: Channel) {
    return this.db.contactAttempt.count({ where: { channel, sentAt: { not: null } } });
  }
  nextDue(campaignId: string, now: Date) {
    return this.db.contactAttempt.findFirst({
      where: { campaignId, status: "queued", OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }
  findLatestWhatsAppTo(phone: string) {
    return this.db.contactAttempt.findFirst({
      where: { channel: "whatsapp", toAddress: phone, sentAt: { not: null } },
      orderBy: [{ sentAt: "desc" }, { id: "asc" }],
    });
  }
  async advanceStatus(id: string, from: AttemptStatus[], data: Partial<Omit<AttemptRecord, "id" | "createdAt" | "updatedAt">>) {
    const { count } = await this.db.contactAttempt.updateMany({ where: { id, status: { in: from } }, data });
    return count === 1;
  }
  async claim(id: string) {
    const { count } = await this.db.contactAttempt.updateMany({ where: { id, status: "queued" }, data: { status: "sending" } });
    return count === 1;
  }
  async update(id: string, data: Partial<Omit<AttemptRecord, "id" | "createdAt" | "updatedAt">>) {
    await this.db.contactAttempt.update({ where: { id }, data });
  }
  async cancelQueued(campaignId: string) {
    const { count } = await this.db.contactAttempt.updateMany({ where: { campaignId, status: "queued" }, data: { status: "cancelled" } });
    return count;
  }
  async failStuckSending(channel: Channel, error: string, at: Date) {
    const { count } = await this.db.contactAttempt.updateMany({ where: { channel, status: "sending" }, data: { status: "failed", error, failedAt: at } });
    return count;
  }
  async hasPending(campaignId: string) {
    return (await this.db.contactAttempt.count({ where: { campaignId, status: { in: ["queued", "sending"] } } })) > 0;
  }
}

export class PrismaPreferenceRepository implements PreferenceRepository {
  constructor(private readonly db: DbClient) {}

  find(leadId: string) {
    return this.db.leadCommunicationPreference.findUnique({ where: { leadId } });
  }
  findMany(leadIds: string[]) {
    return this.db.leadCommunicationPreference.findMany({ where: { leadId: { in: leadIds } } });
  }
  upsert(leadId: string, data: Partial<Omit<PreferenceRecord, "leadId" | "updatedAt">>) {
    return this.db.leadCommunicationPreference.upsert({ where: { leadId }, create: { leadId, ...data }, update: data });
  }
}

export class PrismaEmailEventRepository implements EmailEventRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: Omit<EmailEventRecord, "id" | "createdAt">) {
    try {
      return await this.db.emailEvent.create({ data });
    } catch (err) {
      if (data.providerEventId && isUniqueViolation(err)) return null; // webhook retry: already stored
      throw err;
    }
  }
  findById(id: string) {
    return this.db.emailEvent.findUnique({ where: { id } });
  }
  listByLead(leadId: string, take: number) {
    return this.db.emailEvent.findMany({ where: { leadId }, orderBy: [{ occurredAt: "desc" }, { id: "asc" }], take });
  }
}

export class PrismaTrackedLinkRepository implements TrackedLinkRepository {
  constructor(private readonly db: DbClient) {}

  async createMany(links: { id: string; attemptId: string; url: string }[]) {
    if (links.length) await this.db.trackedLink.createMany({ data: links });
  }
  findById(id: string) {
    return this.db.trackedLink.findUnique({ where: { id } });
  }
}

export class PrismaWhatsAppEventRepository implements WhatsAppEventRepository {
  constructor(private readonly db: DbClient) {}

  async create(data: Omit<WhatsAppEventRecord, "id" | "createdAt">) {
    try {
      return await this.db.whatsAppEvent.create({ data });
    } catch (err) {
      if (data.providerEventId && isUniqueViolation(err)) return null; // webhook retry: already stored
      throw err;
    }
  }
  findById(id: string) {
    return this.db.whatsAppEvent.findUnique({ where: { id } });
  }
  listByLead(leadId: string, take: number) {
    return this.db.whatsAppEvent.findMany({ where: { leadId }, orderBy: [{ occurredAt: "desc" }, { id: "asc" }], take });
  }
  async listReceived(page: { skip: number; take: number }) {
    const where = { type: "received" as const };
    const [rows, total] = await Promise.all([
      this.db.whatsAppEvent.findMany({
        where,
        include: { lead: { select: { name: true } } },
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
        skip: page.skip,
        take: page.take,
      }),
      this.db.whatsAppEvent.count({ where }),
    ]);
    return { items: rows.map(({ lead, ...e }) => ({ ...e, leadName: lead?.name ?? null })), total };
  }
}

export class PrismaSuppressionRepository implements SuppressionRepository {
  constructor(private readonly db: DbClient) {}

  async addMany(rows: Omit<SuppressionRecord, "id" | "createdAt">[]) {
    const added: SuppressionRecord[] = [];
    for (const data of rows) {
      try {
        added.push(await this.db.suppression.create({ data }));
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // already suppressed: keep the first reason
      }
    }
    return added;
  }
  findByAddresses(channel: Channel, addresses: string[]) {
    if (addresses.length === 0) return Promise.resolve([]);
    return this.db.suppression.findMany({ where: { channel, address: { in: addresses } }, orderBy: { createdAt: "asc" } });
  }
  findById(id: string) {
    return this.db.suppression.findUnique({ where: { id } });
  }
  async list(query: { channel?: Channel; q?: string; skip: number; take: number }) {
    const where = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.q ? { OR: [{ address: containsInsensitive(query.q) }, { reason: containsInsensitive(query.q) }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.suppression.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: query.skip, take: query.take }),
      this.db.suppression.count({ where }),
    ]);
    return { items, total };
  }
  async delete(id: string) {
    const { count } = await this.db.suppression.deleteMany({ where: { id } });
    return count > 0;
  }
  async deleteAddresses(channel: Channel, addresses: string[], source?: string) {
    if (addresses.length === 0) return 0;
    const { count } = await this.db.suppression.deleteMany({ where: { channel, address: { in: addresses }, ...(source ? { source } : {}) } });
    return count;
  }
  count(channel: Channel) {
    return this.db.suppression.count({ where: { channel } });
  }
}
