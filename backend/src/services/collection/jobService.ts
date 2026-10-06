import { randomUUID } from "node:crypto";
import { canTransitionJob, isFinalJobStatus, type JobStatus } from "@platform/shared";
import type { AgentLogLevel, JobListQuery, JobRecord, Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import type { EventBus } from "../events.js";

export interface CreateJobInput {
  searchKeyword: string;
  location?: string | null;
  maxRecords?: number | null;
}

/** Log action + level written for each status change (structured log names from the spec). */
function logFor(job: JobRecord, to: JobStatus): { action: string; status: AgentLogLevel } {
  switch (to) {
    case "running":
      return job.startedAt ? { action: "job_resumed", status: "info" } : { action: "search_started", status: "info" };
    case "paused":
      return { action: "job_paused", status: "warning" };
    case "completed":
      return { action: "job_completed", status: "success" };
    case "stopped":
      return { action: "job_stopped", status: "warning" };
    case "failed":
      return { action: "job_failed", status: "error" };
    case "pending":
      return { action: "job_pending", status: "info" };
  }
}

export class JobService {
  constructor(
    private readonly repos: Repositories,
    private readonly bus?: EventBus,
  ) {}

  private changed(job: JobRecord): JobRecord {
    this.bus?.publish({ type: "job.updated", jobId: job.id, status: job.status });
    return job;
  }

  async create(input: CreateJobInput, adminId: string | null): Promise<JobRecord> {
    const job = await this.repos.jobs.create({
      searchKeyword: input.searchKeyword.trim(),
      location: input.location?.trim() || null,
      maxRecords: input.maxRecords ?? null,
      createdById: adminId,
    });
    const where = job.location ? ` in ${job.location}` : "";
    await this.repos.agentLogs.create({
      jobId: job.id,
      action: "job_created",
      status: "info",
      message: `"${job.searchKeyword}"${where}${job.maxRecords ? `, max ${job.maxRecords}` : ""}`,
    });
    return this.changed(job);
  }

  /**
   * Creates one pending job per keyword, sharing a queueId, in the given order.
   * Nothing runs automatically: the user starts each search.
   */
  async createQueue(
    input: { keywords: string[]; location?: string | null; maxRecords?: number | null },
    adminId: string | null,
  ): Promise<{ queueId: string; jobs: JobRecord[] }> {
    const queueId = randomUUID();
    const location = input.location?.trim() || null;
    const jobs = await this.repos.transaction(async (tx) => {
      const created: JobRecord[] = [];
      for (const [position, keyword] of input.keywords.entries()) {
        const job = await tx.jobs.create({
          searchKeyword: keyword,
          location,
          maxRecords: input.maxRecords ?? null,
          createdById: adminId,
          queueId,
          position,
        });
        await tx.agentLogs.create({
          jobId: job.id,
          action: "job_created",
          status: "info",
          message: `Queue ${position + 1}/${input.keywords.length}: "${keyword}"${location ? ` in ${location}` : ""}`,
        });
        created.push(job);
      }
      return created;
    });
    jobs.forEach((job) => this.changed(job));
    return { queueId, jobs };
  }

  /**
   * Records that one listing could not be extracted. Idempotent per (jobId, clientKey),
   * so a retried request is not counted twice.
   */
  async recordItemError(jobId: string, item: { clientKey: string; name: string; message: string }): Promise<JobRecord> {
    const job = await this.repos.transaction(async (tx) => {
      const job = await tx.jobs.findById(jobId);
      if (!job) throw Errors.notFound("Job not found");
      if (await tx.jobItems.find(jobId, item.clientKey)) return job;

      await tx.jobItems.create({ jobId, clientKey: item.clientKey, result: "error", matchedBy: null, leadId: null, error: item.message });
      await tx.agentLogs.create({ jobId, action: "extraction_error", status: "error", message: `${item.name}: ${item.message}` });
      return tx.jobs.incrementCounters(jobId, { totalFound: 1, errorRecords: 1 });
    });
    return this.changed(job);
  }

  list(query: JobListQuery) {
    return this.repos.jobs.list(query);
  }

  async get(id: string): Promise<JobRecord> {
    const job = await this.repos.jobs.findById(id);
    if (!job) throw Errors.notFound("Job not found");
    return job;
  }

  logs(id: string, take = 100) {
    return this.repos.agentLogs.listByJob(id, take);
  }

  /**
   * Moves a job to a new status. Rules:
   * - only transitions allowed by canTransitionJob
   * - at most one job may be running at a time
   * - startedAt is set on the first run; completedAt when the job reaches a final status
   */
  async changeStatus(id: string, to: JobStatus, reason?: string | null): Promise<JobRecord> {
    const job = await this.get(id);
    if (job.status === to) return job; // idempotent: retrying the same request is harmless

    if (!canTransitionJob(job.status, to)) {
      throw Errors.conflict("INVALID_TRANSITION", `Cannot change job from ${job.status} to ${to}`);
    }
    if (to === "running") {
      const other = await this.repos.jobs.findOtherWithStatus("running", id);
      if (other) throw Errors.conflict("JOB_ALREADY_RUNNING", `Another job is already running ("${other.searchKeyword}")`);
    }

    const now = new Date();
    const updated = await this.repos.jobs.updateStatus(id, job.status, {
      status: to,
      statusReason: reason?.trim() || null,
      ...(to === "running" && !job.startedAt ? { startedAt: now } : {}),
      ...(isFinalJobStatus(to) ? { completedAt: now } : {}),
    });
    if (!updated) throw Errors.conflict("JOB_CHANGED", "Job status changed meanwhile, reload and try again");

    const log = logFor(job, to);
    await this.repos.agentLogs.create({ jobId: id, ...log, message: reason?.trim() || null });
    return this.changed(updated);
  }
}
