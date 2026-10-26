import { containsInsensitive, type DbClient } from "../../client.js";
import type {
  LeadCreateData,
  LeadEditData,
  LeadFacets,
  LeadFillableData,
  LeadListQuery,
  LeadRepository,
  LeadSortField,
} from "../types.js";

// Prisma only accepts `nulls: "last"` on optional columns.
const NULLABLE_SORT_FIELDS: ReadonlySet<LeadSortField> = new Set(["city", "category", "rating", "reviewCount"]);

// Oldest first, so a duplicate always resolves to the original record.
const OLDEST_FIRST = [{ createdAt: "asc" as const }, { id: "asc" as const }];

export class PrismaLeadRepository implements LeadRepository {
  constructor(private readonly db: DbClient) {}

  async list(query: LeadListQuery) {
    const q = query.q?.trim();
    const present = (has: boolean | undefined, field: "phone" | "email" | "website") =>
      has === undefined ? [] : [has ? { AND: [{ [field]: { not: null } }, { [field]: { not: "" } }] } : { OR: [{ [field]: null }, { [field]: "" }] }];
    const createdAt = {
      ...(query.createdFrom ? { gte: query.createdFrom } : {}),
      // The earlier of the date filter and the export snapshot.
      ...(query.createdUntil || query.createdBefore
        ? { lt: [query.createdUntil, query.createdBefore].filter((d): d is Date => !!d).reduce((a, b) => (a < b ? a : b)) }
        : {}),
    };
    const where = {
      ...(query.city ? { city: query.city } : {}),
      ...(query.state ? { state: query.state } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.searchKeyword ? { searchKeyword: query.searchKeyword } : {}),
      ...(query.minRating !== undefined ? { rating: { gte: query.minRating } } : {}),
      ...(query.minReviews !== undefined ? { reviewCount: { gte: query.minReviews } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      AND: [...present(query.hasPhone, "phone"), ...present(query.hasEmail, "email"), ...present(query.hasWebsite, "website")],
      ...(q
        ? {
            OR: [
              { name: containsInsensitive(q) },
              { phone: { contains: q } },
              { website: containsInsensitive(q) },
              { address: containsInsensitive(q) },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.lead.findMany({
        where,
        // Empty values sort last; id as tie-breaker keeps pagination stable when values are equal.
        orderBy: [
          { [query.sort]: NULLABLE_SORT_FIELDS.has(query.sort) ? { sort: query.order, nulls: "last" } : query.order },
          { id: "asc" },
        ],
        skip: query.skip,
        take: query.take,
      }),
      this.db.lead.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string) {
    return this.db.lead.findUnique({ where: { id } });
  }

  findByIds(ids: string[]) {
    return this.db.lead.findMany({ where: { id: { in: ids } }, orderBy: OLDEST_FIRST });
  }

  async delete(id: string) {
    const { count } = await this.db.lead.deleteMany({ where: { id } });
    return count > 0;
  }

  count() {
    return this.db.lead.count();
  }

  countCreatedSince(since: Date) {
    return this.db.lead.count({ where: { createdAt: { gte: since } } });
  }

  findByPlaceId(placeId: string) {
    return this.db.lead.findUnique({ where: { placeId } });
  }

  findByNormalizedPhone(phone: string) {
    return this.db.lead.findMany({ where: { normalizedPhone: phone }, orderBy: OLDEST_FIRST });
  }

  findByNormalizedWebsite(website: string) {
    return this.db.lead.findMany({ where: { normalizedWebsite: website }, orderBy: OLDEST_FIRST });
  }

  findByNameAddress(normalizedName: string, normalizedAddress: string) {
    return this.db.lead.findMany({ where: { normalizedName, normalizedAddress }, orderBy: OLDEST_FIRST });
  }

  create(data: LeadCreateData) {
    return this.db.lead.create({ data });
  }

  update(id: string, data: LeadFillableData & { lastSeenAt: Date }) {
    return this.db.lead.update({ where: { id }, data });
  }

  async edit(id: string, data: LeadEditData) {
    const { count } = await this.db.lead.updateMany({ where: { id }, data });
    return count ? this.findById(id) : null;
  }

  async facets(limit: number): Promise<LeadFacets> {
    const group = async (field: "city" | "state" | "category" | "searchKeyword") => {
      const rows = await this.db.lead.groupBy({
        by: [field],
        where: { [field]: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { [field]: "desc" } },
        take: limit,
      });
      return rows.map((r) => ({ value: r[field] as string, count: r._count._all }));
    };
    const [cities, states, categories, keywords] = await Promise.all([group("city"), group("state"), group("category"), group("searchKeyword")]);
    return { cities, states, categories, keywords };
  }
}
