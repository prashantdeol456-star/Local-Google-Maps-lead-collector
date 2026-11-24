// WhatsApp Chat: two-way chats through the user's own WhatsApp number (Meta Cloud API), with
// what the WhatsApp app and the Cloud API both support.
//
//   incoming: Meta webhook → handle() → WaChat / WaMessage saved → live event to the admin panel.
//             Text, photos, documents, voice notes, videos, stickers, locations, contact cards,
//             button/list choices, replies (quotes), forwards, reactions, edits and deletions.
//             Files are downloaded and kept (WhatsApp's links expire).
//   ticks:    status webhooks (sent → delivered → read → played, or failed) update the message.
//   outgoing: within 24 hours of the person's last message (WhatsApp's rule): text, files,
//             voice notes, locations, contact cards, buttons, lists, link buttons, location
//             requests, reactions, quoted replies, forwards. Otherwise, and for a new chat, an
//             approved template.
//   app-like: pin, archive, mute, labels, notes, star, delete for me, mark unread, block,
//             quick replies ("/"), greeting and away messages, business profile.
//   AI:       a draft of the next reply for every new message; sent only when the user presses Send.

import type { PrismaClient, WaChat, WaMessage } from "../../generated/prisma/client.js";
import { containsInsensitive } from "../../database/client.js";
import { ownerScope } from "../../database/ownerScope.js";
import type { Repositories } from "../../database/repositories/index.js";
import {
  toWhatsAppNumber,
  WhatsAppProviderError,
  type BusinessProfile,
  type InboundDetails,
  type MediaKind,
  type OutgoingInteractive,
  type WhatsAppEvent,
  type WhatsAppProvider,
  type WhatsAppSendResult,
} from "../../providers/whatsapp/index.js";
import { Errors } from "../../utils/errors.js";
import { leadTemplateData } from "../email/render.js";
import type { EventBus } from "../events.js";
import type { InboxRuntime } from "../inbox/runtime.js";
import { oggOpusChannels, webmOpusToOgg } from "./oggOpus.js";
import { renderWhatsApp } from "./templateParams.js";

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const HISTORY_FOR_AI = 30;
const GREETING_GAP_MS = 14 * 24 * 60 * 60 * 1000;
const AWAY_GAP_MS = 12 * 60 * 60 * 1000;
export const MAX_LABELS = 10;

const RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3, played: 4 };

const PREVIEW: Record<string, string> = {
  image: "📷 Photo",
  document: "📄 Document",
  audio: "🎤 Voice message",
  video: "🎬 Video",
  sticker: "Sticker",
  location: "📍 Location",
  contacts: "👤 Contact",
  interactive: "Buttons",
  system: "WhatsApp notice",
};

