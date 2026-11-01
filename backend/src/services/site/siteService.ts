import type { PrismaClient } from "../../database/client.js";
import { Errors } from "../../utils/errors.js";

// The public website's editable details (brand, contact info) and the contact form's messages.

const SITE_ID = "site";

export interface SiteSettingsInput {
  brandName?: string;
  tagline?: string;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  address?: string;
  linkedinUrl?: string;
  youtubeUrl?: string;
  xUrl?: string;
}

export interface ContactInput {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  message: string;
}

export class SiteService {
  constructor(private readonly db: PrismaClient) {}

  async settings() {
    return (await this.db.siteSettings.findUnique({ where: { id: SITE_ID } })) ?? this.db.siteSettings.upsert({ where: { id: SITE_ID }, create: { id: SITE_ID }, update: {} });
  }

  async updateSettings(input: SiteSettingsInput) {
    return this.db.siteSettings.upsert({ where: { id: SITE_ID }, create: { id: SITE_ID, ...input }, update: input });
  }

  async createMessage(input: ContactInput) {
    return this.db.contactMessage.create({
      data: { name: input.name, email: input.email.toLowerCase(), phone: input.phone || null, company: input.company || null, message: input.message },
    });
  }

  async messages(query: { status?: "new" | "read"; createdFrom?: Date; createdUntil?: Date; skip: number; take: number }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.createdFrom || query.createdUntil
        ? { createdAt: { ...(query.createdFrom ? { gte: query.createdFrom } : {}), ...(query.createdUntil ? { lt: query.createdUntil } : {}) } }
        : {}),
    };
    const [items, total, unread] = await Promise.all([
      this.db.contactMessage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: query.skip, take: query.take }),
      this.db.contactMessage.count({ where }),
      this.db.contactMessage.count({ where: { status: "new" } }),
    ]);
    return { items, total, unread };
  }

  async setStatus(id: string, status: "new" | "read") {
    const { count } = await this.db.contactMessage.updateMany({ where: { id }, data: { status } });
    if (!count) throw Errors.notFound("Message not found");
  }

  async deleteMessage(id: string) {
    const { count } = await this.db.contactMessage.deleteMany({ where: { id } });
    if (!count) throw Errors.notFound("Message not found");
  }
}
