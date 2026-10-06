import { normalizeAddress, normalizeName, normalizePhone, normalizeWebsite, normalizeWhitespace } from "@platform/shared";
import type {
  LeadEditableField,
  LeadEditData,
  LeadListQuery,
  LeadRecord,
  Repositories,
} from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import type { EventBus } from "../events.js";

/** API view of a lead: internal dedupe columns are not exposed. */
export type LeadView = Omit<LeadRecord, "normalizedName" | "normalizedPhone" | "normalizedWebsite" | "normalizedAddress" | "dedupeKey">;

export function toLeadView(lead: LeadRecord): LeadView {
  const { normalizedName, normalizedPhone, normalizedWebsite, normalizedAddress, dedupeKey, ...view } = lead;
  return view;
}

export type LeadPatch = Partial<Record<LeadEditableField, string | null>>;

const FACET_LIMIT = 200;

export class LeadService {
  constructor(
    private readonly repos: Repositories,
    private readonly bus: EventBus,
  ) {}

  async list(query: LeadListQuery) {
    const { items, total } = await this.repos.leads.list(query);
    return { items: items.map(toLeadView), total };
  }

  async get(id: string): Promise<LeadView> {
    const lead = await this.repos.leads.findById(id);
    if (!lead) throw Errors.notFound("Lead not found");
    return toLeadView(lead);
  }

  facets() {
    return this.repos.leads.facets(FACET_LIMIT);
  }

  /**
   * Admin edit. Only the given fields change; the lookup columns used for duplicate
   * detection are recomputed so future collections still match this lead.
   */
  async update(id: string, patch: LeadPatch): Promise<LeadView> {
    const data: LeadEditData = {};
    for (const [field, value] of Object.entries(patch) as [LeadEditableField, string | null | undefined][]) {
      if (value === undefined) continue;
      const cleaned = normalizeWhitespace(value);
      if (field === "name") {
        if (!cleaned || !normalizeName(cleaned)) throw Errors.badRequest("name: must contain letters or digits");
        data.name = cleaned;
        data.normalizedName = normalizeName(cleaned)!;
      } else {
        data[field] = field === "email" ? (cleaned?.toLowerCase() ?? null) : cleaned;
        if (field === "phone") data.normalizedPhone = normalizePhone(cleaned);
        if (field === "website") data.normalizedWebsite = normalizeWebsite(cleaned);
        if (field === "address") data.normalizedAddress = normalizeAddress(cleaned);
      }
    }
    if (Object.keys(data).length === 0) return this.get(id);

    const updated = await this.repos.leads.edit(id, data);
    if (!updated) throw Errors.notFound("Lead not found");
    this.bus.publish({ type: "lead.updated", leadId: id });
    return toLeadView(updated);
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repos.leads.delete(id))) throw Errors.notFound("Lead not found");
    this.bus.publish({ type: "lead.deleted", leadId: id });
  }
}