export function mediaKindOf(mime: string): MediaKind | "sticker" {
  if (/^image\/(jpeg|png)$/.test(mime)) return "image";
  if (mime === "image/webp") return "sticker";
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

/** "HH:MM" on the given days, in the time zone: is `now` within working hours? */
export function withinHours(now: Date, timeZone: string, start: string, end: string, days: number[]): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  if (!days.includes(day)) return false;
  const a = toMin(start);
  const b = toMin(end);
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export interface ChatDeps {
  providerFor(ownerId: string | null): Promise<WhatsAppProvider | null>;
  repos: Repositories;
  bus?: EventBus;
  runtime?: InboxRuntime;
  timeZone: string;
  now?: () => Date;
  log?: (msg: string) => void;
}

export type ChatFilter = "all" | "unread" | "archived" | "starred";

type Outgoing = {
  type: string;
  body?: string | null;
  payload?: unknown;
  media?: { id: string; mime: string; name: string | null; size: number } | null;
  templateName?: string | null;
  replyToWamid?: string | null;
  preview: string;
};

export class WhatsAppChatService {
  constructor(
    private readonly db: PrismaClient,
    private readonly deps: ChatDeps,
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * Whose WhatsApp number this is about: a customer's own; for a super admin the platform's
   * number (null), or the customer they are viewing. Webhooks run in their number's owner scope.
   */
  private owner(): string | null {
    const scope = ownerScope.getStore();
    if (!scope) return null;
    return scope.customer ? scope.userId : scope.ownerId;
  }

  private changed(chatId: string) {
    this.deps.bus?.publish({ type: "whatsapp.chat", chatId });
  }

  private async provider(ownerId: string | null): Promise<WhatsAppProvider> {
    const p = await this.deps.providerFor(ownerId);
    if (!p) throw Errors.conflict("SENDER_REQUIRED", "Connect your WhatsApp number on the My sender page first");
    return p;
  }

  private need<K extends keyof WhatsAppProvider>(p: WhatsAppProvider, key: K): NonNullable<WhatsAppProvider[K]> {
    const fn = p[key];
    if (typeof fn !== "function") throw Errors.conflict("NOT_SUPPORTED", "Your WhatsApp sender cannot do this");
    return (fn as (...a: unknown[]) => unknown).bind(p) as NonNullable<WhatsAppProvider[K]>;
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
    if (existing) return { chat: existing, created: false };
    const lead = (await this.deps.repos.leads.findByNormalizedPhone(`+${phone}`))[0] ?? null;
    return { chat: await this.db.waChat.create({ data: { ownerId, phone, profileName, leadId: lead?.id ?? null } }), created: true };
  }

  private async byWamid(ownerId: string | null, wamid: string) {
    return this.db.waMessage.findFirst({ where: { ownerId, wamid } });
  }

  private async receive(e: Extract<WhatsAppEvent, { kind: "inbound" }>) {
    const ownerId = this.owner();
    const d: InboundDetails = e.details ?? { context: null, reaction: null, location: null, contacts: null, choice: null, edit: null, revoke: null, system: null };

    // Reactions, edits and deletions change an earlier message.
    if (d.reaction) return this.theirReaction(ownerId, d.reaction.messageId, d.reaction.emoji);
    if (d.edit) return this.theirEdit(ownerId, d.edit.originalId, d.edit.text);
    if (d.revoke) return this.theirDeletion(ownerId, d.revoke.originalId);

    if (await this.byWamid(ownerId, e.providerEventId)) return; // delivered twice
    const { chat, created } = await this.findOrCreateChat(ownerId, e.from, e.profileName);
    const type =
      e.messageType === "voice" ? "audio" : e.messageType === "button" || (e.messageType === "interactive" && d.choice) ? "text" : e.messageType;
    let body = e.text ?? e.media?.caption ?? null;
    let payload: unknown = null;
    if (d.location) {
      payload = { location: d.location };
      body = [d.location.name, d.location.address].filter(Boolean).join(", ") || null;
    } else if (d.contacts) {
      payload = { contacts: d.contacts };
      body = d.contacts.map((c) => c.name).join(", ");
    } else if (d.choice) {
      payload = { choice: d.choice };
      body = d.choice.title ?? body;
    } else if (d.system) {
      body = d.system;
    }
    const message = await this.db.waMessage.create({
      data: {
        ownerId,
        chatId: chat.id,
        wamid: e.providerEventId,
        direction: "in",
        type,
        body,
        payload: payload ? JSON.stringify(payload) : null,
        replyToWamid: d.context?.id && !d.context.forwarded ? d.context.id : null,
        forwarded: d.context?.frequentlyForwarded ? "frequently_forwarded" : d.context?.forwarded ? "forwarded" : null,
        mediaMime: e.media?.mime ?? null,
        mediaName: e.media?.filename ?? null,
        status: "received",
        // WhatsApp gives whole seconds: within that second, keep the order the messages arrived in.
        createdAt: new Date(Math.max(e.occurredAt.getTime(), Math.min(this.now().getTime(), e.occurredAt.getTime() + 999))),
      },
    });
    const previousInbound = chat.lastInboundAt;
    const opensWindow = type !== "system";
    const lastInboundAt = opensWindow && (!previousInbound || previousInbound < e.occurredAt) ? e.occurredAt : previousInbound;
    await this.db.waChat.update({
      where: { id: chat.id },
      data: {
        lastInboundAt,
        lastMessageAt: e.occurredAt > chat.lastMessageAt ? e.occurredAt : chat.lastMessageAt,
        lastMessageText: (body ?? PREVIEW[type] ?? `[${type}]`).slice(0, 200),
        unreadCount: { increment: 1 },
        profileName: e.profileName ?? chat.profileName,
        // A new message brings an archived chat back (as in the WhatsApp app).
        archivedAt: null,
        aiDraft: null,
        aiNote: null,
      },
    });
    this.changed(chat.id);

    // In the background (the webhook answers Meta at once): keep the file, automatic replies, AI draft.
    if (e.media) void this.keepMedia(ownerId, message.id, e.media.id, e.media.mime, e.media.filename).catch(() => {});
    if (opensWindow) {
      void this.autoReplies(chat.id, created, previousInbound)
        .then(() => this.draft(chat.id))
        .catch(() => {});
    }
  }

  private async theirReaction(ownerId: string | null, wamid: string, emoji: string | null) {
    const target = await this.byWamid(ownerId, wamid);
    if (!target) return;
    const reactions = { ...parseJson<Record<string, string>>(target.reactions, {}) };
    if (emoji) reactions.in = emoji;
    else delete reactions.in;
    await this.db.waMessage.update({ where: { id: target.id }, data: { reactions: Object.keys(reactions).length ? JSON.stringify(reactions) : null } });
    if (emoji) {
      const quoted = (target.body ?? PREVIEW[target.type] ?? "").slice(0, 60);
      await this.db.waChat.update({ where: { id: target.chatId }, data: { lastMessageText: `Reacted ${emoji} to "${quoted}"`.slice(0, 200) } });
    }
    this.changed(target.chatId);
  }

  private async theirEdit(ownerId: string | null, wamid: string, text: string | null) {
    const target = await this.byWamid(ownerId, wamid);
    if (!target || target.direction !== "in") return;
    await this.db.waMessage.update({ where: { id: target.id }, data: { body: text ?? target.body, editedAt: this.now() } });
    this.changed(target.chatId);
  }

  /** The person deleted their message for everyone: its text and file are removed here too. */
  private async theirDeletion(ownerId: string | null, wamid: string) {
    const target = await this.byWamid(ownerId, wamid);
    if (!target || target.direction !== "in") return;
    if (target.mediaId) await this.db.waMedia.deleteMany({ where: { id: target.mediaId } });
    await this.db.waMessage.update({ where: { id: target.id }, data: { body: null, payload: null, mediaId: null, revokedAt: this.now() } });
    this.changed(target.chatId);
  }

  private async keepMedia(ownerId: string | null, messageId: string, mediaId: string, mime: string | null, filename: string | null) {
    const provider = await this.deps.providerFor(ownerId);
    const file = await provider?.downloadMedia?.(mediaId, MAX_MEDIA_BYTES);
    if (!file) {
      await this.db.waMessage.update({ where: { id: messageId }, data: { error: "File not saved (larger than 5 MB or no longer available)" } });
      return;
    }
    const media = await this.db.waMedia.create({ data: { ownerId, mime: file.mime ?? mime ?? "application/octet-stream", name: filename, size: file.data.length, data: new Uint8Array(file.data) } });
    const msg = await this.db.waMessage.update({ where: { id: messageId }, data: { mediaId: media.id, mediaMime: media.mime, mediaSize: file.data.length } });
    this.changed(msg.chatId);
  }

  private async status(e: Extract<WhatsAppEvent, { kind: "status" }>) {
    const msg = await this.db.waMessage.findFirst({ where: { wamid: e.externalMessageId, direction: "out" } });
    if (!msg) return; // a campaign message, not a chat
    const forward = e.status === "failed" ? msg.status !== "read" && msg.status !== "played" : (RANK[e.status] ?? 0) > (RANK[msg.status] ?? -1);
    if (!forward) return;
    await this.db.waMessage.update({ where: { id: msg.id }, data: { status: e.status, ...(e.status === "failed" ? { error: e.error ?? "Not delivered" } : {}) } });
    this.changed(msg.chatId);
  }

  // ---- Greeting and away messages (WhatsApp Business style) ----

  async settings() {
    const ownerId = this.owner();
    const found = await this.db.waChatSettings.findFirst({ where: { ownerId } });
    const s = found ?? (await this.db.waChatSettings.create({ data: { ownerId } }));
    return { ...s, workDays: parseJson<number[]>(s.workDays, [1, 2, 3, 4, 5, 6]) };
  }

  async updateSettings(input: {
    greetingOn?: boolean;
    greetingText?: string | null;
    awayOn?: boolean;
    awayText?: string | null;
    workStart?: string;
    workEnd?: string;
    workDays?: number[];
    notify?: boolean;
  }) {
    const current = await this.settings();
    if (input.greetingOn && !(input.greetingText ?? current.greetingText)?.trim()) throw Errors.badRequest("Write the greeting message first");
    if (input.awayOn && !(input.awayText ?? current.awayText)?.trim()) throw Errors.badRequest("Write the away message first");
    const { workDays, ...rest } = input;
    await this.db.waChatSettings.update({ where: { id: current.id }, data: { ...rest, ...(workDays ? { workDays: JSON.stringify([...new Set(workDays)].sort()) } : {}) } });
    return this.settings();
  }

  private async autoReplies(chatId: string, newChat: boolean, previousInbound: Date | null) {
    const chat = await this.chat(chatId);
    const s = await this.db.waChatSettings.findFirst({ where: { ownerId: chat.ownerId } });
    if (!s) return;
    const now = this.now();
    const provider = await this.deps.providerFor(chat.ownerId);
    if (!provider?.sendText) return;
    const longQuiet = newChat || !previousInbound || now.getTime() - previousInbound.getTime() > GREETING_GAP_MS;
    if (s.greetingOn && s.greetingText?.trim() && longQuiet && (!chat.greetedAt || now.getTime() - chat.greetedAt.getTime() > GREETING_GAP_MS)) {
      await this.db.waChat.update({ where: { id: chatId }, data: { greetedAt: now } });
      await this.send(chat, provider, { type: "text", body: s.greetingText, preview: s.greetingText }, (to) => provider.sendText!(to, s.greetingText!));
    }
    const days = parseJson<number[]>(s.workDays, [1, 2, 3, 4, 5, 6]);
    if (
      s.awayOn &&
      s.awayText?.trim() &&
      !withinHours(now, this.deps.timeZone, s.workStart, s.workEnd, days) &&
      (!chat.awaySentAt || now.getTime() - chat.awaySentAt.getTime() > AWAY_GAP_MS)
    ) {
      await this.db.waChat.update({ where: { id: chatId }, data: { awaySentAt: now } });
      await this.send(chat, provider, { type: "text", body: s.awayText, preview: s.awayText }, (to) => provider.sendText!(to, s.awayText!));
    }
  }

  // ---- Reading ----

  async list(query: { q?: string; filter?: ChatFilter; label?: string }) {
    const q = query.q?.trim();
    const filter = query.filter ?? "all";
    const where = {
      ...(q ? { OR: [{ phone: { contains: q.replace(/\D/g, "") || q } }, { profileName: containsInsensitive(q) }, { customName: containsInsensitive(q) }] } : {}),
      ...(filter === "archived" ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(filter === "unread" ? { unreadCount: { gt: 0 } } : {}),
      ...(filter === "starred" ? { messages: { some: { starred: true } } } : {}),
      ...(query.label ? { labels: { contains: JSON.stringify(query.label) } } : {}),
    };
    const chats = await this.db.waChat.findMany({ where, orderBy: [{ lastMessageAt: "desc" }], take: 300 });
    const now = this.now();
    // Pinned chats first (most recently pinned on top), then by last message.
    const pinned = chats.filter((c) => c.pinnedAt).sort((a, b) => b.pinnedAt!.getTime() - a.pinnedAt!.getTime());
    return [...pinned, ...chats.filter((c) => !c.pinnedAt)].map((c) => this.view(c, now));
  }

  async labels(): Promise<string[]> {
    const rows = await this.db.waChat.findMany({ where: { labels: { not: null } }, select: { labels: true } });
    return [...new Set(rows.flatMap((r) => parseJson<string[]>(r.labels, [])))].sort();
  }

  private view(c: WaChat, now = this.now()) {
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
      pinned: !!c.pinnedAt,
      archived: !!c.archivedAt,
      mutedUntil: c.mutedUntil && c.mutedUntil > now ? c.mutedUntil : null,
      labels: parseJson<string[]>(c.labels, []),
      notes: c.notes,
      blocked: !!c.blockedAt,
    };
  }

  private messageView(m: WaMessage) {
    const { ownerId: _o, reactions, payload, ...rest } = m;
    return { ...rest, reactions: parseJson<Record<string, string>>(reactions, {}), payload: parseJson<Record<string, unknown> | null>(payload, null) };
  }

  private async chat(id: string) {
    const chat = await this.db.waChat.findUnique({ where: { id } });
    if (!chat) throw Errors.notFound("Chat not found");
    return chat;
  }

  private async message(id: string) {
    const m = await this.db.waMessage.findUnique({ where: { id } });
    if (!m) throw Errors.notFound("Message not found");
    return m;
  }

  async get(id: string) {
    return this.view(await this.chat(id));
  }

  async messages(chatId: string, query: { before?: Date; q?: string; starred?: boolean } = {}) {
    await this.chat(chatId);
    const rows = await this.db.waMessage.findMany({
      where: {
        chatId,
        hiddenAt: null,
        ...(query.before ? { createdAt: { lt: query.before } } : {}),
        ...(query.q ? { body: containsInsensitive(query.q) } : {}),
        ...(query.starred ? { starred: true } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    // The quoted message of each reply (shown above the bubble).
    const quoted = [...new Set(rows.map((r) => r.replyToWamid).filter((w): w is string => !!w))];
    const originals = quoted.length ? await this.db.waMessage.findMany({ where: { chatId, wamid: { in: quoted } } }) : [];
    const byWamid = new Map(originals.map((o) => [o.wamid!, o]));
    return rows.reverse().map((m) => {
      const q = m.replyToWamid ? byWamid.get(m.replyToWamid) : undefined;
      return {
        ...this.messageView(m),
        quoted: q ? { id: q.id, direction: q.direction, type: q.type, body: q.revokedAt ? null : q.body } : m.replyToWamid ? { id: null, direction: null, type: "unknown", body: null } : null,
      };
    });
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
    const last = await this.lastInbound(chatId);
    if (last?.wamid) {
      const provider = await this.deps.providerFor(chat.ownerId);
      await provider?.markRead?.(last.wamid).catch(() => {});
    }
    this.changed(chatId);
    return { ok: true };
  }

  private lastInbound(chatId: string) {
    return this.db.waMessage.findFirst({ where: { chatId, direction: "in", wamid: { not: null }, type: { not: "system" } }, orderBy: { createdAt: "desc" } });
  }

  /** "typing…" on the person's phone while you write (WhatsApp hides it after 25 s or when you send). */
  async typing(chatId: string) {
    const chat = await this.chat(chatId);
    if (!windowOpenUntil(chat.lastInboundAt, this.now())) return { ok: false };
    const last = await this.lastInbound(chatId);
    const provider = await this.deps.providerFor(chat.ownerId);
    if (!last?.wamid || !provider?.sendTyping) return { ok: false };
    await provider.sendTyping(last.wamid).catch(() => {});
    if (chat.unreadCount > 0) {
      await this.db.waChat.update({ where: { id: chatId }, data: { unreadCount: 0 } });
      this.changed(chatId);
    }
    return { ok: true };
  }

  // ---- Chat actions (your side only, like the WhatsApp app) ----

  async update(
    chatId: string,
    input: { name?: string | null; pinned?: boolean; archived?: boolean; mutedUntil?: Date | null; labels?: string[]; notes?: string | null; unread?: boolean },
  ) {
    await this.chat(chatId);
    const now = this.now();
    const labels = input.labels?.map((l) => l.trim()).filter(Boolean);
    if (labels && labels.length > MAX_LABELS) throw Errors.badRequest(`At most ${MAX_LABELS} labels per chat`);
    await this.db.waChat.update({
      where: { id: chatId },
      data: {
        ...(input.name !== undefined ? { customName: input.name?.trim() || null } : {}),
        ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? now : null } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null, ...(input.archived ? { pinnedAt: null } : {}) } : {}),
        ...(input.mutedUntil !== undefined ? { mutedUntil: input.mutedUntil } : {}),
        ...(labels ? { labels: labels.length ? JSON.stringify([...new Set(labels)]) : null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.unread !== undefined ? { unreadCount: input.unread ? 1 : 0 } : {}),
      },
    });
    this.changed(chatId);
    return this.get(chatId);
  }

  /** Deletes the chat here (not on the person's phone). */
  async remove(chatId: string) {
    const chat = await this.chat(chatId);
    const media = await this.db.waMessage.findMany({ where: { chatId, mediaId: { not: null } }, select: { mediaId: true } });
    await this.db.waMedia.deleteMany({ where: { id: { in: media.map((m) => m.mediaId!) } } });
    await this.db.waChat.delete({ where: { id: chat.id } });
    this.changed(chatId);
    return { ok: true };
  }

  async block(chatId: string, blocked: boolean) {
    const chat = await this.chat(chatId);
    const provider = await this.provider(chat.ownerId);
    try {
      await this.need(provider, "setBlocked")([chat.phone], blocked);
    } catch (err) {
      if (err instanceof WhatsAppProviderError) {
        throw Errors.badRequest(
          blocked ? `${err.message}. WhatsApp only lets you block people who messaged you in the last 24 hours.` : err.message,
        );
      }
      throw err;
    }
    await this.db.waChat.update({ where: { id: chatId }, data: { blockedAt: blocked ? this.now() : null } });
    this.changed(chatId);
    return this.get(chatId);
  }

  async star(messageId: string, starred: boolean) {
    const m = await this.message(messageId);
    await this.db.waMessage.update({ where: { id: m.id }, data: { starred } });
    this.changed(m.chatId);
    return { ok: true };
  }

  /** Delete for me: hidden here; WhatsApp has no "delete for everyone" for businesses. */
  async hide(messageId: string) {
    const m = await this.message(messageId);
    await this.db.waMessage.update({ where: { id: m.id }, data: { hiddenAt: this.now() } });
    this.changed(m.chatId);
    return { ok: true };
  }

  // ---- Sending ----

  private requireWindow(chat: { lastInboundAt: Date | null; blockedAt?: Date | null }) {
    if (chat.blockedAt) throw Errors.conflict("BLOCKED", "You blocked this number. Unblock it to send messages");
    if (!windowOpenUntil(chat.lastInboundAt, this.now())) {
      throw Errors.conflict(
        "WINDOW_CLOSED",
        "More than 24 hours since this person's last message: WhatsApp only allows an approved template now",
      );
    }
  }

  /** Saves the message, sends it, then records the WhatsApp id (or why it failed). */
  private async send(chat: WaChat, provider: WhatsAppProvider, out: Outgoing, deliver: (to: string, replyTo: string | null) => Promise<WhatsAppSendResult>) {
    const msg = await this.db.waMessage.create({
      data: {
        ownerId: chat.ownerId,
        chatId: chat.id,
        direction: "out",
        type: out.type,
        body: out.body ?? null,
        payload: out.payload ? JSON.stringify(out.payload) : null,
        mediaId: out.media?.id ?? null,
        mediaMime: out.media?.mime ?? null,
        mediaName: out.media?.name ?? null,
        mediaSize: out.media?.size ?? null,
        templateName: out.templateName ?? null,
        replyToWamid: out.replyToWamid ?? null,
        status: "sending",
        createdAt: this.now(),
      },
    });
    let updated;
    try {
      const res = await deliver(chat.phone, out.replyToWamid ?? null);
      updated = await this.db.waMessage.update({ where: { id: msg.id }, data: { wamid: res.externalMessageId, status: "sent" } });
    } catch (err) {
      const text = err instanceof WhatsAppProviderError ? err.message : `Not sent: ${err instanceof Error ? err.message : String(err)}`;
      updated = await this.db.waMessage.update({ where: { id: msg.id }, data: { status: "failed", error: text.slice(0, 500) } });
    }
    await this.db.waChat.update({ where: { id: chat.id }, data: { lastMessageAt: this.now(), lastMessageText: out.preview.slice(0, 200), aiDraft: null, aiNote: null, archivedAt: null } });
    this.changed(chat.id);
    return this.messageView(updated);
  }

  /** The wamid to quote, checked to belong to this chat. */
  private async quote(chatId: string, replyTo: string | null | undefined): Promise<string | null> {
    if (!replyTo) return null;
    const m = await this.db.waMessage.findFirst({ where: { id: replyTo, chatId } });
    if (!m?.wamid) throw Errors.badRequest("That message cannot be quoted");
    return m.wamid;
  }

  private async open(chatId: string) {
    const chat = await this.chat(chatId);
    this.requireWindow(chat);
    return { chat, provider: await this.provider(chat.ownerId) };
  }

  async sendText(chatId: string, text: string, replyTo?: string | null) {
    const { chat, provider } = await this.open(chatId);
    const sendText = this.need(provider, "sendText");
    const replyToWamid = await this.quote(chatId, replyTo);
    return this.send(chat, provider, { type: "text", body: text, replyToWamid, preview: text }, (to, r) => sendText(to, text, r));
  }

  private async storeMedia(ownerId: string | null, file: { data: Buffer; mime: string; filename: string }) {
    const media = await this.db.waMedia.create({ data: { ownerId, mime: file.mime, name: file.filename, size: file.data.length, data: new Uint8Array(file.data) } });
    return { id: media.id, mime: file.mime, name: file.filename, size: file.data.length };
  }

  async sendFile(chatId: string, file: { data: Buffer; mime: string; filename: string; caption: string | null }, replyTo?: string | null) {
    if (file.data.length === 0) throw Errors.badRequest("The file is empty");
    if (file.data.length > MAX_MEDIA_BYTES) throw Errors.badRequest("Files up to 5 MB can be sent");
    const { chat, provider } = await this.open(chatId);
    const upload = this.need(provider, "uploadMedia");
    const sendMedia = this.need(provider, "sendMedia");
    const kind = mediaKindOf(file.mime);
    const replyToWamid = await this.quote(chatId, replyTo);
    const media = await this.storeMedia(chat.ownerId, file);
    return this.send(chat, provider, { type: kind, body: file.caption, media, replyToWamid, preview: file.caption || PREVIEW[kind] || file.filename }, async (to, r) => {
      const mediaId = await upload({ data: file.data, mime: file.mime, filename: file.filename });
      return sendMedia(to, { kind, mediaId, caption: file.caption, filename: file.filename }, r);
    });
  }

  /** A voice note recorded in the browser (WebM or Ogg, Opus): sent as a WhatsApp voice message. */
  async sendVoice(chatId: string, audio: { data: Buffer; mime: string }, replyTo?: string | null) {
    if (audio.data.length === 0) throw Errors.badRequest("The recording is empty");
    if (audio.data.length > MAX_MEDIA_BYTES) throw Errors.badRequest("Voice notes up to 5 MB can be sent");
    let ogg: Buffer;
    let channels: number | null;
    if (audio.mime.startsWith("audio/ogg")) {
      ogg = audio.data;
      channels = oggOpusChannels(ogg);
    } else {
      const converted = webmOpusToOgg(audio.data);
      if (!converted) throw Errors.badRequest("This recording could not be read. Record again, or send an audio file with 📎");
      ogg = converted.data;
      channels = converted.channels;
    }
    if (channels === null) throw Errors.badRequest("Voice notes must be Opus audio");
    const voice = channels === 1; // WhatsApp voice messages are mono; stereo goes as a plain audio file
    const { chat, provider } = await this.open(chatId);
    const upload = this.need(provider, "uploadMedia");
    const sendMedia = this.need(provider, "sendMedia");
    const replyToWamid = await this.quote(chatId, replyTo);
    const file = { data: ogg, mime: "audio/ogg", filename: "voice-note.ogg" };
    const media = await this.storeMedia(chat.ownerId, file);
    return this.send(chat, provider, { type: "audio", media, payload: { voice }, replyToWamid, preview: PREVIEW.audio! }, async (to, r) => {
      const mediaId = await upload(file);
      return sendMedia(to, { kind: "audio", mediaId, voice }, r);
    });
  }

  async sendLocation(chatId: string, location: { latitude: number; longitude: number; name?: string | null; address?: string | null }, replyTo?: string | null) {
    const { chat, provider } = await this.open(chatId);
    const fn = this.need(provider, "sendLocation");
    const replyToWamid = await this.quote(chatId, replyTo);
    const loc = { latitude: location.latitude, longitude: location.longitude, name: location.name?.trim() || null, address: location.address?.trim() || null };
    const body = [loc.name, loc.address].filter(Boolean).join(", ") || null;
    return this.send(chat, provider, { type: "location", body, payload: { location: loc }, replyToWamid, preview: PREVIEW.location! }, (to, r) => fn(to, loc, r));
  }

  async sendContacts(chatId: string, contacts: { name: string; phone: string }[], replyTo?: string | null) {
    const clean = contacts.map((c) => ({ name: c.name.trim(), phone: toWhatsAppNumber(c.phone) ? `+${toWhatsAppNumber(c.phone)}` : null }));
    if (clean.some((c) => !c.name || !c.phone)) throw Errors.badRequest("Each contact needs a name and a valid number with country code");
    const list = clean as { name: string; phone: string }[];
    const { chat, provider } = await this.open(chatId);
    const fn = this.need(provider, "sendContacts");
    const replyToWamid = await this.quote(chatId, replyTo);
    return this.send(
      chat,
      provider,
      {
        type: "contacts",
        body: list.map((c) => c.name).join(", "),
        payload: { contacts: list.map((c) => ({ name: c.name, phones: [{ phone: c.phone, waId: null, type: "CELL" }], emails: [], org: null })) },
        replyToWamid,
        preview: PREVIEW.contacts!,
      },
      (to, r) => fn(to, list, r),
    );
  }

  async sendInteractive(chatId: string, message: OutgoingInteractive, replyTo?: string | null) {
    const { chat, provider } = await this.open(chatId);
    const fn = this.need(provider, "sendInteractive");
    const replyToWamid = await this.quote(chatId, replyTo);
    const preview = message.type === "location_request" ? "📍 Location request" : message.body;
    return this.send(chat, provider, { type: "interactive", body: message.body, payload: { interactive: message }, replyToWamid, preview }, (to, r) => fn(to, message, r));
  }

  /** Your reaction on one of the person's messages ("" removes it). */
  async react(messageId: string, emoji: string) {
    const target = await this.message(messageId);
    if (target.direction !== "in" || !target.wamid) throw Errors.badRequest("You can react only to messages the person sent you");
    const { chat, provider } = await this.open(target.chatId);
    const fn = this.need(provider, "sendReaction");
    try {
      await fn(chat.phone, target.wamid, emoji);
    } catch (err) {
      throw Errors.badRequest(err instanceof Error ? err.message : String(err));
    }
    const reactions = { ...parseJson<Record<string, string>>(target.reactions, {}) };
    if (emoji) reactions.out = emoji;
    else delete reactions.out;
    await this.db.waMessage.update({ where: { id: target.id }, data: { reactions: Object.keys(reactions).length ? JSON.stringify(reactions) : null } });
    this.changed(target.chatId);
    return { ok: true };
  }

  /** Sends a copy of a message to other chats (each needs its 24-hour window open). */
  async forward(messageId: string, chatIds: string[]) {
    const m = await this.message(messageId);
    if (m.revokedAt) throw Errors.badRequest("This message was deleted");
    const results: { chatId: string; ok: boolean; error?: string }[] = [];
    for (const chatId of [...new Set(chatIds)].slice(0, 5)) {
      try {
        const payload = parseJson<Record<string, unknown> | null>(m.payload, null);
        if (m.mediaId) {
          const media = await this.media(m.mediaId);
          await this.sendFile(chatId, { data: Buffer.from(media.data), mime: media.mime, filename: media.name ?? "file", caption: m.body });
        } else if (m.type === "location" && payload?.location) {
          await this.sendLocation(chatId, payload.location as { latitude: number; longitude: number; name?: string; address?: string });
        } else if (m.type === "contacts" && Array.isArray(payload?.contacts)) {
          const contacts = (payload.contacts as { name: string; phones: { phone: string }[] }[]).filter((c) => c.phones[0]).map((c) => ({ name: c.name, phone: c.phones[0]!.phone }));
          await this.sendContacts(chatId, contacts);
        } else if (m.body) {
          await this.sendText(chatId, m.body);
        } else {
          throw Errors.badRequest("This kind of message cannot be forwarded");
        }
        results.push({ chatId, ok: true });
      } catch (err) {
        results.push({ chatId, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { results };
  }

  async sendTemplate(chatId: string, templateId: string) {
    const chat = await this.chat(chatId);
    if (chat.blockedAt) throw Errors.conflict("BLOCKED", "You blocked this number. Unblock it to send messages");
    const template = await this.db.messageTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.channel !== "whatsapp") throw Errors.badRequest("WhatsApp template not found");
    if (template.approvalStatus !== "approved") throw Errors.badRequest("Only templates approved by Meta can be sent (mark it Approved on the Templates page once WhatsApp Manager shows it approved)");
    const provider = await this.provider(chat.ownerId);
    const lead = chat.leadId ? await this.deps.repos.leads.findById(chat.leadId) : null;
    const name = chat.customName ?? chat.profileName ?? lead?.name ?? null;
    const rendered = renderWhatsApp(template, { ...leadTemplateData(lead ?? {}), ...(name ? { name } : {}) });
    if (rendered.missing.length) throw Errors.badRequest(`The template needs a value for: ${rendered.missing.join(", ")}`);
    return this.send(chat, provider, { type: "template", body: rendered.text, templateName: template.name, preview: rendered.text }, (to) =>
      provider.sendTemplate({ to, templateName: template.name, language: template.language ?? "en", bodyParams: rendered.params }),
    );
  }

  /** A new chat: WhatsApp only allows an approved template as the first message. */
  async start(input: { phone: string; templateId: string; name?: string | null }) {
    const number = toWhatsAppNumber(input.phone);
    if (!number) throw Errors.badRequest("Enter a valid mobile number with country code, e.g. +91 98765 43210");
    const ownerId = this.owner();
    const { chat } = await this.findOrCreateChat(ownerId, number, null);
    if (input.name?.trim() && !chat.customName) await this.db.waChat.update({ where: { id: chat.id }, data: { customName: input.name.trim() } });
    const message = await this.sendTemplate(chat.id, input.templateId);
    return { chat: await this.get(chat.id), message };
  }

  // ---- Quick replies ----

  quickReplies() {
    return this.db.waQuickReply.findMany({ orderBy: { shortcut: "asc" } });
  }

  async saveQuickReply(input: { id?: string; shortcut: string; text: string }) {
    const shortcut = input.shortcut.trim().replace(/^\//, "").toLowerCase();
    if (!/^[a-z0-9_-]{1,25}$/.test(shortcut)) throw Errors.badRequest("Shortcut: letters, digits, - or _ (up to 25), e.g. fees");
    const clash = await this.db.waQuickReply.findFirst({ where: { shortcut, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (clash) throw Errors.conflict("DUPLICATE", `You already have /${shortcut}`);
    if (input.id) {
      const found = await this.db.waQuickReply.findUnique({ where: { id: input.id } });
      if (!found) throw Errors.notFound("Quick reply not found");
      return this.db.waQuickReply.update({ where: { id: input.id }, data: { shortcut, text: input.text } });
    }
    return this.db.waQuickReply.create({ data: { ownerId: this.owner(), shortcut, text: input.text } });
  }

  async deleteQuickReply(id: string) {
    const found = await this.db.waQuickReply.findUnique({ where: { id } });
    if (!found) throw Errors.notFound("Quick reply not found");
    await this.db.waQuickReply.delete({ where: { id } });
    return { ok: true };
  }

  // ---- Business profile (what people see about your number in WhatsApp) ----

  async profile(): Promise<BusinessProfile> {
    const provider = await this.provider(this.owner());
    return this.need(provider, "getProfile")();
  }

  async updateProfile(input: Partial<Omit<BusinessProfile, "profilePictureUrl">>) {
    const provider = await this.provider(this.owner());
    await this.need(provider, "updateProfile")(input);
    return this.profile();
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
    const history = await this.db.waMessage.findMany({ where: { chatId, hiddenAt: null, revokedAt: null }, orderBy: { createdAt: "desc" }, take: HISTORY_FOR_AI });
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
