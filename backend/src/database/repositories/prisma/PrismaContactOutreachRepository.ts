import { containsInsensitive, type DbClient } from "../../client.js";
import type {
  AttemptStatus,
  CampaignLogEntry,
  CampaignLogRepository,
  CampaignStatus,
  Channel,
  ContactData,
  ContactFilters,
  ContactRepository,
  LinkedInCampaignCreateData,
  LinkedInCampaignRecord,
  LinkedInMessageRecord,
  LinkedInOutreachRepository,
  SocialAccountData,
  SocialAccountRecord,
  SocialAccountRepository,
} from "../types.js";

const LIST_FACET_LIMIT = 50;

function contactWhere(f: ContactFilters) {
  return {
    ...(f.q
      ? {
          OR: [
            { name: containsInsensitive(f.q) },
            { company: containsInsensitive(f.q) },
            { designation: containsInsensitive(f.q) },
            { email: containsInsensitive(f.q) },
            { phone: containsInsensitive(f.q) },
            { linkedinUrl: containsInsensitive(f.q) },
          ],
        }
      : {}),
    ...(f.listName ? { listName: f.listName } : {}),
    ...(f.hasLinkedIn !== undefined ? { linkedinUrl: f.hasLinkedIn ? { not: null } : null } : {}),
    ...(f.hasEmail !== undefined ? { email: f.hasEmail ? { not: null } : null } : {}),
    ...(f.hasPhone !== undefined ? { phone: f.hasPhone ? { not: null } : null } : {}),
  };
}

export class PrismaContactRepository implements ContactRepository {
  constructor(private readonly db: DbClient) {}

  findById(id: string) {
    return this.db.outreachContact.findUnique({ where: { id } });
  }
  findByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.outreachContact.findMany({ where: { id: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }
  findByLinkedInUrls(urls: string[]) {
    if (urls.length === 0) return Promise.resolve([]);
    return this.db.outreachContact.findMany({ where: { linkedinUrl: { in: urls } } });
  }
  findByEmails(emails: string[]) {
    if (emails.length === 0) return Promise.resolve([]);
    return this.db.outreachContact.findMany({ where: { email: { in: emails } } });
  }
  create(data: ContactData) {
    return this.db.outreachContact.create({ data });
  }
  update(id: string, data: Partial<ContactData>) {
    return this.db.outreachContact.update({ where: { id }, data });
  }
  async deleteMany(ids: string[]) {
    if (ids.length === 0) return 0;
    const { count } = await this.db.outreachContact.deleteMany({ where: { id: { in: ids } } });
    return count;
  }
  async list(query: ContactFilters & { skip: number; take: number }) {
    const where = contactWhere(query);
    const [items, total] = await Promise.all([
      this.db.outreachContact.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: query.skip, take: query.take }),
      this.db.outreachContact.count({ where }),
    ]);
    return { items, total };
  }
  listAll(filters: ContactFilters, take: number) {
    return this.db.outreachContact.findMany({ where: contactWhere(filters), orderBy: [{ createdAt: "asc" }, { id: "asc" }], take });
  }
  async facets() {
    const [total, withLinkedIn, withEmail, withPhone, lists] = await Promise.all([
      this.db.outreachContact.count(),
      this.db.outreachContact.count({ where: { linkedinUrl: { not: null } } }),
      this.db.outreachContact.count({ where: { email: { not: null } } }),
      this.db.outreachContact.count({ where: { phone: { not: null } } }),
      this.db.outreachContact.groupBy({ by: ["listName"], where: { listName: { not: null } }, _count: { _all: true } }),
    ]);
    return {
      total,
      withLinkedIn,
      withEmail,
      withPhone,
      lists: lists
        .map((r) => ({ value: r.listName!, count: r._count._all }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, LIST_FACET_LIMIT),
    };
  }
}

export class PrismaLinkedInOutreachRepository implements LinkedInOutreachRepository {
  constructor(private readonly db: DbClient) {}

