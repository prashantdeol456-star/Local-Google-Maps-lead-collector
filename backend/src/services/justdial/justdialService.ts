// Leads collected from Justdial by the Maps Data Collector extension. Each one is a normal Lead
// (source "justdial", so dedupe, credits, export and campaigns work as for Google Maps) plus a
// JustdialDetail row with what only Justdial has and the Google Maps match for the same business.
//
// A background worker then (1) looks for a public email on each business's own website and
// (2) when a collection is finished and the user asked for it, puts its new leads into an email
// campaign with the chosen template and starts it.

import { once } from "node:events";
import type { Writable } from "node:stream";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { csvRow, UTF8_BOM } from "../export/csv.js";
import { containsInsensitive } from "../../database/client.js";
import { ownerScope } from "../../database/ownerScope.js";
import { Errors } from "../../utils/errors.js";
import type { CampaignService } from "../email/campaignService.js";
import { findWebsiteEmail } from "./websiteEmail.js";

export interface JustdialDetailInput {
  docid: string;
  jdUrl?: string | null;
  jdPhone?: string | null;
  jdRating?: number | null;
  jdReviewCount?: number | null;
  categories?: string | null;
  area?: string | null;
  established?: string | null;
  hours?: string | null;
  photos?: string[] | null;
  mapsMatched?: boolean;
  mapsName?: string | null;
  mapsPhone?: string | null;
  mapsWebsite?: string | null;
  mapsRating?: number | null;
  mapsReviewCount?: number | null;
  mapsUrl?: string | null;
}

export interface JustdialListQuery {
  q?: string;
  keyword?: string;
  has?: "phone" | "email" | "website" | "maps";
  skip: number;
  take: number;
}

const MAX_PHOTOS = 30;
/** Websites checked per worker run (each takes up to a few seconds). */
const EMAILS_PER_RUN = 5;

export class JustdialService {
  constructor(
    private readonly db: PrismaClient,
    private readonly opts: { campaigns?: CampaignService; findEmail?: typeof findWebsiteEmail; log?: (msg: string) => void } = {},
  ) {}

