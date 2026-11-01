import { randomUUID } from "node:crypto";
import {
  dedupeKeys,
  findDuplicate,
  normalizeLeadFields,
  normalizeWhitespace,
  primaryDedupeKey,
  type MatchedBy,
} from "@platform/shared";
import { isUniqueViolation } from "../../database/client.js";
import type { JobRecord, LeadFillableData, LeadRecord, Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { chargeNewLead } from "../billing/credits.js";
import type { EventBus } from "../events.js";
import { QUICK_SEND_SOURCE } from "../outreach/quickSendService.js";

/** A lead as submitted by the extension (already validated by the route). */
export interface LeadInput {
  name: string;
  placeId?: string | null;
  category?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  mapsUrl?: string | null;
  searchKeyword?: string | null;
  source?: string;
}

export interface SaveLeadResult {
  result: "new" | "duplicate";
  matchedBy: MatchedBy | null;
  lead: LeadRecord;
  /** True when this exact (jobId, clientKey) was already saved; nothing changed. */
  replayed: boolean;
  job: JobRecord | null;
}

// Plain fields that are copied onto an existing lead only if it has no value yet.
const FILLABLE_FIELDS = [
  "placeId", "category", "phone", "email", "website", "address", "city", "state", "country",
  "postalCode", "latitude", "longitude", "rating", "reviewCount", "mapsUrl", "searchKeyword",
] as const;

const MAX_ATTEMPTS = 2;

function clean(input: LeadInput) {
  const text = (v: string | null | undefined) => normalizeWhitespace(v);
  return {
    name: text(input.name) ?? "",
    placeId: text(input.placeId),
    category: text(input.category),
    phone: text(input.phone),
    email: text(input.email)?.toLowerCase() ?? null,
    website: text(input.website),
    address: text(input.address),
    city: text(input.city),
    state: text(input.state),
    country: text(input.country),
    postalCode: text(input.postalCode),
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    rating: input.rating ?? null,
    reviewCount: input.reviewCount ?? null,
    mapsUrl: text(input.mapsUrl),
    searchKeyword: text(input.searchKeyword),
    source: text(input.source) ?? "google_maps",
  };
}

/**
 * Saves a lead unless it already exists. Runs entirely inside one transaction:
 * idempotency check → normalize → duplicate lookup → insert or fill-in → job item + counters.
 */
export class DedupeService {
  constructor(
    private readonly repos: Repositories,
    private readonly bus?: EventBus,
  ) {}

  async save(input: LeadInput, opts: { jobId?: string; clientKey?: string } = {}): Promise<SaveLeadResult> {
    if (opts.jobId && !opts.clientKey) throw Errors.badRequest("clientKey is required with jobId");
    for (let attempt = 1; ; attempt++) {
      try {
        const saved = await this.repos.transaction((tx) => this.saveInTx(tx, clean(input), opts));
        // Published after commit, so listeners never see data that could still roll back.
        if (!saved.replayed) {
          this.bus?.publish({ type: "lead.saved", leadId: saved.lead.id, result: saved.result, jobId: saved.job?.id ?? null });
          if (saved.job) this.bus?.publish({ type: "job.updated", jobId: saved.job.id, status: saved.job.status });
        }
        return saved;
      } catch (err) {
        // Another request inserted the same lead at the same moment: retry, it is now a duplicate.
        if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
  }

  private async saveInTx(
    tx: Repositories,
    lead: ReturnType<typeof clean>,
    opts: { jobId?: string; clientKey?: string },
  ): Promise<SaveLeadResult> {
    let job: JobRecord | null = null;
    if (opts.jobId) {
      job = await tx.jobs.findById(opts.jobId);
      if (!job) throw Errors.notFound("Job not found");

      // Idempotency: a retried request returns the original outcome without counting again.
      const previous = await tx.jobItems.find(opts.jobId, opts.clientKey!);
      if (previous) {
        const saved = previous.leadId ? await tx.leads.findById(previous.leadId) : null;
        if (previous.result === "error" || !saved) {
          throw Errors.conflict("ITEM_NOT_SAVED", "This item was recorded without a saved lead");
        }
        return {
          result: previous.result,
          matchedBy: (previous.matchedBy as MatchedBy | null) ?? null,
          lead: saved,
          replayed: true,
          job,
        };
      }
    }

    const normalized = normalizeLeadFields(lead);
    if (!normalized.normalizedName) throw Errors.badRequest("name: must contain letters or digits");
    const keys = dedupeKeys(lead);

    const match = await findDuplicate<LeadRecord>(keys, async (by, value) => {
      switch (by) {
        case "placeId": {
          const found = await tx.leads.findByPlaceId(value);
          return found ? [found] : [];
        }
        case "phone":
          return tx.leads.findByNormalizedPhone(value);
        case "website":
          return tx.leads.findByNormalizedWebsite(value);
        case "nameAddress":
          return tx.leads.findByNameAddress(normalized.normalizedName, normalized.normalizedAddress!);
      }
    });

    const now = new Date();
    let saved: LeadRecord;
    let result: "new" | "duplicate";
    if (match) {
      saved = await tx.leads.update(match.record.id, { ...this.missingFields(match.record, lead, normalized), lastSeenAt: now });
      result = "duplicate";
    } else {
      // Paid inside this transaction: no credit left → nothing is saved (HTTP 402).
      if (lead.source !== QUICK_SEND_SOURCE) await chargeNewLead(tx, `Google Maps: ${lead.name}`);
      saved = await tx.leads.create({
        ...lead,
        ...normalized,
        // No reliable key → a unique random one: the record is never auto-merged.
        dedupeKey: primaryDedupeKey(keys) ?? `uniq:${randomUUID()}`,
      });
      result = "new";
    }

    if (opts.jobId) {
      await tx.jobItems.create({
        jobId: opts.jobId,
        clientKey: opts.clientKey!,
        result,
        matchedBy: match?.matchedBy ?? null,
        leadId: saved.id,
      });
      job = await tx.jobs.incrementCounters(opts.jobId, {
        totalFound: 1,
        ...(result === "new" ? { newRecords: 1 } : { duplicateRecords: 1 }),
      });
      await tx.agentLogs.create({
        jobId: opts.jobId,
        ...(result === "new"
          ? { action: "lead_saved", status: "success" as const, message: saved.name }
          : { action: "duplicate_found", status: "info" as const, message: `${lead.name} → ${saved.name} (by ${match!.matchedBy})` }),
      });
    }

    return { result, matchedBy: match?.matchedBy ?? null, lead: saved, replayed: false, job };
  }

  /** Values the existing lead lacks that the new submission has. Existing values are never overwritten. */
  private missingFields(
    existing: LeadRecord,
    incoming: ReturnType<typeof clean>,
    normalized: ReturnType<typeof normalizeLeadFields>,
  ): LeadFillableData {
    const fill: Record<string, unknown> = {};
    for (const field of FILLABLE_FIELDS) {
      if (existing[field] === null && incoming[field] !== null) fill[field] = incoming[field];
    }
    // Keep the lookup columns in sync with what was filled in.
    if (fill.phone !== undefined) fill.normalizedPhone = normalized.normalizedPhone;
    if (fill.website !== undefined) fill.normalizedWebsite = normalized.normalizedWebsite;
    if (fill.address !== undefined) fill.normalizedAddress = normalized.normalizedAddress;
    return fill as LeadFillableData;
  }
}
