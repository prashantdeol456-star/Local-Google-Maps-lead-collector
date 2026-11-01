import { containsInsensitive, type DbClient } from "../../client.js";
import type { LinkedInLeadData, LinkedInLeadFilters, LinkedInLeadRepository } from "../types.js";

const FACET_LIMIT = 30;

function where(f: LinkedInLeadFilters) {
  return {
    ...(f.q
      ? {
          OR: [
            { name: containsInsensitive(f.q) },
            { headline: containsInsensitive(f.q) },
            { company: containsInsensitive(f.q) },
            { location: containsInsensitive(f.q) },
            { emails: containsInsensitive(f.q) },
            { phones: containsInsensitive(f.q) },
            { experience: containsInsensitive(f.q) },
            { education: containsInsensitive(f.q) },
            { profileUrl: containsInsensitive(f.q) },
          ],
        }
      : {}),
    ...(f.company ? { company: containsInsensitive(f.company) } : {}),
    ...(f.tag ? { tag: f.tag } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.hasEmail !== undefined ? { hasEmail: f.hasEmail } : {}),
    ...(f.hasPhone !== undefined ? { hasPhone: f.hasPhone } : {}),
    // websites is a JSON array; "[]" means none
    ...(f.hasWebsite !== undefined ? { websites: f.hasWebsite ? { not: "[]" } : "[]" } : {}),
    ...(f.createdFrom || f.createdUntil ? { createdAt: { ...(f.createdFrom ? { gte: f.createdFrom } : {}), ...(f.createdUntil ? { lt: f.createdUntil } : {}) } } : {}),
  };
}

function counts(rows: { _count: { _all: number } }[], key: (r: never) => string | null) {
  return rows
    .map((r) => ({ value: key(r as never), count: r._count._all }))
    .filter((r): r is { value: string; count: number } => !!r.value)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, FACET_LIMIT);
}

export class PrismaLinkedInRepository implements LinkedInLeadRepository {
  constructor(private readonly db: DbClient) {}

  findById(id: string) {
    return this.db.linkedInLead.findUnique({ where: { id } });
  }
  findByProfileUrls(urls: string[]) {
    if (urls.length === 0) return Promise.resolve([]);
    return this.db.linkedInLead.findMany({ where: { profileUrl: { in: urls } } });
  }
  create(data: LinkedInLeadData) {
    return this.db.linkedInLead.create({ data });
  }
  update(id: string, data: Partial<LinkedInLeadData>) {
    return this.db.linkedInLead.update({ where: { id }, data });
  }
  async delete(id: string) {
    const { count } = await this.db.linkedInLead.deleteMany({ where: { id } });
    return count > 0;
  }
  async list(f: LinkedInLeadFilters & { skip: number; take: number }) {
    const w = where(f);
    const [items, total] = await Promise.all([
      this.db.linkedInLead.findMany({ where: w, orderBy: [{ [f.sort ?? "createdAt"]: f.order ?? "desc" }, { id: "asc" }], skip: f.skip, take: f.take }),
      this.db.linkedInLead.count({ where: w }),
    ]);
    return { items, total };
  }
  listBatch(f: LinkedInLeadFilters, cursor: string | null, take: number) {
    return this.db.linkedInLead.findMany({
      where: { ...where(f), ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take,
    });
  }
  async facets() {
    const [total, withEmail, withPhone, withWebsite, tags, companies, sources] = await Promise.all([
      this.db.linkedInLead.count(),
      this.db.linkedInLead.count({ where: { hasEmail: true } }),
      this.db.linkedInLead.count({ where: { hasPhone: true } }),
      this.db.linkedInLead.count({ where: { websites: { not: "[]" } } }),
      this.db.linkedInLead.groupBy({ by: ["tag"], _count: { _all: true } }),
      this.db.linkedInLead.groupBy({ by: ["company"], _count: { _all: true } }),
      this.db.linkedInLead.groupBy({ by: ["source"], _count: { _all: true } }),
    ]);
    return {
      total,
      withEmail,
      withPhone,
      withWebsite,
      tags: counts(tags, (r: { tag: string | null }) => r.tag),
      companies: counts(companies, (r: { company: string | null }) => r.company),
      sources: counts(sources, (r: { source: string }) => r.source),
    };
  }
}
