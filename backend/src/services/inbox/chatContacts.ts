// All messages → one person across apps: a chat (WhatsApp Chat or AI Inbox) is linked to a
// Contacts record (OutreachContact). A chat links by itself when exactly one contact has the same
// phone (WhatsApp), Instagram username or LinkedIn profile; otherwise you pick or create the
// contact. The contact's other chats are then one click away. Labels and notes for AI Inbox chats
// (WhatsApp chats keep theirs in WhatsApp Chat).

import type { OutreachContact, PrismaClient } from "../../generated/prisma/client.js";
import { containsInsensitive } from "../../database/client.js";
import { Errors } from "../../utils/errors.js";

export type ChatSource = "whatsapp" | "inbox";

export interface LinkedChat {
  source: ChatSource;
  id: string;
  platform: string;
  name: string;
  lastMessageAt: Date;
}

const MAX_LABELS = 10;
const last10 = (phone: string | null | undefined) => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};
const igUrl = (username: string) => `https://www.instagram.com/${username.replace(/^@/, "").toLowerCase()}/`;
const liUrl = (url: string | null) => {
  const m = url ? /linkedin\.com\/in\/([^/?#]+)/i.exec(url) : null;
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]!).toLowerCase()}` : null;
};

const contactView = (c: OutreachContact) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, company: c.company, designation: c.designation, linkedinUrl: c.linkedinUrl, instagramUrl: c.instagramUrl });

function parseLabels(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export class ChatContactsService {
  constructor(private readonly db: PrismaClient) {}

  private async chat(source: ChatSource, id: string) {
    if (source === "whatsapp") {
      const c = await this.db.waChat.findUnique({ where: { id } });
      if (!c) throw Errors.notFound("Chat not found");
      return { source, id: c.id, ownerId: c.ownerId, platform: "whatsapp", name: c.customName ?? c.profileName ?? `+${c.phone}`, contactId: c.contactId, phone: `+${c.phone}`, username: null as string | null, profile: null as string | null };
    }
    const c = await this.db.inboxConversation.findUnique({ where: { id } });
    if (!c) throw Errors.notFound("Chat not found");
    return {
      source,
      id: c.id,
      ownerId: c.ownerId,
      platform: c.platform,
      name: c.participantName,
      contactId: c.contactId,
      phone: null as string | null,
      username: c.platform === "instagram" ? c.participantUsername : null,
      profile: c.platform === "linkedin" ? liUrl(c.participantId) : null,
    };
  }

  private async setContact(source: ChatSource, id: string, contactId: string | null) {
    if (source === "whatsapp") await this.db.waChat.update({ where: { id }, data: { contactId } });
    else await this.db.inboxConversation.update({ where: { id }, data: { contactId } });
  }

  /** Contacts that are surely this person (same phone, Instagram or LinkedIn profile). */
  private async strongMatches(chat: Awaited<ReturnType<ChatContactsService["chat"]>>): Promise<OutreachContact[]> {
    if (chat.phone) {
      const tail = last10(chat.phone);
      if (!tail) return [];
      // Phones are stored as typed ("+91 98000 00001"): narrow down by the last 4 digits, then compare all 10.
      const rows = await this.db.outreachContact.findMany({ where: { phone: { contains: tail.slice(-4) } }, take: 200 });
      return rows.filter((c) => last10(c.phone) === tail);
    }
    if (chat.username) return this.db.outreachContact.findMany({ where: { instagramUrl: igUrl(chat.username) }, take: 5 });
    if (chat.profile) return this.db.outreachContact.findMany({ where: { linkedinUrl: chat.profile }, take: 5 });
    return [];
  }

  /** Every chat (any app) linked to this contact. */
  async chatsOf(contactId: string): Promise<LinkedChat[]> {
    const [wa, inbox] = await Promise.all([
      this.db.waChat.findMany({ where: { contactId }, select: { id: true, phone: true, profileName: true, customName: true, lastMessageAt: true } }),
      this.db.inboxConversation.findMany({ where: { contactId }, select: { id: true, platform: true, participantName: true, lastMessageAt: true } }),
    ]);
    return [
      ...wa.map((c) => ({ source: "whatsapp" as const, id: c.id, platform: "whatsapp", name: c.customName ?? c.profileName ?? `+${c.phone}`, lastMessageAt: c.lastMessageAt })),
      ...inbox.map((c) => ({ source: "inbox" as const, id: c.id, platform: c.platform, name: c.participantName, lastMessageAt: c.lastMessageAt })),
    ].sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }

  /** The chat's contact (linking it by itself when there is exactly one sure match), its other chats, and suggestions. */
  async contactFor(source: ChatSource, id: string) {
    const chat = await this.chat(source, id);
    let contact = chat.contactId ? await this.db.outreachContact.findUnique({ where: { id: chat.contactId } }) : null;
    if (chat.contactId && !contact) await this.setContact(source, id, null); // the contact was deleted
    let suggestions: OutreachContact[] = [];
    if (!contact) {
      const strong = await this.strongMatches(chat);
      if (strong.length === 1) {
        contact = strong[0]!;
        await this.setContact(source, id, contact.id);
      } else {
        suggestions = strong.length ? strong : await this.db.outreachContact.findMany({ where: { name: containsInsensitive(chat.name) }, take: 5 });
      }
    }
    return {
      contact: contact ? contactView(contact) : null,
      chats: contact ? (await this.chatsOf(contact.id)).filter((c) => !(c.source === source && c.id === id)) : [],
      suggestions: suggestions.map(contactView),
    };
  }

  async link(source: ChatSource, id: string, contactId: string) {
    await this.chat(source, id);
    const contact = await this.db.outreachContact.findUnique({ where: { id: contactId } });
    if (!contact) throw Errors.notFound("Contact not found");
    await this.setContact(source, id, contact.id);
    return this.contactFor(source, id);
  }

  /** A new contact from the chat (its phone, Instagram or LinkedIn link filled in), linked to it. */
  async createAndLink(source: ChatSource, id: string, input: { name: string; phone?: string | null; email?: string | null; company?: string | null }) {
    const chat = await this.chat(source, id);
    const instagramUrl = chat.username ? igUrl(chat.username) : null;
    const linkedinUrl = chat.profile;
    // The Contacts sheet keys people by LinkedIn / Instagram link: reuse that record if it exists.
    const existing =
      (instagramUrl && (await this.db.outreachContact.findFirst({ where: { instagramUrl } }))) || (linkedinUrl && (await this.db.outreachContact.findFirst({ where: { linkedinUrl } }))) || null;
    const contact =
      existing ??
      (await this.db.outreachContact.create({
        data: {
          ownerId: chat.ownerId,
          name: input.name.trim() || chat.name,
          phone: input.phone?.trim() || chat.phone,
          email: input.email?.trim().toLowerCase() || null,
          company: input.company?.trim() || null,
          instagramUrl,
          linkedinUrl,
          listName: "Chats",
          source: "admin",
        },
      }));
    await this.setContact(source, id, contact.id);
    return this.contactFor(source, id);
  }

  async unlink(source: ChatSource, id: string) {
    await this.chat(source, id);
    await this.setContact(source, id, null);
    return { contact: null, chats: [], suggestions: [] };
  }

  /** Contacts to link a chat to (search by name, phone, email or company). */
  async search(q: string) {
    const t = q.trim();
    const rows = await this.db.outreachContact.findMany({
      where: t ? { OR: [{ name: containsInsensitive(t) }, { phone: { contains: t.replace(/\D/g, "") || t } }, { email: containsInsensitive(t) }, { company: containsInsensitive(t) }] } : {},
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return rows.map(contactView);
  }

  // ---- Labels and notes of AI Inbox chats ----

  async updateInboxChat(id: string, patch: { labels?: string[]; notes?: string | null }) {
    const c = await this.db.inboxConversation.findUnique({ where: { id } });
    if (!c) throw Errors.notFound("Chat not found");
    const labels = patch.labels === undefined ? undefined : [...new Set(patch.labels.map((l) => l.trim()).filter(Boolean))].slice(0, MAX_LABELS);
    const row = await this.db.inboxConversation.update({
      where: { id },
      data: { ...(labels ? { labels: labels.length ? JSON.stringify(labels) : null } : {}), ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}) },
    });
    return { labels: parseLabels(row.labels), notes: row.notes };
  }

  /** Every label used on any chat (WhatsApp Chat and AI Inbox), for the filter. */
  async labels(): Promise<string[]> {
    const [wa, inbox] = await Promise.all([
      this.db.waChat.findMany({ where: { labels: { not: null } }, select: { labels: true } }),
      this.db.inboxConversation.findMany({ where: { labels: { not: null } }, select: { labels: true } }),
    ]);
    return [...new Set([...wa, ...inbox].flatMap((r) => parseLabels(r.labels)))].sort();
  }
}

export { parseLabels };
