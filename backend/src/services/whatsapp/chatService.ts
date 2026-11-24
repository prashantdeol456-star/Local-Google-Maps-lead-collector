// WhatsApp Chat: two-way chats through the user's own WhatsApp number (Meta Cloud API).
//
//   incoming: Meta webhook → handle() → WaChat / WaMessage saved → live event to the admin panel
//             (photos, documents and voice notes are downloaded and kept, WhatsApp's links expire)
//   ticks:    status webhooks (sent → delivered → read, or failed) update the message by its wamid
//   outgoing: free text or a file only within 24 hours of the person's last message (WhatsApp's
//             rule); otherwise, and for a new chat, an approved template
//   AI:       a draft of the next reply is written for every new message; it is sent only when
//             the user presses Send.

import type { PrismaClient } from "../../generated/prisma/client.js";
import { containsInsensitive } from "../../database/client.js";
import { ownerScope } from "../../database/ownerScope.js";
import type { Repositories } from "../../database/repositories/index.js";
import { toWhatsAppNumber, WhatsAppProviderError, type MediaKind, type WhatsAppEvent, type WhatsAppProvider } from "../../providers/whatsapp/index.js";
import { Errors } from "../../utils/errors.js";
import { leadTemplateData } from "../email/render.js";
import type { EventBus } from "../events.js";
import type { InboxRuntime } from "../inbox/runtime.js";
import { renderWhatsApp } from "./templateParams.js";

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const HISTORY_FOR_AI = 30;

const RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };

const PREVIEW: Record<string, string> = {
  image: "📷 Photo",
  document: "📄 Document",
  audio: "🎤 Voice message",
  video: "🎬 Video",
  sticker: "Sticker",
  location: "📍 Location",
  contacts: "👤 Contact",
};

export function mediaKindOf(mime: string): MediaKind {
  if (/^image\/(jpeg|png)$/.test(mime)) return "image";
  if (/^audio\//.test(mime)) return "audio";
  if (/^video\/(mp4|3gpp)$/.test(mime)) return "video";
  return "document";
}

/** Open for free-form messages until this time (null = closed: only templates). */
export function windowOpenUntil(lastInboundAt: Date | null, now = new Date()): Date | null {
  if (!lastInboundAt) return null;
  const until = new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS);
  return until > now ? until : null;
}

export interface ChatDeps {
  providerFor(ownerId: string | null): Promise<WhatsAppProvider | null>;
  repos: Repositories;
  bus?: EventBus;
  runtime?: InboxRuntime;
  timeZone: string;
  now?: () => Date;
  log?: (msg: string) => void;
}

