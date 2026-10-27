// Instagram profiles, Facebook Pages, groups and profiles saved by the Meta Helper extension from
// keyword searches the user runs. Public details only (what the search result or profile shows);
// group member lists are never collected.

import { once } from "node:events";
import type { Writable } from "node:stream";
import { normalizeFacebookUrl, normalizeInstagramUrl } from "@platform/shared";
import type { DbClient } from "../../database/client.js";
import { containsInsensitive } from "../../database/client.js";
import type { Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { csvRow, UTF8_BOM } from "../export/csv.js";

export type SocialPlatformName = "instagram" | "facebook";
export type SocialKind = "profile" | "page" | "group";

export interface SocialLeadInput {
  platform: SocialPlatformName;
  kind: SocialKind;
  url: string;
  handle?: string | null;
  name: string;
  bio?: string | null;
  category?: string | null;
  followers?: number | null;
  audienceText?: string | null;
  privacy?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  location?: string | null;
  keyword?: string | null;
  tag?: string | null;
}

export interface SocialLeadFilters {
  platform?: SocialPlatformName;
  kind?: SocialKind;
  q?: string;
  keyword?: string;
  tag?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
}

const clean = (v: string | null | undefined, max: number) => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

export function canonicalSocialUrl(platform: SocialPlatformName, url: string): string | null {
  return platform === "instagram" ? normalizeInstagramUrl(url) : normalizeFacebookUrl(url);
}

function where(f: SocialLeadFilters) {
  return {
    ...(f.platform ? { platform: f.platform } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.keyword ? { keyword: f.keyword } : {}),
    ...(f.tag ? { tag: f.tag } : {}),
    ...(f.hasEmail !== undefined ? { email: f.hasEmail ? { not: null } : null } : {}),
    ...(f.hasPhone !== undefined ? { phone: f.hasPhone ? { not: null } : null } : {}),
    ...(f.q
      ? { OR: [{ name: containsInsensitive(f.q) }, { handle: containsInsensitive(f.q) }, { bio: containsInsensitive(f.q) }, { category: containsInsensitive(f.q) }, { location: containsInsensitive(f.q) }] }
      : {}),
  };
}

export class SocialLeadService {
  constructor(
    private readonly db: DbClient,
    private readonly repos: Repositories,
  ) {}

  /** Saves new ones and fills empty fields of ones already saved (by canonical link). */
  async saveMany(inputs: SocialLeadInput[]) {
    let created = 0;
    let updated = 0;
    const skipped: { url: string; reason: string }[] = [];
    for (const input of inputs) {
      const url = canonicalSocialUrl(input.platform, input.url);
      const name = clean(input.name, 300);
      if (!url) {
        skipped.push({ url: input.url, reason: input.platform === "instagram" ? "Not an Instagram profile link" : "Not a Facebook link" });
        continue;
      }
      if (!name) {
        skipped.push({ url, reason: "No name" });
        continue;
      }
      const data = {
        platform: input.platform,
        kind: input.kind,
        handle: clean(input.handle, 100),
        name,
        bio: clean(input.bio, 2000),
        category: clean(input.category, 200),
        followers: input.followers ?? null,
        audienceText: clean(input.audienceText, 100),
        privacy: clean(input.privacy, 30),
        email: clean(input.email, 254)?.toLowerCase() ?? null,
        phone: clean(input.phone, 50),
        website: clean(input.website, 2000),
        location: clean(input.location, 300),
        keyword: clean(input.keyword, 100),
        tag: clean(input.tag, 100),
      };
      const existing = await this.db.socialLead.findUnique({ where: { url } });
      if (existing) {
        // Newer non-empty values replace older ones; empty ones never erase.
        const patch = Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== null && v !== undefined && v !== (existing as Record<string, unknown>)[k]));
        if (Object.keys(patch).length) await this.db.socialLead.update({ where: { url }, data: patch });
        updated++;
      } else {
        await this.db.socialLead.create({ data: { ...data, url } });
        created++;
      }
    }
    if (created || updated) {
      await this.repos.agentLogs.create({ jobId: null, action: "social_leads_saved", status: "success", message: `${created} new, ${updated} updated${skipped.length ? `, ${skipped.length} skipped` : ""}` });
    }
    return { created, updated, skipped };
  }

  /** Which of these links are already saved (for "Saved" marks in the extension). */
  async check(platform: SocialPlatformName, urls: string[]) {
    const canon = urls.map((u) => canonicalSocialUrl(platform, u)).filter((u): u is string => !!u);
    const rows = canon.length ? await this.db.socialLead.findMany({ where: { url: { in: canon } }, select: { url: true, id: true } }) : [];
    return Object.fromEntries(rows.map((r) => [r.url, r.id]));
  }

  async list(f: SocialLeadFilters & { skip: number; take: number }) {
    const w = where(f);
    const [items, total] = await Promise.all([
      this.db.socialLead.findMany({ where: w, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: f.skip, take: f.take }),
      this.db.socialLead.count({ where: w }),
    ]);
    return { items, total };
  }

  async facets() {
    const [total, byKind, keywords, tags] = await Promise.all([
      this.db.socialLead.count(),
      this.db.socialLead.groupBy({ by: ["platform", "kind"], _count: { _all: true } }),
      this.db.socialLead.groupBy({ by: ["keyword"], where: { keyword: { not: null } }, _count: { _all: true } }),
      this.db.socialLead.groupBy({ by: ["tag"], where: { tag: { not: null } }, _count: { _all: true } }),
    ]);
    const top = (rows: { _count: { _all: number } }[], key: string) =>
      rows
        .map((r) => ({ value: (r as unknown as Record<string, string>)[key]!, count: r._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);
    return { total, kinds: byKind.map((r) => ({ platform: r.platform, kind: r.kind, count: r._count._all })), keywords: top(keywords, "keyword"), tags: top(tags, "tag") };
  }

  async deleteMany(ids: string[]) {
    const { count } = await this.db.socialLead.deleteMany({ where: { id: { in: [...new Set(ids)] } } });
    return count;
  }

  /**
   * Instagram profiles → contacts (with their Instagram URL) so an Instagram campaign can
   * message them. Existing contacts with the same Instagram URL are kept, not copied.
   */
  async toContacts(ids: string[], listName: string | null) {
    const leads = await this.db.socialLead.findMany({ where: { id: { in: [...new Set(ids)] }, platform: "instagram", kind: "profile" } });
    if (leads.length === 0) throw Errors.badRequest("Select Instagram profiles to add as contacts");
    const existing = new Set((await this.repos.contacts.findByInstagramUrls(leads.map((l) => l.url))).map((c) => c.instagramUrl));
    let added = 0;
    for (const l of leads) {
      if (existing.has(l.url)) continue;
      await this.repos.contacts.create({
        name: l.name,
        linkedinUrl: null,
        instagramUrl: l.url,
        email: l.email,
        phone: l.phone,
        designation: l.category,
        company: null,
        listName: listName ?? l.keyword ?? null,
        source: "instagram",
      });
      added++;
    }
    return { added, alreadyContacts: leads.length - added };
  }

  async writeCsv(f: SocialLeadFilters, out: Writable) {
    const header = ["Platform", "Type", "Name", "Username", "Link", "Category", "Followers / members", "Privacy", "Email", "Phone", "Website", "Location", "Bio", "Keyword", "Tag", "Saved at"];
    const write = async (chunk: string) => {
      if (!out.write(chunk)) await once(out, "drain");
    };
    await write(UTF8_BOM + csvRow(header));
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.db.socialLead.findMany({ where: where(f), orderBy: { id: "asc" }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      for (const r of rows) {
        await write(
          csvRow([r.platform, r.kind, r.name, r.handle, r.url, r.category, r.audienceText ?? r.followers, r.privacy, r.email, r.phone, r.website, r.location, r.bio, r.keyword, r.tag, r.createdAt.toISOString()]),
        );
      }
      if (rows.length < 500) break;
      cursor = rows.at(-1)!.id;
    }
  }
}
