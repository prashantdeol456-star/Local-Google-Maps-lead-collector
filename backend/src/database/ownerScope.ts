import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "./client.js";

// Multi-user data separation. Each request runs inside an OwnerScope (set by the auth guard):
// queries on the models below then only see that user's rows, and new rows get their ownerId.
// The filter is added here, in one place, so no route or repository can forget it.
//
// - customer:    userId = filter = the customer → only their own data
// - super admin: userId = themself, filter = null (all data) or one user's id (?ownerId=…)
// - no scope:    background workers, scripts and tests → unfiltered

export interface OwnerScope {
  /** Who is acting: owner of rows created in this request. */
  userId: string;
  /** Only rows of this owner are visible; null = all owners (super admin). */
  ownerId: string | null;
  /** The acting user is a customer (not a super admin). */
  customer: boolean;
}

export const ownerScope = new AsyncLocalStorage<OwnerScope>();

/** Prisma model names that are owned by a user. */
export const OWNED_MODELS = new Set([
  "Lead",
  "CollectionJob",
  "LinkedInLead",
  // Outreach (phase B)
  "MessageTemplate",
  "Campaign",
  "ContactAttempt",
  "EmailEvent",
  "TrackedLink",
  "WhatsAppEvent",
  "Suppression",
  "LeadCommunicationPreference",
  "OutreachContact",
  // AI Inbox and social accounts (phase C2)
  "SocialAccount",
  "InboxConversation",
  "InboxMessage",
  "InboxDraft",
]);

/** Models owned through their collection (CollectionJob): model → relation field. */
const OWNED_VIA_JOB: Record<string, string> = { JobItem: "job", AgentLog: "job" };

const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

type Row = Record<string, unknown>;
type Args = Row & { where?: Row; data?: unknown; create?: Row };

/**
 * Owner of a new row from what it belongs to: its campaign, contact attempt or lead. Used when
 * no customer is acting: webhooks, unsubscribe and tracking links, workers, and super admins
 * working on a customer's data (the row then belongs to that customer).
 */
function ownerResolver(db: PrismaClient) {
  const cache = new Map<string, Promise<string | null>>();
  const lookup = (key: string, find: () => Promise<{ ownerId: string | null } | null>) => {
    if (!cache.has(key)) cache.set(key, find().then((r) => r?.ownerId ?? null));
    return cache.get(key)!;
  };
  return async (data: Row): Promise<string | null> => {
    if (typeof data.campaignId === "string") {
      const id = data.campaignId;
      const owner = await lookup(`c:${id}`, () => db.campaign.findUnique({ where: { id }, select: { ownerId: true } }));
      if (owner) return owner;
    }
    if (typeof data.attemptId === "string") {
      const id = data.attemptId;
      const owner = await lookup(`a:${id}`, () => db.contactAttempt.findUnique({ where: { id }, select: { ownerId: true } }));
      if (owner) return owner;
    }
    if (typeof data.conversationId === "string") {
      const id = data.conversationId;
      const owner = await lookup(`i:${id}`, () => db.inboxConversation.findUnique({ where: { id }, select: { ownerId: true } }));
      if (owner) return owner;
    }
    if (typeof data.leadId === "string") {
      const id = data.leadId;
      return lookup(`l:${id}`, () => db.lead.findUnique({ where: { id }, select: { ownerId: true } }));
    }
    return null;
  };
}

/** Applies the current OwnerScope to every query on OWNED_MODELS. */
export function withOwnerScope(db: PrismaClient): PrismaClient {
  return db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scope = ownerScope.getStore();
          if (scope?.ownerId && model && model in OWNED_VIA_JOB && !CREATE_OPS.has(operation)) {
            const a = { ...(args as Args) };
            a.where = { ...(a.where ?? {}), [OWNED_VIA_JOB[model]!]: { ownerId: scope.ownerId } };
            return query(a);
          }
          if (!model || !OWNED_MODELS.has(model)) return query(args);
          const a = { ...(args as Args) };

          // New rows: a customer owns what they create; otherwise the owner of what it belongs to.
          const resolve = ownerResolver(db);
          const owned = async (data: unknown): Promise<Row> => {
            const row = (data ?? {}) as Row;
            if (row.ownerId !== undefined) return row;
            const ownerId = scope?.customer ? scope.userId : ((await resolve(row)) ?? scope?.userId ?? null);
            return ownerId ? { ownerId, ...row } : row;
          };
          if (CREATE_OPS.has(operation)) {
            a.data = Array.isArray(a.data) ? await Promise.all(a.data.map(owned)) : await owned(a.data);
            return query(a);
          }
          if (operation === "upsert") a.create = await owned(a.create);
          if (scope?.ownerId) a.where = { ...(a.where ?? {}), ownerId: scope.ownerId };
          return query(a);
        },
      },
    },
  }) as unknown as PrismaClient;
}
