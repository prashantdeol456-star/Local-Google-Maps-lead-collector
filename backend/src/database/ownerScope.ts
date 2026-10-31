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
export const OWNED_MODELS = new Set(["Lead", "CollectionJob", "LinkedInLead"]);

/** Models owned through their collection (CollectionJob): model → relation field. */
const OWNED_VIA_JOB: Record<string, string> = { JobItem: "job", AgentLog: "job" };

const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> };

const withOwner = (data: unknown, userId: string) => ({ ownerId: userId, ...(data as Record<string, unknown>) });

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
          if (!scope || !model || !OWNED_MODELS.has(model)) return query(args);
          const a = { ...(args as Args) };
          if (CREATE_OPS.has(operation)) {
            a.data = Array.isArray(a.data) ? a.data.map((d) => withOwner(d, scope.userId)) : withOwner(a.data, scope.userId);
          } else {
            if (operation === "upsert") a.create = withOwner(a.create, scope.userId);
            if (scope.ownerId) a.where = { ...(a.where ?? {}), ownerId: scope.ownerId };
          }
          return query(a);
        },
      },
    },
  }) as unknown as PrismaClient;
}
