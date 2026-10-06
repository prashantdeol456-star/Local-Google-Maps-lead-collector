import type { DbClient } from "../../client.js";
import type { AgentLogLevel, AgentLogRepository } from "../types.js";

export class PrismaAgentLogRepository implements AgentLogRepository {
  constructor(private readonly db: DbClient) {}

  create(data: { jobId: string | null; action: string; status: AgentLogLevel; message?: string | null }) {
    return this.db.agentLog.create({ data: { ...data, message: data.message ?? null } });
  }

  countByJob(jobId: string, action: string) {
    return this.db.agentLog.count({ where: { jobId, action } });
  }

  listByJob(jobId: string, take: number) {
    return this.db.agentLog.findMany({
      where: { jobId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
  }
}
