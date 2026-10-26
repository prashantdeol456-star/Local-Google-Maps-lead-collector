import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LEAD_SORT_FIELDS } from "../../database/repositories/index.js";
import type { DedupeService } from "../../services/lead/dedupeService.js";
import { toLeadView, type LeadService } from "../../services/lead/leadService.js";
import { IdParams, Pagination, parse, toSkipTake } from "../validation.js";
import { LeadFilterShape, toLeadFilters } from "../leadFilters.js";

const ListLeadsQuery = Pagination.extend({
  ...LeadFilterShape,
  sort: z.enum(LEAD_SORT_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const text = (max: number) => z.string().max(max).nullish();

/** Lead fields accepted from clients. Normalized/dedupe columns are always computed server-side. */
const LeadBody = z.object({
  name: z.string().trim().min(1).max(300),
  placeId: text(200),
  category: text(200),
  phone: text(50),
  email: z.email().max(254).nullish(),
  website: text(2000),
  address: text(500),
  city: text(100),
  state: text(100),
  country: text(100),
  postalCode: text(20),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  rating: z.number().min(0).max(5).nullish(),
  reviewCount: z.number().int().min(0).nullish(),
  mapsUrl: text(2000),
  searchKeyword: text(100),
  source: z.string().trim().min(1).max(50).optional(),
});

const CreateLeadBody = z
  .object({
    jobId: z.string().min(1).max(64).optional(),
    /** Stable per-listing key from the extension; makes retries idempotent within a job. */
    clientKey: z.string().min(1).max(500).optional(),
    lead: LeadBody,
  })
  .refine((b) => !b.jobId || b.clientKey, { message: "clientKey is required with jobId", path: ["clientKey"] });

/** Admin edit: only these fields; null clears a value. */
const UpdateLeadBody = z
  .object({
    name: z.string().trim().min(1).max(300),
    category: text(200),
    phone: text(50),
    email: z.email().max(254).nullish(),
    website: text(2000),
    address: text(500),
    city: text(100),
    state: text(100),
    country: text(100),
    postalCode: text(20),
  })
  .partial()
  .strict();

export async function leadRoutes(app: FastifyInstance, opts: { leads: LeadService; dedupe: DedupeService; timeZone: string }) {
  const { leads, dedupe } = opts;

  app.post("/api/leads", async (request, reply) => {
    const body = parse(CreateLeadBody, request.body);
    const saved = await dedupe.save(body.lead, { jobId: body.jobId, clientKey: body.clientKey });
    const job = saved.job && {
      id: saved.job.id,
      totalFound: saved.job.totalFound,
      newRecords: saved.job.newRecords,
      duplicateRecords: saved.job.duplicateRecords,
      errorRecords: saved.job.errorRecords,
    };
    return reply.code(saved.result === "new" && !saved.replayed ? 201 : 200).send({
      result: saved.result,
      matchedBy: saved.matchedBy,
      replayed: saved.replayed,
      lead: toLeadView(saved.lead),
      job,
    });
  });

  app.get("/api/leads", async (request) => {
    const query = parse(ListLeadsQuery, request.query);
    const { items, total } = await leads.list({
      ...toLeadFilters(query, opts.timeZone),
      sort: query.sort,
      order: query.order,
      ...toSkipTake(query),
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get("/api/leads/facets", async () => leads.facets());

  app.patch("/api/leads/:id", async (request) => {
    const { id } = parse(IdParams, request.params);
    const body = parse(UpdateLeadBody, request.body);
    return { lead: await leads.update(id, body) };
  });

  app.get("/api/leads/:id", async (request) => {
    const { id } = parse(IdParams, request.params);
    return { lead: await leads.get(id) };
  });

  app.delete("/api/leads/:id", async (request) => {
    const { id } = parse(IdParams, request.params);
    await leads.delete(id);
    return { ok: true };
  });
}
