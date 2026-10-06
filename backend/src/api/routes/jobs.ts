import { JOB_STATUSES, MAX_KEYWORD_LENGTH, MAX_QUEUE_KEYWORDS, MAX_RECORDS_LIMIT } from "@platform/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobService } from "../../services/collection/jobService.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const keyword = z.string().trim().min(1).max(MAX_KEYWORD_LENGTH);
const location = z.string().trim().max(100).nullish();
const maxRecords = z.number().int().min(1).max(MAX_RECORDS_LIMIT).nullish();

const CreateJobBody = z.object({ searchKeyword: keyword, location, maxRecords });

const CreateQueueBody = z.object({
  keywords: z
    .array(keyword)
    .min(1)
    .max(MAX_QUEUE_KEYWORDS)
    .refine((ks) => new Set(ks.map((k) => k.toLowerCase())).size === ks.length, "keywords must be unique"),
  location,
  maxRecords,
});

const ListJobsQuery = Pagination.extend({
  status: z.enum(JOB_STATUSES).optional(),
  queueId: optionalText(64),
});

// "pending" is only the initial state; it cannot be set through the API.
const UpdateJobBody = z.object({
  status: z.enum(["running", "paused", "completed", "stopped", "failed"]),
  statusReason: z.string().trim().max(500).nullish(),
});

const ItemErrorBody = z.object({
  clientKey: z.string().min(1).max(500),
  name: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(1000),
});

export async function jobRoutes(app: FastifyInstance, opts: { jobs: JobService }) {
  const { jobs } = opts;

  app.post("/api/jobs", async (request, reply) => {
    const body = parse(CreateJobBody, request.body);
    const job = await jobs.create(body, request.admin!.id);
    return reply.code(201).send({ job });
  });

  // Multi-keyword search queue: one pending job per keyword, run one at a time by the user.
  app.post("/api/jobs/queue", async (request, reply) => {
    const body = parse(CreateQueueBody, request.body);
    return reply.code(201).send(await jobs.createQueue(body, request.admin!.id));
  });

  app.get("/api/jobs", async (request) => {
    const query = parse(ListJobsQuery, request.query);
    const { items, total } = await jobs.list({ status: query.status, queueId: query.queueId, ...toSkipTake(query) });
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get("/api/jobs/:id", async (request) => {
    const { id } = parse(IdParams, request.params);
    return { job: await jobs.get(id) };
  });

  app.get("/api/jobs/:id/logs", async (request) => {
    const { id } = parse(IdParams, request.params);
    await jobs.get(id); // 404 for unknown jobs
    return { items: await jobs.logs(id) };
  });

  app.patch("/api/jobs/:id", async (request) => {
    const { id } = parse(IdParams, request.params);
    const body = parse(UpdateJobBody, request.body);
    return { job: await jobs.changeStatus(id, body.status, body.statusReason) };
  });

  // A listing that could not be extracted (counted in errorRecords; idempotent per clientKey).
  app.post("/api/jobs/:id/items/error", async (request) => {
    const { id } = parse(IdParams, request.params);
    const body = parse(ItemErrorBody, request.body);
    return { job: await jobs.recordItemError(id, body) };
  });
}
