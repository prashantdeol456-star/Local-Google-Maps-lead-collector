import type { JobStatus } from "@platform/shared";
import type { DbClient } from "../../client.js";
import type {
  JobCreateData,
  JobItemRepository,
  JobItemResult,
  JobListQuery,
  JobRepository,
  JobStatusUpdate,
} from "../types.js";

export class PrismaJobRepository implements JobRepository {
  constructor(private readonly db: DbClient) {}

  create(data: JobCreateData) {
    return this.db.collectionJob.create({ data });
  }

  findById(id: string) {
    return this.db.collectionJob.findUnique({ where: { id } });
  }

  async list(query: JobListQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.queueId ? { queueId: query.queueId } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.collectionJob.findMany({
        where,
        // A queue is listed in run order; everything else newest first.
        orderBy: query.queueId ? [{ position: "asc" as const }] : [{ createdAt: "desc" as const }, { id: "asc" as const }],
        skip: query.skip,
        take: query.take,
      }),
      this.db.collectionJob.count({ where }),
    ]);
    return { items, total };
  }

  async updateStatus(id: string, expectedStatus: JobStatus, update: JobStatusUpdate) {
    const { count } = await this.db.collectionJob.updateMany({
      where: { id, status: expectedStatus },
      data: update,
    });
    return count === 0 ? null : this.findById(id);
  }

  findOtherWithStatus(status: JobStatus, excludeId: string) {
    return this.db.collectionJob.findFirst({ where: { status, id: { not: excludeId } } });
  }

  findLatestActive() {
    return this.db.collectionJob.findFirst({
      where: { status: { in: ["running", "paused"] } },
      orderBy: { updatedAt: "desc" },
    });
  }

  count(status?: JobStatus) {
    return this.db.collectionJob.count({ where: status ? { status } : {} });
  }

  incrementCounters(
    id: string,
    by: { totalFound?: number; newRecords?: number; duplicateRecords?: number; errorRecords?: number },
  ) {
    // Atomic increments: concurrent requests cannot lose counts.
    const data = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { increment: v ?? 0 }]));
    return this.db.collectionJob.update({ where: { id }, data });
  }
}

export class PrismaJobItemRepository implements JobItemRepository {
  constructor(private readonly db: DbClient) {}

  countByResult(result: JobItemResult) {
    return this.db.jobItem.count({ where: { result } });
  }

  find(jobId: string, clientKey: string) {
    return this.db.jobItem.findUnique({ where: { jobId_clientKey: { jobId, clientKey } } });
  }

  create(data: { jobId: string; clientKey: string; result: JobItemResult; matchedBy: string | null; leadId: string | null; error?: string | null }) {
    return this.db.jobItem.create({ data: { ...data, error: data.error ?? null } });
  }
}
