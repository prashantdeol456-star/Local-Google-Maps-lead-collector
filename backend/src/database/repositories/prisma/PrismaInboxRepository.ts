import { containsInsensitive, isUniqueViolation, type DbClient } from "../../client.js";
import type { InboxConversationRecord, InboxDraftRecord, InboxMessageRecord, InboxRepository } from "../types.js";

const SETTINGS_ID = "default";

export class PrismaInboxRepository implements InboxRepository {
  constructor(private readonly db: DbClient) {}

  async getSettings() {
    return (
      (await this.db.aiAssistantSettings.findUnique({ where: { id: SETTINGS_ID } })) ??
      this.db.aiAssistantSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID }, update: {} })
    );
  }
  async updateSettings(data: Parameters<InboxRepository["updateSettings"]>[0]) {
    return this.db.aiAssistantSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
  }

  async upsertConversation(data: Parameters<InboxRepository["upsertConversation"]>[0]) {
    const where = { platform_accountKey_externalThreadId: { platform: data.platform, accountKey: data.accountKey, externalThreadId: data.externalThreadId } };
    const details = {
      participantName: data.participantName,
      ...(data.participantId !== undefined ? { participantId: data.participantId } : {}),
      ...(data.participantUsername !== undefined ? { participantUsername: data.participantUsername } : {}),
    };
    try {
      return await this.db.inboxConversation.upsert({ where, create: { ...data, ...details, lastMessageAt: new Date(0) }, update: details });
    } catch (err) {
      // Two pollers creating the same chat at once: the second one reads it.
      if (!isUniqueViolation(err)) throw err;
      return this.db.inboxConversation.update({ where, data: details });
    }
  }
  findConversation(id: string) {
    return this.db.inboxConversation.findUnique({ where: { id } });
  }
  findConversationByThread(platform: string, accountKey: string, externalThreadId: string) {
    return this.db.inboxConversation.findUnique({ where: { platform_accountKey_externalThreadId: { platform, accountKey, externalThreadId } } });
  }
  updateConversation(id: string, data: Partial<Omit<InboxConversationRecord, "id" | "createdAt" | "updatedAt">>) {
    return this.db.inboxConversation.update({ where: { id }, data });
  }

  async listConversations(query: { platform?: string; status?: string; q?: string; skip: number; take: number }) {
    const where = {
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? { OR: [{ participantName: containsInsensitive(query.q) }, { participantUsername: containsInsensitive(query.q) }, { summary: containsInsensitive(query.q) }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.inboxConversation.findMany({
        where,
        orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
        skip: query.skip,
        take: query.take,
        include: {
          messages: { orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }], take: 1, select: { direction: true, text: true, author: true, sentAt: true } },
          drafts: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, text: true, confidence: true, needsHuman: true, decision: true } },
        },
      }),
      this.db.inboxConversation.count({ where }),
    ]);
    return { items: rows.map(({ messages, drafts, ...c }) => ({ ...c, lastMessage: messages[0] ?? null, pendingDraft: drafts[0] ?? null })), total };
  }

  async countByStatus() {
    const rows = await this.db.inboxConversation.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  async addMessages(conversationId: string, messages: Pick<InboxMessageRecord, "direction" | "externalId" | "text" | "author" | "sentAt">[]) {
    const ids = messages.map((m) => m.externalId).filter((x): x is string => !!x);
    const existing = new Set(
      ids.length ? (await this.db.inboxMessage.findMany({ where: { conversationId, externalId: { in: ids } }, select: { externalId: true } })).map((m) => m.externalId) : [],
    );
    const created: InboxMessageRecord[] = [];
    for (const m of messages) {
      if (m.externalId && existing.has(m.externalId)) continue;
      try {
        created.push(await this.db.inboxMessage.create({ data: { ...m, conversationId } }));
        if (m.externalId) existing.add(m.externalId);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // stored meanwhile by another poll
      }
    }
    return created;
  }
  async recentMessages(conversationId: string, take: number) {
    const rows = await this.db.inboxMessage.findMany({ where: { conversationId }, orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }], take });
    return rows.reverse();
  }
  lastInbound(conversationId: string) {
    return this.db.inboxMessage.findFirst({ where: { conversationId, direction: "in" }, orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }] });
  }
  countAutoRepliesSince(conversationId: string, since: Date) {
    return this.db.inboxMessage.count({ where: { conversationId, author: "ai_auto", sentAt: { gte: since } } });
  }
  awaitingReply(since: Date, before: Date, take: number) {
    return this.db.inboxConversation.findMany({
      where: { status: "needs_reply", lastInboundAt: { gte: since, lte: before } },
      orderBy: { lastInboundAt: "asc" },
      take,
    });
  }

  createDraft(data: Parameters<InboxRepository["createDraft"]>[0]) {
    return this.db.inboxDraft.create({ data });
  }
  findDraft(id: string) {
    return this.db.inboxDraft.findUnique({ where: { id } });
  }
  draftFor(conversationId: string, forMessageId: string) {
    return this.db.inboxDraft.findFirst({ where: { conversationId, forMessageId }, orderBy: { createdAt: "desc" } });
  }
  pendingDraft(conversationId: string) {
    return this.db.inboxDraft.findFirst({ where: { conversationId, status: "pending" }, orderBy: { createdAt: "desc" } });
  }
  listDrafts(conversationId: string, take: number) {
    return this.db.inboxDraft.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take });
  }
  async updateDraft(id: string, from: string[], data: Partial<Pick<InboxDraftRecord, "status" | "text" | "error" | "sentAt" | "decision">>) {
    const { count } = await this.db.inboxDraft.updateMany({ where: { id, status: { in: from } }, data });
    return count > 0;
  }
  async supersedePending(conversationId: string) {
    const { count } = await this.db.inboxDraft.updateMany({ where: { conversationId, status: "pending" }, data: { status: "superseded" } });
    return count;
  }
  async pendingLinkedInDrafts(threadId?: string) {
    const rows = await this.db.inboxDraft.findMany({
      where: { status: "pending", conversation: { platform: "linkedin", ...(threadId ? { externalThreadId: threadId } : {}) } },
      include: { conversation: { select: { externalThreadId: true, participantName: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    return rows.map(({ conversation, ...d }) => ({ ...d, threadId: conversation.externalThreadId, participantName: conversation.participantName }));
  }
}
