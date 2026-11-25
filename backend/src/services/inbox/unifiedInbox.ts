// All messages: one list of the user's chats on every app — WhatsApp (WhatsApp Chat), and
// Facebook Messenger, Instagram, Telegram and LinkedIn (AI Inbox) — newest first, with unread
// counts and how long a free reply is still allowed. Opening a chat uses that app's own screen.

import { hasReplyWindow, META_WINDOW_MS } from "./policy.js";
import type { InboxService } from "./inboxService.js";
import type { WhatsAppChatService } from "../whatsapp/chatService.js";

export const UNIFIED_PLATFORMS = ["whatsapp", "facebook", "instagram", "telegram", "linkedin"] as const;
export type UnifiedPlatform = (typeof UNIFIED_PLATFORMS)[number];
export type UnifiedFilter = "all" | "unread" | "needs_reply";

export interface UnifiedChat {
  /** "whatsapp" chats live in WhatsApp Chat; the rest in the AI Inbox */
  source: "whatsapp" | "inbox";
  id: string;
  platform: UnifiedPlatform;
  name: string;
  /** Phone number or @username */
  handle: string | null;
  lastMessageText: string | null;
  lastMessageFromMe: boolean;
  lastMessageAt: Date;
  unreadCount: number;
  /** The person wrote last and has no answer yet */
  needsReply: boolean;
  /** An AI draft waits for you */
  draftReady: boolean;
  pinned: boolean;
  muted: boolean;
  /** Free replies allowed until (null: closed); "always" for Telegram bots and LinkedIn */
  replyUntil: Date | "always" | null;
  labels: string[];
}

const LIST_LIMIT = 300;

export class UnifiedInboxService {
  constructor(
    private readonly deps: {
      whatsapp: WhatsAppChatService;
      inbox: InboxService;
      now?: () => Date;
    },
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  /** `sources`: what the user may use (switched-off services are left out). */
  async list(query: { platform?: UnifiedPlatform; filter?: UnifiedFilter; q?: string; sources: { whatsapp: boolean; inbox: boolean } }) {
    const filter = query.filter ?? "all";
    const wantWhatsApp = query.sources.whatsapp && (!query.platform || query.platform === "whatsapp");
    const wantInbox = query.sources.inbox && query.platform !== "whatsapp";
    const now = this.now();

    const [wa, inbox] = await Promise.all([
      wantWhatsApp ? this.deps.whatsapp.list({ q: query.q, filter: filter === "unread" ? "unread" : "all" }) : Promise.resolve([]),
      wantInbox
        ? this.deps.inbox.list({ platform: query.platform, q: query.q, skip: 0, take: LIST_LIMIT }).then((r) => r.items)
        : Promise.resolve([]),
    ]);

    const chats: UnifiedChat[] = [];
    for (const c of wa) {
      chats.push({
        source: "whatsapp",
        id: c.id,
        platform: "whatsapp",
        name: c.name,
        handle: c.phone,
        lastMessageText: c.lastMessageText,
        lastMessageFromMe: false,
        lastMessageAt: c.lastMessageAt,
        unreadCount: c.unreadCount,
        // WhatsApp Chat keeps no reply status: unread or an open window with a draft means it waits.
        needsReply: c.unreadCount > 0 || !!c.aiDraft,
        draftReady: !!c.aiDraft,
        pinned: c.pinned,
        muted: !!c.mutedUntil,
        replyUntil: c.blocked ? null : c.windowOpenUntil,
        labels: c.labels,
      });
    }
    for (const c of inbox) {
      const metaWindow = hasReplyWindow(c.platform, c.accountKey);
      const business = c.platform === "telegram" && c.accountKey.startsWith("business:");
      chats.push({
        source: "inbox",
        id: c.id,
        platform: c.platform as UnifiedPlatform,
        name: c.participantName,
        handle: [business ? "your Telegram" : null, c.participantUsername ? `@${c.participantUsername}` : null].filter(Boolean).join(" · ") || null,
        lastMessageText: c.lastMessage?.text ?? null,
        lastMessageFromMe: c.lastMessage?.direction === "out",
        lastMessageAt: c.lastMessageAt,
        unreadCount: c.unreadCount,
        needsReply: c.status === "needs_reply" || c.status === "draft_ready",
        draftReady: !!c.pendingDraft,
        pinned: false,
        muted: false,
        replyUntil: metaWindow
          ? c.lastInboundAt && now.getTime() - c.lastInboundAt.getTime() < META_WINDOW_MS
            ? new Date(c.lastInboundAt.getTime() + META_WINDOW_MS)
            : null
          : "always",
        labels: [],
      });
    }

    const kept = chats.filter((c) => (filter === "unread" ? c.unreadCount > 0 : filter === "needs_reply" ? c.needsReply : true));
    kept.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt.getTime() - a.lastMessageAt.getTime());

    // Per-app counts of the whole list (before the app filter), for the tabs.
    const counts: Record<string, { chats: number; unread: number }> = {};
    for (const c of chats) {
      const row = (counts[c.platform] ??= { chats: 0, unread: 0 });
      row.chats++;
      if (c.unreadCount > 0 && !c.muted) row.unread += c.unreadCount;
    }
    return { items: kept.slice(0, LIST_LIMIT), counts };
  }

  /** Unread messages per app (for the menu badge and notifications). */
  async summary(sources: { whatsapp: boolean; inbox: boolean }) {
    const { counts, items } = await this.list({ sources, filter: "all" });
    const unread = Object.values(counts).reduce((a, c) => a + c.unread, 0);
    const needsReply = items.filter((c) => c.needsReply).length;
    // The newest unread chat, for a browser notification.
    const latest = items.filter((c) => c.unreadCount > 0 && !c.muted).sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())[0] ?? null;
    return { unread, needsReply, counts, latest: latest && { source: latest.source, id: latest.id, platform: latest.platform, name: latest.name, text: latest.lastMessageText, at: latest.lastMessageAt } };
  }
}