  /** Stores (or refreshes) the Justdial details of a lead the current user just saved. */
  async saveDetail(leadId: string, d: JustdialDetailInput) {
    const photos = d.photos ? JSON.stringify(d.photos.filter((p) => /^https:\/\//.test(p)).slice(0, MAX_PHOTOS)) : null;
    const data = {
      docid: d.docid,
      jdUrl: d.jdUrl ?? null,
      jdPhone: d.jdPhone ?? null,
      jdRating: d.jdRating ?? null,
      jdReviewCount: d.jdReviewCount ?? null,
      categories: d.categories ?? null,
      area: d.area ?? null,
      established: d.established ?? null,
      hours: d.hours ?? null,
      photos,
      mapsMatched: !!d.mapsMatched,
      mapsName: d.mapsName ?? null,
      mapsPhone: d.mapsPhone ?? null,
      mapsWebsite: d.mapsWebsite ?? null,
      mapsRating: d.mapsRating ?? null,
      mapsReviewCount: d.mapsReviewCount ?? null,
      mapsUrl: d.mapsUrl ?? null,
    };
    const existing = await this.db.justdialDetail.findUnique({ where: { leadId } });
    if (existing) return this.db.justdialDetail.update({ where: { leadId }, data });
    return this.db.justdialDetail.create({ data: { leadId, ...data } });
  }

  /** "Send these leads to an email campaign" choice for a collection (null template = no). */
  async setAutoCampaign(jobId: string, templateId: string | null) {
    const job = await this.db.collectionJob.findUnique({ where: { id: jobId } });
    if (!job) throw Errors.notFound("Collection not found");
    if (templateId) {
      const template = await this.db.messageTemplate.findUnique({ where: { id: templateId } });
      if (!template || template.channel !== "email") throw Errors.badRequest("Email template not found");
    }
    const existing = await this.db.justdialJob.findUnique({ where: { jobId } });
    if (existing) return this.db.justdialJob.update({ where: { jobId }, data: { templateId } });
    return this.db.justdialJob.create({ data: { jobId, templateId } });
  }

  /** Leads from Justdial: collected there, or already known from Google Maps and found again on Justdial. */
  private where(query: Omit<JustdialListQuery, "skip" | "take">): Prisma.LeadWhereInput {
    const and: Prisma.LeadWhereInput[] = [{ OR: [{ source: "justdial" }, { justdial: { isNot: null } }] }];
    if (query.q) {
      const q = containsInsensitive(query.q);
      and.push({ OR: [{ name: q }, { phone: q }, { email: q }, { address: q }, { justdial: { categories: q } }] });
    }
    if (query.keyword) and.push({ searchKeyword: query.keyword });
    if (query.has === "phone") and.push({ phone: { not: null } });
    if (query.has === "email") and.push({ email: { not: null } });
    if (query.has === "website") and.push({ website: { not: null } });
    if (query.has === "maps") and.push({ justdial: { mapsMatched: true } });
    return { AND: and };
  }

  async list(query: JustdialListQuery) {
    const where = this.where(query);
    const [rows, total] = await Promise.all([
      this.db.lead.findMany({ where, include: { justdial: true }, orderBy: { createdAt: "desc" }, skip: query.skip, take: query.take }),
      this.db.lead.count({ where }),
    ]);
    const items = rows.map(({ justdial, ...lead }) => ({
      ...lead,
      justdial: justdial && { ...justdial, photos: justdial.photos ? (JSON.parse(justdial.photos) as string[]) : [] },
    }));
    return { items, total };
  }

  async writeCsv(query: Omit<JustdialListQuery, "skip" | "take">, out: Writable) {
    const header = [
      "Name", "Phone", "Email", "Website", "Address", "City", "State", "Pincode", "Categories", "Area", "Year established", "Timings",
      "Justdial rating", "Justdial ratings", "Justdial number", "Justdial link", "Google Maps name", "Google Maps phone", "Google Maps rating",
      "Google Maps reviews", "Google Maps link", "Photos", "Keyword", "Added",
    ];
    const write = async (chunk: string) => {
      if (!out.write(chunk)) await once(out, "drain");
    };
    await write(UTF8_BOM + csvRow(header));
    const where = this.where(query);
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.db.lead.findMany({ where, include: { justdial: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      for (const r of rows) {
        const d = r.justdial;
        const photos = d?.photos ? (JSON.parse(d.photos) as string[]).join(" ") : "";
        await write(
          csvRow([
            r.name, r.phone, r.email, r.website, r.address, r.city, r.state, r.postalCode, d?.categories, d?.area, d?.established, d?.hours,
            d?.jdRating, d?.jdReviewCount, d?.jdPhone, d?.jdUrl, d?.mapsName, d?.mapsPhone, d?.mapsRating, d?.mapsReviewCount, d?.mapsUrl, photos,
            r.searchKeyword, r.createdAt.toISOString(),
          ]),
        );
      }
      if (rows.length < 500) break;
      cursor = rows.at(-1)!.id;
    }
  }

  async facets() {
    const [keywords, totals] = await Promise.all([
      this.db.lead.groupBy({ by: ["searchKeyword"], where: this.where({}), _count: { _all: true }, orderBy: { _count: { searchKeyword: "desc" } }, take: 100 }),
      Promise.all([
        this.db.lead.count({ where: this.where({}) }),
        this.db.lead.count({ where: this.where({ has: "phone" }) }),
        this.db.lead.count({ where: this.where({ has: "email" }) }),
        this.db.lead.count({ where: this.where({ has: "maps" }) }),
      ]),
    ]);
    const [total, withPhone, withEmail, withMaps] = totals;
    return {
      keywords: keywords.filter((k) => k.searchKeyword).map((k) => ({ value: k.searchKeyword!, count: k._count._all })),
      total,
      withPhone,
      withEmail,
      withMaps,
    };
  }

  // ---- Background work (no owner scope: sees every user's rows) ----

  /** Looks for public emails on the websites of a few leads that have none yet. */
  async findEmails(limit = EMAILS_PER_RUN): Promise<number> {
    // Leads without any website: nothing to check.
    await this.db.justdialDetail.updateMany({
      where: { emailCheckedAt: null, mapsWebsite: null, lead: { OR: [{ website: null }, { email: { not: null } }] } },
      data: { emailCheckedAt: new Date() },
    });
    const todo = await this.db.justdialDetail.findMany({
      where: { emailCheckedAt: null },
      include: { lead: { select: { id: true, email: true, website: true } } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    let found = 0;
    for (const d of todo) {
      const website = d.lead.website ?? d.mapsWebsite;
      let email: string | null = null;
      if (!d.lead.email && website) {
        email = await (this.opts.findEmail ?? findWebsiteEmail)(website).catch(() => null);
      }
      await this.db.justdialDetail.update({ where: { id: d.id }, data: { emailCheckedAt: new Date() } });
      if (email && email.length <= 254) {
        await this.db.lead.update({ where: { id: d.lead.id }, data: { email } });
        found++;
      }
    }
    return found;
  }

  /** Makes the email campaign of every finished collection that asked for one. */
  async makeCampaigns(): Promise<number> {
    const campaigns = this.opts.campaigns;
    if (!campaigns) return 0;
    const pending = await this.db.justdialJob.findMany({ where: { templateId: { not: null }, campaignId: null, note: null }, take: 10 });
    let made = 0;
    for (const jj of pending) {
      const job = await this.db.collectionJob.findUnique({ where: { id: jj.jobId } });
      if (!job) {
        await this.db.justdialJob.update({ where: { id: jj.id }, data: { note: "Collection was deleted" } });
        continue;
      }
      if (!["completed", "stopped"].includes(job.status)) continue;
      const items = await this.db.jobItem.findMany({ where: { jobId: job.id, result: "new", leadId: { not: null } }, select: { leadId: true } });
      const leadIds = items.map((i) => i.leadId!);
      // Wait until every lead's website has been checked for an email.
      const unchecked = await this.db.justdialDetail.count({ where: { leadId: { in: leadIds }, emailCheckedAt: null } });
      if (unchecked > 0) continue;

      const owner = job.ownerId;
      const run = <T>(fn: () => Promise<T>) => (owner ? ownerScope.run({ userId: owner, ownerId: owner, customer: true }, fn) : fn());
      const name = `Justdial: ${job.searchKeyword}${job.location ? ` in ${job.location}` : ""} (${job.createdAt.toISOString().slice(0, 10)})`;
      try {
        if (leadIds.length === 0) throw Errors.badRequest("No new leads in this collection");
        const { campaign, summary } = await run(() =>
          campaigns.create(
            { name, templateId: jj.templateId!, recipients: { leadIds }, intervalSec: 180, dailyLimit: 50, windowStart: "10:00", windowEnd: "18:00" },
            owner,
          ),
        );
        let note: string | null = null;
        try {
          await run(() => campaigns.start(campaign.id));
        } catch (err) {
          note = `Campaign made but not started: ${err instanceof Error ? err.message : String(err)}`;
        }
        await this.db.justdialJob.update({ where: { id: jj.id }, data: { campaignId: campaign.id, note } });
        this.opts.log?.(`justdial: campaign "${name}" with ${summary.eligible} emails${note ? ` (${note})` : ""}`);
        made++;
      } catch (err) {
        await this.db.justdialJob.update({ where: { id: jj.id }, data: { note: `No campaign: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500) } });
      }
    }
    return made;
  }
}

export class JustdialWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private readonly service: JustdialService,
    private readonly opts: { log?: (msg: string) => void } = {},
  ) {}

  async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.service.findEmails();
      await this.service.makeCampaigns();
    } catch (err) {
      this.opts.log?.(`justdial worker: ${String(err)}`);
    } finally {
      this.busy = false;
    }
  }

  start(everyMs = 30_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.run(), everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