export class WhatsAppChatService {
  constructor(
    private readonly db: PrismaClient,
    private readonly deps: ChatDeps,
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  /** Who is acting (request or webhook scope); null = platform-wide number. */
  private owner(): string | null {
    return ownerScope.getStore()?.userId ?? null;
  }

  private changed(chatId: string) {
    this.deps.bus?.publish({ type: "whatsapp.chat", chatId });
  }

  private async provider(ownerId: string | null): Promise<WhatsAppProvider> {
    const p = await this.deps.providerFor(ownerId);
    if (!p) throw Errors.conflict("SENDER_REQUIRED", "Connect your WhatsApp number on the My sender page first");
    return p;
  }

  // ---- Webhook ----

  /** Saves incoming messages and tick updates (called for every WhatsApp webhook, in its owner's scope). */
  async handle(events: WhatsAppEvent[]): Promise<void> {
    for (const e of events) {
      try {
        if (e.kind === "inbound") await this.receive(e);
        else if (e.kind === "status") await this.status(e);
      } catch (err) {
        this.deps.log?.(`whatsapp chat: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async findOrCreateChat(ownerId: string | null, phone: string, profileName: string | null) {
    const existing = await this.db.waChat.findFirst({ where: { ownerId, phone } });
    if (existing) return existing;
    const lead = (await this.deps.repos.leads.findByNormalizedPhone(`+${phone}`))[0] ?? null;
    return this.db.waChat.create({ data: { ownerId, phone, profileName, leadId: lead?.id ?? null } });
  }

  private async receive(e: Extract<WhatsAppEvent, { kind: "inbound" }>) {
    const ownerId = this.owner();
    if (await this.db.waMessage.findFirst({ where: { ownerId, wamid: e.providerEventId } })) return; // delivered twice
    const chat = await this.findOrCreateChat(ownerId, e.from, e.profileName);
    const type = e.messageType === "voice" ? "audio" : e.messageType === "button" || e.messageType === "interactive" ? "text" : e.messageType;
    const body = e.text ?? e.media?.caption ?? null;
    const message = await this.db.waMessage.create({
      data: {
        ownerId,
        chatId: chat.id,
        wamid: e.providerEventId,
        direction: "in",
        type,
        body,
        mediaMime: e.media?.mime ?? null,
        mediaName: e.media?.filename ?? null,
        status: "received",
        createdAt: e.occurredAt,
      },
    });
    const lastInboundAt = chat.lastInboundAt && chat.lastInboundAt > e.occurredAt ? chat.lastInboundAt : e.occurredAt;
    await this.db.waChat.update({
      where: { id: chat.id },
      data: {
        lastInboundAt,
        lastMessageAt: e.occurredAt > chat.lastMessageAt ? e.occurredAt : chat.lastMessageAt,
        lastMessageText: (body ?? PREVIEW[type] ?? `[${type}]`).slice(0, 200),
        unreadCount: { increment: 1 },
        profileName: e.profileName ?? chat.profileName,
        aiDraft: null,
        aiNote: null,
      },
    });
    this.changed(chat.id);

    // In the background: keep the file, and write an AI draft (the webhook answers Meta at once).
    if (e.media) void this.keepMedia(ownerId, message.id, e.media.id, e.media.mime, e.media.filename).catch(() => {});
    void this.draft(chat.id).catch(() => {});
  }

  private async keepMedia(ownerId: string | null, messageId: string, mediaId: string, mime: string | null, filename: string | null) {
    const provider = await this.deps.providerFor(ownerId);
    const file = await provider?.downloadMedia?.(mediaId, MAX_MEDIA_BYTES);
    if (!file) {
      await this.db.waMessage.update({ where: { id: messageId }, data: { error: "File not saved (larger than 5 MB or no longer available)" } });
      return;
    }
    const media = await this.db.waMedia.create({ data: { ownerId, mime: file.mime, name: filename, size: file.data.length, data: new Uint8Array(file.data) } });
    const msg = await this.db.waMessage.update({ where: { id: messageId }, data: { mediaId: media.id, mediaMime: file.mime, mediaSize: file.data.length } });
    this.changed(msg.chatId);
  }

  private async status(e: Extract<WhatsAppEvent, { kind: "status" }>) {
    const msg = await this.db.waMessage.findFirst({ where: { wamid: e.externalMessageId, direction: "out" } });
    if (!msg) return; // a campaign message, not a chat
    const forward = e.status === "failed" ? msg.status !== "read" : (RANK[e.status] ?? 0) > (RANK[msg.status] ?? -1);
    if (!forward) return;
    await this.db.waMessage.update({ where: { id: msg.id }, data: { status: e.status, ...(e.status === "failed" ? { error: e.error ?? "Not delivered" } : {}) } });
    this.changed(msg.chatId);
  }

  // ---- Reading ----

  async list(query: { q?: string; unread?: boolean }) {
    const q = query.q?.trim();
    const where = {
      ...(q ? { OR: [{ phone: { contains: q.replace(/\D/g, "") || q } }, { profileName: containsInsensitive(q) }, { customName: containsInsensitive(q) }] } : {}),
      ...(query.unread ? { unreadCount: { gt: 0 } } : {}),
    };
    const chats = await this.db.waChat.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 300 });
    const now = this.now();
    return chats.map((c) => this.view(c, now));
  }

  private view(c: { id: string; phone: string; profileName: string | null; customName: string | null; leadId: string | null; lastInboundAt: Date | null; lastMessageAt: Date; lastMessageText: string | null; unreadCount: number; aiDraft: string | null; aiNote: string | null }, now = this.now()) {
    return {
      id: c.id,
      phone: `+${c.phone}`,
      name: c.customName ?? c.profileName ?? `+${c.phone}`,
      profileName: c.profileName,
      customName: c.customName,
      leadId: c.leadId,
      lastMessageAt: c.lastMessageAt,
      lastMessageText: c.lastMessageText,
      unreadCount: c.unreadCount,
      windowOpenUntil: windowOpenUntil(c.lastInboundAt, now),
      aiDraft: c.aiDraft,
      aiNote: c.aiNote,
    };
  }

  private async chat(id: string) {
    const chat = await this.db.waChat.findUnique({ where: { id } });
    if (!chat) throw Errors.notFound("Chat not found");
    return chat;
  }

  async get(id: string) {
    return this.view(await this.chat(id));
  }

  async messages(chatId: string, before?: Date) {
    await this.chat(chatId);
    const rows = await this.db.waMessage.findMany({
      where: { chatId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.reverse().map(({ ownerId: _o, ...m }) => m);
  }

  async media(id: string) {
    const media = await this.db.waMedia.findUnique({ where: { id } });
    if (!media) throw Errors.notFound("File not found");
    return media;
  }

  /** Opening a chat: unread back to 0 and blue ticks on the person's phone. */
  async markRead(chatId: string) {
    const chat = await this.chat(chatId);
    if (chat.unreadCount === 0) return { ok: true };
    await this.db.waChat.update({ where: { id: chatId }, data: { unreadCount: 0 } });
    const last = await this.db.waMessage.findFirst({ where: { chatId, direction: "in", wamid: { not: null } }, orderBy: { createdAt: "desc" } });
    if (last?.wamid) {
      const provider = await this.deps.providerFor(chat.ownerId);
      await provider?.markRead?.(last.wamid).catch(() => {});
    }
    this.changed(chatId);
    return { ok: true };
  }

  async rename(chatId: string, name: string | null) {
    await this.chat(chatId);
    await this.db.waChat.update({ where: { id: chatId }, data: { customName: name?.trim() || null } });
    this.changed(chatId);
    return this.get(chatId);
  }

  // ---- Sending ----

  private requireWindow(chat: { lastInboundAt: Date | null }) {
    if (!windowOpenUntil(chat.lastInboundAt, this.now())) {
      throw Errors.conflict(
        "WINDOW_CLOSED",
        "More than 24 hours since this person's last message: WhatsApp only allows an approved template now",
      );
    }
  }

  private async afterSend(chatId: string, messageId: string, send: () => Promise<{ externalMessageId: string }>, preview: string) {
    let updated;
    try {
      const res = await send();
      updated = await this.db.waMessage.update({ where: { id: messageId }, data: { wamid: res.externalMessageId, status: "sent" } });
    } catch (err) {
      const text = err instanceof WhatsAppProviderError ? err.message : `Not sent: ${err instanceof Error ? err.message : String(err)}`;
      updated = await this.db.waMessage.update({ where: { id: messageId }, data: { status: "failed", error: text.slice(0, 500) } });
    }
    await this.db.waChat.update({ where: { id: chatId }, data: { lastMessageAt: this.now(), lastMessageText: preview.slice(0, 200), aiDraft: null, aiNote: null } });
    this.changed(chatId);
    const { ownerId: _o, ...view } = updated;
    return view;
  }

  async sendText(chatId: string, text: string) {
    const chat = await this.chat(chatId);
    this.requireWindow(chat);
    const provider = await this.provider(chat.ownerId);
    if (!provider.sendText) throw Errors.conflict("NOT_SUPPORTED", "Your WhatsApp sender cannot send chat messages");
    const msg = await this.db.waMessage.create({ data: { ownerId: chat.ownerId, chatId, direction: "out", type: "text", body: text, status: "sending", createdAt: this.now() } });
    return this.afterSend(chatId, msg.id, () => provider.sendText!(chat.phone, text), text);
  }

  async sendFile(chatId: string, file: { data: Buffer; mime: string; filename: string; caption: string | null }) {
    if (file.data.length === 0) throw Errors.badRequest("The file is empty");
    if (file.data.length > MAX_MEDIA_BYTES) throw Errors.badRequest("Files up to 5 MB can be sent");
    const chat = await this.chat(chatId);
    this.requireWindow(chat);
    const provider = await this.provider(chat.ownerId);
    if (!provider.uploadMedia || !provider.sendMedia) throw Errors.conflict("NOT_SUPPORTED", "Your WhatsApp sender cannot send files");
    const kind = mediaKindOf(file.mime);
    const media = await this.db.waMedia.create({ data: { ownerId: chat.ownerId, mime: file.mime, name: file.filename, size: file.data.length, data: new Uint8Array(file.data) } });
    const msg = await this.db.waMessage.create({
      data: {
        ownerId: chat.ownerId,
        chatId,
        direction: "out",
        type: kind,
        body: file.caption,
        mediaId: media.id,
        mediaMime: file.mime,
        mediaName: file.filename,
        mediaSize: file.data.length,
        status: "sending",
        createdAt: this.now(),
      },
    });
    return this.afterSend(
      chatId,
      msg.id,
      async () => {
        const mediaId = await provider.uploadMedia!({ data: file.data, mime: file.mime, filename: file.filename });
        return provider.sendMedia!(chat.phone, { kind, mediaId, caption: file.caption, filename: file.filename });
      },
      file.caption || PREVIEW[kind] || file.filename,
    );
  }

  async sendTemplate(chatId: string, templateId: string) {
    const chat = await this.chat(chatId);
    const template = await this.db.messageTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.channel !== "whatsapp") throw Errors.badRequest("WhatsApp template not found");
    if (template.approvalStatus !== "approved") throw Errors.badRequest("Only templates approved by Meta can be sent (mark it Approved on the Templates page once WhatsApp Manager shows it approved)");
    const provider = await this.provider(chat.ownerId);
    const lead = chat.leadId ? await this.deps.repos.leads.findById(chat.leadId) : null;
    const name = chat.customName ?? chat.profileName ?? lead?.name ?? null;
    const rendered = renderWhatsApp(template, { ...leadTemplateData(lead ?? {}), ...(name ? { name } : {}) });
    if (rendered.missing.length) throw Errors.badRequest(`The template needs a value for: ${rendered.missing.join(", ")}`);
    const msg = await this.db.waMessage.create({
      data: { ownerId: chat.ownerId, chatId, direction: "out", type: "template", body: rendered.text, templateName: template.name, status: "sending", createdAt: this.now() },
    });
    return this.afterSend(
      chatId,
      msg.id,
      () => provider.sendTemplate({ to: chat.phone, templateName: template.name, language: template.language ?? "en", bodyParams: rendered.params }),
      rendered.text,
    );
  }

  /** A new chat: WhatsApp only allows an approved template as the first message. */
  async start(input: { phone: string; templateId: string; name?: string | null }) {
    const number = toWhatsAppNumber(input.phone);
    if (!number) throw Errors.badRequest("Enter a valid mobile number with country code, e.g. +91 98765 43210");
    const ownerId = this.owner();
    const chat = await this.findOrCreateChat(ownerId, number, null);
    if (input.name?.trim() && !chat.customName) await this.db.waChat.update({ where: { id: chat.id }, data: { customName: input.name.trim() } });
    const message = await this.sendTemplate(chat.id, input.templateId);
    return { chat: await this.get(chat.id), message };
  }

  // ---- AI draft ----

  /** Writes (or rewrites) the AI draft of the next reply. Never sends it. */
  async draft(chatId: string): Promise<{ draft: string | null; note: string | null }> {
    const chat = await this.chat(chatId);
    const writer = await this.deps.runtime?.writer();
    if (!writer) {
      const note = "AI drafts need the Claude or Gemini key in AI Inbox → Setup";
      await this.db.waChat.update({ where: { id: chatId }, data: { aiNote: note } });
      return { draft: null, note };
    }
    const history = await this.db.waMessage.findMany({ where: { chatId }, orderBy: { createdAt: "desc" }, take: HISTORY_FOR_AI });
    const messages = history
      .reverse()
      .map((m) => ({ direction: m.direction === "in" ? ("in" as const) : ("out" as const), text: m.body ?? (PREVIEW[m.type] ? `[${PREVIEW[m.type]}]` : ""), sentAt: m.createdAt }))
      .filter((m) => m.text);
    if (!messages.some((m) => m.direction === "in")) return { draft: null, note: null };
    const settings = await this.deps.repos.inbox.getSettings();
    let draft: string | null = null;
    let note: string | null = null;
    try {
      const written = await writer.write({
        platform: "whatsapp",
        participantName: chat.customName ?? chat.profileName ?? `+${chat.phone}`,
        participantUsername: null,
        messages,
        business: { profile: settings.businessProfile, faqs: settings.faqs, style: settings.style, neverSay: settings.neverSay },
        timeZone: this.deps.timeZone,
      });
      draft = written.should_reply && written.reply.trim() ? written.reply.trim() : null;
      note = written.needs_human ? `Check before sending: ${written.reason || "the AI is not sure"}` : !draft ? "No reply needed" : null;
    } catch (err) {
      note = `AI draft failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
    }
    await this.db.waChat.update({ where: { id: chatId }, data: { aiDraft: draft, aiDraftAt: this.now(), aiNote: note } });
    this.changed(chatId);
    return { draft, note };
  }
}