  async createCampaign(data: LinkedInCampaignCreateData, messages: Pick<LinkedInMessageRecord, "contactId" | "profileUrl" | "contactName" | "renderedBody">[]) {
    const campaign = await this.db.linkedInCampaign.create({ data });
    if (messages.length) await this.db.linkedInMessage.createMany({ data: messages.map((m) => ({ ...m, campaignId: campaign.id })) });
    return campaign;
  }
  findCampaign(id: string) {
    return this.db.linkedInCampaign.findUnique({ where: { id } });
  }
  async listCampaigns(page: { skip: number; take: number }) {
    const [items, total] = await Promise.all([
      this.db.linkedInCampaign.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.skip, take: page.take }),
      this.db.linkedInCampaign.count(),
    ]);
    return { items, total };
  }
  listCampaignsByStatus(status: CampaignStatus) {
    return this.db.linkedInCampaign.findMany({ where: { status }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }
  async updateCampaignStatus(id: string, from: CampaignStatus[], data: Partial<Pick<LinkedInCampaignRecord, "status" | "statusReason" | "startedAt" | "completedAt">>) {
    const { count } = await this.db.linkedInCampaign.updateMany({ where: { id, status: { in: from } }, data });
    return count ? this.findCampaign(id) : null;
  }
  async touchLastSent(id: string, at: Date) {
    await this.db.linkedInCampaign.update({ where: { id }, data: { lastSentAt: at } });
  }
  async countByStatus(campaignId: string) {
    const rows = await this.db.linkedInMessage.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<AttemptStatus, number>>;
  }
  countSentSince(campaignId: string, since: Date) {
    return this.db.linkedInMessage.count({ where: { campaignId, sentAt: { gte: since } } });
  }
  async listMessages(query: { campaignId: string; status?: AttemptStatus; skip: number; take: number }) {
    const where = { campaignId: query.campaignId, ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await Promise.all([
      this.db.linkedInMessage.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: query.skip, take: query.take }),
      this.db.linkedInMessage.count({ where }),
    ]);
    return { items, total };
  }
  findMessage(id: string) {
    return this.db.linkedInMessage.findUnique({ where: { id } });
  }
  nextQueued(campaignId: string) {
    return this.db.linkedInMessage.findFirst({ where: { campaignId, status: "queued" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  }
  async claim(id: string, at: Date) {
    const { count } = await this.db.linkedInMessage.updateMany({ where: { id, status: "queued" }, data: { status: "sending", claimedAt: at, error: null } });
    return count > 0;
  }
  async finish(id: string, data: Pick<LinkedInMessageRecord, "status" | "error" | "sentAt" | "failedAt">) {
    const { count } = await this.db.linkedInMessage.updateMany({ where: { id, status: "sending" }, data });
    return count > 0;
  }
  async release(id: string, error: string) {
    const { count } = await this.db.linkedInMessage.updateMany({ where: { id, status: "sending" }, data: { status: "queued", claimedAt: null, error } });
    return count > 0;
  }
  inFlight() {
    return this.db.linkedInMessage.findFirst({ where: { status: "sending" }, orderBy: { claimedAt: "asc" } });
  }
  async failStale(before: Date, error: string, at: Date) {
    const { count } = await this.db.linkedInMessage.updateMany({ where: { status: "sending", claimedAt: { lt: before } }, data: { status: "failed", error, failedAt: at } });
    return count;
  }
  async cancelQueued(campaignId: string) {
    const { count } = await this.db.linkedInMessage.updateMany({ where: { campaignId, status: "queued" }, data: { status: "cancelled" } });
    return count;
  }
  async hasPending(campaignId: string) {
    return (await this.db.linkedInMessage.count({ where: { campaignId, status: { in: ["queued", "sending"] } } })) > 0;
  }
}

/** Deep pages of the merged (all channels) log are not needed; this bounds the merge work. */
export const MAX_MERGED_LOG_ROWS = 5000;

export class PrismaCampaignLogRepository implements CampaignLogRepository {
  constructor(private readonly db: DbClient) {}

  async list(query: { channel?: Channel | "linkedin"; status?: AttemptStatus; campaignId?: string; q?: string; skip: number; take: number }) {
    const wantAttempts = query.channel !== "linkedin";
    const wantLinkedIn = query.channel === undefined || query.channel === "linkedin";
    // Rows from both tables are merged by time, so each table must supply the first skip+take rows.
    const window = Math.min(query.skip + query.take, MAX_MERGED_LOG_ROWS);
    const single = !(wantAttempts && wantLinkedIn);
    const page = single ? { skip: query.skip, take: query.take } : { skip: 0, take: window };

    const attemptWhere = {
      ...(query.channel && query.channel !== "linkedin" ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.q ? { OR: [{ toAddress: containsInsensitive(query.q) }, { lead: { name: containsInsensitive(query.q) } }] } : {}),
    };
    const messageWhere = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.q ? { OR: [{ contactName: containsInsensitive(query.q) }, { profileUrl: containsInsensitive(query.q) }] } : {}),
    };

    const [attempts, attemptTotal, messages, messageTotal] = await Promise.all([
      wantAttempts
        ? this.db.contactAttempt.findMany({
            where: attemptWhere,
            include: { campaign: { select: { name: true } }, lead: { select: { name: true } } },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            ...page,
          })
        : [],
      wantAttempts ? this.db.contactAttempt.count({ where: attemptWhere }) : 0,
      wantLinkedIn
        ? this.db.linkedInMessage.findMany({
            where: messageWhere,
            include: { campaign: { select: { name: true } } },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            ...page,
          })
        : [],
      wantLinkedIn ? this.db.linkedInMessage.count({ where: messageWhere }) : 0,
    ]);

    const rows: CampaignLogEntry[] = [
      ...attempts.map((a) => ({
        id: a.id,
        channel: a.channel,
        campaignId: a.campaignId,
        campaignName: a.campaign?.name ?? null,
        recipient: a.lead.name,
        to: a.toAddress,
        status: a.status,
        error: a.error,
        sentAt: a.sentAt,
        updatedAt: a.updatedAt,
      })),
      ...messages.map((m) => ({
        id: m.id,
        channel: "linkedin" as const,
        campaignId: m.campaignId,
        campaignName: m.campaign.name,
        recipient: m.contactName,
        to: m.profileUrl,
        status: m.status,
        error: m.error,
        sentAt: m.sentAt,
        updatedAt: m.updatedAt,
      })),
    ];
    const total = attemptTotal + messageTotal;
    if (single) return { items: rows, total };
    rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
    return { items: rows.slice(query.skip, query.skip + query.take), total: Math.min(total, MAX_MERGED_LOG_ROWS) };
  }

  events(take: number) {
    return this.db.agentLog.findMany({
      where: { jobId: null, action: { contains: "_campaign_" } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take,
      select: { id: true, action: true, status: true, message: true, createdAt: true },
    });
  }
}

export class PrismaSocialAccountRepository implements SocialAccountRepository {
  constructor(private readonly db: DbClient) {}

  list() {
    return this.db.socialAccount.findMany({ orderBy: [{ platform: "asc" }, { name: "asc" }] });
  }
  findById(id: string) {
    return this.db.socialAccount.findUnique({ where: { id } });
  }
  upsert(data: SocialAccountData): Promise<SocialAccountRecord> {
    const fresh = { ...data, status: data.status ?? "connected", lastError: data.lastError ?? null, lastCheckedAt: data.lastCheckedAt ?? new Date() };
    return this.db.socialAccount.upsert({
      where: { platform_externalId: { platform: data.platform, externalId: data.externalId } },
      create: fresh,
      update: fresh,
    });
  }
  async update(id: string, data: Partial<Pick<SocialAccountRecord, "status" | "lastError" | "lastCheckedAt" | "name" | "username" | "pictureUrl">>) {
    await this.db.socialAccount.updateMany({ where: { id }, data });
  }
  async delete(id: string) {
    const { count } = await this.db.socialAccount.deleteMany({ where: { id } });
    return count > 0;
  }
}
