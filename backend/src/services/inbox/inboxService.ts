// AI Inbox: one place for chats from Telegram, Facebook, Instagram and LinkedIn.
//
// 1. Pollers (and the LinkedIn extension) hand new messages to ingest().
// 2. processDue() picks chats whose latest message is from the customer (after a short pause,
//    so several quick messages get one answer) and asks Claude for a reply.
// 3. policy.decide() sends it automatically, keeps it as a draft for you, or skips it.
// Every AI reply is stored as a draft first, so the inbox shows what was sent and why.

import type {
  AiAssistantSettingsRecord,
  InboxConversationRecord,
  InboxDraftRecord,
  InboxPlatform,
  Repositories,
  ReplyMode,
} from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import type { EventBus } from "../events.js";
import type { SocialService } from "../social/socialService.js";
import { ChannelError, type IncomingThread, type MetaMessaging, type TelegramBot } from "./channels.js";
import { canReplyOnPlatform, decide } from "./policy.js";
import { ReplyWriterError, type ReplyWriter } from "./replyWriter.js";

export const PLATFORMS: InboxPlatform[] = ["telegram", "facebook", "instagram", "linkedin"];
export const REPLY_MODES: ReplyMode[] = ["smart", "auto", "draft", "off"];

/** Wait this long after the customer's last message before answering (they often send several). */
export const DEBOUNCE_MS = 8_000;
/** Only answer messages from the last 24 hours automatically (older ones: press "Write reply"). */
export const AUTO_REPLY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HISTORY_MESSAGES = 40;
const MAX_TEXT = 4000;

export interface SettingsInput {
  enabled?: boolean;
  businessProfile?: string;
  faqs?: string;
  style?: string;
  neverSay?: string;
  modes?: Partial<Record<InboxPlatform, ReplyMode>>;
  minConfidence?: number;
  maxAutoPerChatPerDay?: number;
}

export function parseModes(raw: string): Record<InboxPlatform, ReplyMode> {
  const defaults: Record<InboxPlatform, ReplyMode> = { telegram: "smart", facebook: "smart", instagram: "smart", linkedin: "draft" };
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const p of PLATFORMS) if (REPLY_MODES.includes(parsed[p] as ReplyMode)) defaults[p] = parsed[p] as ReplyMode;
  } catch {
    /* defaults */
  }
  return defaults;
}

function publicSettings(s: AiAssistantSettingsRecord) {
  const { telegramOffset: _offset, modes, ...rest } = s;
  return { ...rest, modes: parseModes(modes) };
}

export class InboxService {
  /** conversationId → time before which a failed AI attempt is not retried */
  private readonly retryAfter = new Map<string, number>();

  constructor(
    private readonly repos: Repositories,
    private readonly opts: {
      writer: ReplyWriter | null;
      telegram: TelegramBot | null;
      meta: MetaMessaging | null;
      social: SocialService;
      timeZone: string;
      bus?: EventBus;
      now?: () => Date;
    },
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  private changed(conversationId: string) {
    this.opts.bus?.publish({ type: "inbox.updated", conversationId });
  }

  // ---- Settings and status ----

  async settings() {
    return publicSettings(await this.repos.inbox.getSettings());
  }

  async updateSettings(input: SettingsInput) {
    const current = await this.repos.inbox.getSettings();
    const { modes, ...rest } = input;
    const saved = await this.repos.inbox.updateSettings({
      ...rest,
      ...(modes ? { modes: JSON.stringify({ ...parseModes(current.modes), ...modes }) } : {}),
    });
    if (input.enabled !== undefined && input.enabled !== current.enabled) {
      await this.repos.agentLogs.create({ jobId: null, action: "inbox_ai_toggled", status: "info", message: input.enabled ? "AI replies turned on" : "AI replies turned off" });
    }
    return publicSettings(saved);
  }

  async status() {
    const accounts = await this.repos.socialAccounts.list();
    const meta = accounts.filter((a) => a.platform === "facebook_page" || a.platform === "instagram");
    return {
      ai: this.opts.writer ? { configured: true, model: this.opts.writer.model } : { configured: false, model: null },
      telegram: { configured: !!this.opts.telegram },
      facebook: { configured: !!this.opts.meta, accounts: meta.filter((a) => a.platform === "facebook_page").map((a) => ({ id: a.id, name: a.name, status: a.status, lastError: a.lastError })) },
      instagram: { configured: !!this.opts.meta, accounts: meta.filter((a) => a.platform === "instagram").map((a) => ({ id: a.id, name: a.name, status: a.status, lastError: a.lastError })) },
      linkedin: { configured: true, via: "LinkedIn Messenger extension" },
      counts: await this.repos.inbox.countByStatus(),
    };
  }

  // ---- Incoming messages ----

  /** Stores new messages of one chat; returns how many were new. */
  async ingest(platform: InboxPlatform, accountKey: string, thread: IncomingThread): Promise<{ conversation: InboxConversationRecord; added: number }> {
    let conversation = await this.repos.inbox.upsertConversation({
      platform,
      accountKey,
      externalThreadId: thread.externalThreadId,
      participantName: thread.participantName.slice(0, 200) || "Unknown",
      participantId: thread.participantId,
      participantUsername: thread.participantUsername,
    });
    const added = await this.repos.inbox.addMessages(
      conversation.id,
      thread.messages.map((m) => ({
        direction: m.direction,
        externalId: m.externalId,
        text: m.text.slice(0, MAX_TEXT),
        // Our own messages we did not send from here were written in the app itself.
        author: m.direction === "in" ? "customer" : "elsewhere",
        sentAt: m.sentAt,
      })),
    );
    if (added.length === 0) return { conversation, added: 0 };

    const latestIn = added.filter((m) => m.direction === "in").reduce<Date | null>((a, m) => (!a || m.sentAt > a ? m.sentAt : a), null);
    const latestOut = added.filter((m) => m.direction === "out").reduce<Date | null>((a, m) => (!a || m.sentAt > a ? m.sentAt : a), null);
    const lastInboundAt = latestIn && (!conversation.lastInboundAt || latestIn > conversation.lastInboundAt) ? latestIn : conversation.lastInboundAt;
    const lastOutboundAt = latestOut && (!conversation.lastOutboundAt || latestOut > conversation.lastOutboundAt) ? latestOut : conversation.lastOutboundAt;
    const lastMessageAt = [conversation.lastMessageAt, lastInboundAt, lastOutboundAt].reduce<Date>((a, d) => (d && d > a ? d : a), new Date(0));

    // Who spoke last decides the status: the customer (needs a reply) or you (answered elsewhere).
    const customerLast = !!lastInboundAt && (!lastOutboundAt || lastInboundAt > lastOutboundAt);
    let status = conversation.status;
    const turnChanged = (customerLast && !!latestIn) || (!customerLast && !!latestOut);
    if (turnChanged) {
      status = customerLast ? "needs_reply" : "replied";
      // A newer message makes an unsent draft out of date.
      await this.repos.inbox.supersedePending(conversation.id);
    }
    conversation = await this.repos.inbox.updateConversation(conversation.id, { lastInboundAt, lastOutboundAt, lastMessageAt, status });
    this.changed(conversation.id);
    return { conversation, added: added.length };
  }

  // ---- AI replies ----

  /** Answers chats waiting for a reply (called every few seconds by the worker). */
  async processDue(): Promise<number> {
    if (!this.opts.writer) return 0;
    const settings = await this.repos.inbox.getSettings();
    if (!settings.enabled) return 0;
    const now = this.now();
    const due = await this.repos.inbox.awaitingReply(new Date(now.getTime() - AUTO_REPLY_MAX_AGE_MS), new Date(now.getTime() - DEBOUNCE_MS), 10);
    let handled = 0;
    for (const c of due) {
      if ((this.retryAfter.get(c.id) ?? 0) > now.getTime()) continue;
      const result = await this.respond(c.id, { settings });
      if (result) handled++;
    }
    return handled;
  }

  /**
   * Writes a reply to the customer's latest message, then sends it or keeps it as a draft.
   * `force`: the admin pressed "Write reply" (works even when AI replies are off).
   */
  async respond(conversationId: string, opts: { force?: boolean; settings?: AiAssistantSettingsRecord } = {}): Promise<InboxDraftRecord | null> {
    const writer = this.opts.writer;
    if (!writer) {
      if (opts.force) throw Errors.badRequest("AI replies are not set up: add ANTHROPIC_API_KEY to backend/.env");
      return null;
    }
    const settings = opts.settings ?? (await this.repos.inbox.getSettings());
    const conversation = await this.repos.inbox.findConversation(conversationId);
    if (!conversation) throw Errors.notFound("Chat not found");
    const platform = conversation.platform as InboxPlatform;
    const mode: ReplyMode = (conversation.replyMode as ReplyMode | null) ?? parseModes(settings.modes)[platform];
    if (!opts.force && (!settings.enabled || mode === "off")) return null;

    const lastIn = await this.repos.inbox.lastInbound(conversation.id);
    if (!lastIn) {
      if (opts.force) throw Errors.badRequest("There is no message from this person to answer yet");
      return null;
    }
    if (!opts.force && (await this.repos.inbox.draftFor(conversation.id, lastIn.id))) return null; // already handled

    const history = await this.repos.inbox.recentMessages(conversation.id, HISTORY_MESSAGES);
    let written;
    try {
      written = await writer.write({
        platform,
        participantName: conversation.participantName,
        participantUsername: conversation.participantUsername,
        messages: history.map((m) => ({ direction: m.direction === "in" ? "in" : "out", text: m.text, sentAt: m.sentAt })),
        business: { profile: settings.businessProfile, faqs: settings.faqs, style: settings.style, neverSay: settings.neverSay },
        timeZone: this.opts.timeZone,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ReplyWriterError && err.retryable && !opts.force) {
        this.retryAfter.set(conversation.id, this.now().getTime() + 60_000);
        return null;
      }
      const failed = await this.repos.inbox.createDraft({
        conversationId: conversation.id,
        status: "failed",
        text: "",
        intent: null,
        summary: null,
        language: null,
        confidence: null,
        needsHuman: true,
        decision: "The AI could not write a reply",
        forMessageId: lastIn.id,
        model: writer.model,
        error: message.slice(0, 500),
      });
      await this.repos.agentLogs.create({ jobId: null, action: "inbox_ai_failed", status: "error", message: `${conversation.participantName}: ${message}` });
      this.changed(conversation.id);
      if (opts.force) throw Errors.conflict("AI_FAILED", message);
      return failed;
    }

    const now = this.now();
    const decision = decide(written, {
      platform,
      mode: opts.force && mode === "off" ? "draft" : opts.force ? "draft" : mode,
      minConfidence: settings.minConfidence,
      autoRepliesToday: await this.repos.inbox.countAutoRepliesSince(conversation.id, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      maxAutoPerChatPerDay: settings.maxAutoPerChatPerDay,
      lastInboundAt: conversation.lastInboundAt,
      now,
    });

    await this.repos.inbox.supersedePending(conversation.id);
    const draft = await this.repos.inbox.createDraft({
      conversationId: conversation.id,
      status: decision.action === "none" ? "dismissed" : decision.action === "send" ? "sending" : "pending",
      text: written.reply,
      intent: written.intent,
      summary: written.summary,
      language: written.language,
      confidence: written.confidence,
      needsHuman: written.needs_human,
      decision: decision.reason,
      forMessageId: lastIn.id,
      model: writer.model,
    });
    await this.repos.inbox.updateConversation(conversation.id, {
      summary: written.summary.slice(0, 1000),
      lastIntent: written.intent,
      status: decision.action === "none" ? "no_reply" : decision.action === "draft" ? "draft_ready" : conversation.status,
    });

    if (decision.action === "send") await this.deliver(conversation, draft, draft.text, "ai_auto");
    this.changed(conversation.id);
    return (await this.repos.inbox.findDraft(draft.id))!;
  }

  // ---- Sending ----

  private async sendOnPlatform(c: InboxConversationRecord, text: string): Promise<{ externalId: string }> {
    if (!c.participantId) throw new ChannelError("This chat has no recipient id", false);
    if (c.platform === "telegram") {
      if (!this.opts.telegram) throw new ChannelError("Telegram is not set up (TELEGRAM_BOT_TOKEN)", false);
      return this.opts.telegram.send(c.participantId, text);
    }
    if (c.platform === "facebook" || c.platform === "instagram") {
      if (!this.opts.meta) throw new ChannelError("Facebook login is not set up (META_APP_ID / META_APP_SECRET)", false);
      if (!canReplyOnPlatform(c.platform, c.lastInboundAt, this.now())) {
        throw new ChannelError("Over 24 hours since their last message: reply in the Facebook/Instagram app instead", false);
      }
      const { account, token } = await this.opts.social.tokenFor(c.accountKey);
      let pageId = account.externalId;
      if (account.platform === "instagram") {
        try {
          pageId = (JSON.parse(account.meta) as { pageId?: string }).pageId ?? "";
        } catch {
          pageId = "";
        }
        if (!pageId) throw new ChannelError("This Instagram account has no linked Facebook Page; connect again", false);
      }
      return this.opts.meta.send(pageId, token, c.participantId, text);
    }
    throw new ChannelError("LinkedIn replies are sent from the LinkedIn Messenger extension", false);
  }

  /** Sends a draft's text and records the outcome on the draft and in the chat. */
  private async deliver(c: InboxConversationRecord, draft: InboxDraftRecord, text: string, author: "ai_auto" | "ai_approved" | "admin") {
    try {
      const sent = await this.sendOnPlatform(c, text);
      const now = this.now();
      await this.repos.inbox.addMessages(c.id, [{ direction: "out", externalId: sent.externalId, text, author, sentAt: now }]);
      await this.repos.inbox.updateDraft(draft.id, ["sending", "pending"], { status: "sent", sentAt: now, text });
      await this.repos.inbox.updateConversation(c.id, { status: "replied", lastOutboundAt: now, lastMessageAt: now });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Keep it as a draft so you can send it yourself.
      await this.repos.inbox.updateDraft(draft.id, ["sending", "pending"], { status: "pending", error: message.slice(0, 500), decision: `Could not send: ${message}`.slice(0, 500) });
      await this.repos.inbox.updateConversation(c.id, { status: "draft_ready" });
      await this.repos.agentLogs.create({ jobId: null, action: "inbox_send_failed", status: "error", message: `${c.platform} · ${c.participantName}: ${message}` });
      return false;
    }
  }

  /** You approved a draft (optionally edited). LinkedIn drafts stay queued for the extension. */
  async approve(draftId: string, text?: string) {
    const draft = await this.repos.inbox.findDraft(draftId);
    if (!draft || draft.status !== "pending") throw Errors.conflict("NOT_PENDING", "This draft is no longer waiting");
    const conversation = (await this.repos.inbox.findConversation(draft.conversationId))!;
    const finalText = (text ?? draft.text).trim();
    if (!finalText) throw Errors.badRequest("The reply is empty");
    if (conversation.platform === "linkedin") {
      await this.repos.inbox.updateDraft(draftId, ["pending"], { text: finalText, decision: "Approved: the LinkedIn Messenger extension will type it for you to send" });
      this.changed(conversation.id);
      return { sent: false, queuedForExtension: true };
    }
    if (!(await this.repos.inbox.updateDraft(draftId, ["pending"], { status: "sending" }))) throw Errors.conflict("NOT_PENDING", "This draft is no longer waiting");
    const ok = await this.deliver(conversation, { ...draft, status: "sending" }, finalText, text && text.trim() !== draft.text ? "admin" : "ai_approved");
    this.changed(conversation.id);
    const after = await this.repos.inbox.findDraft(draftId);
    if (!ok) throw Errors.conflict("SEND_FAILED", after?.error ?? "Sending failed");
    return { sent: true, queuedForExtension: false };
  }

  /** A reply you typed yourself. */
  async sendManual(conversationId: string, text: string) {
    const conversation = await this.repos.inbox.findConversation(conversationId);
    if (!conversation) throw Errors.notFound("Chat not found");
    const finalText = text.trim();
    if (!finalText) throw Errors.badRequest("The reply is empty");
    await this.repos.inbox.supersedePending(conversation.id);
    const draft = await this.repos.inbox.createDraft({
      conversationId,
      status: conversation.platform === "linkedin" ? "pending" : "sending",
      text: finalText,
      intent: null,
      summary: null,
      language: null,
      confidence: null,
      needsHuman: false,
      decision: conversation.platform === "linkedin" ? "Written by you: the extension will type it for you to send" : "Written by you",
      forMessageId: null,
      model: null,
    });
    if (conversation.platform === "linkedin") {
      this.changed(conversation.id);
      return { sent: false, queuedForExtension: true };
    }
    const ok = await this.deliver(conversation, draft, finalText, "admin");
    this.changed(conversation.id);
    if (!ok) throw Errors.conflict("SEND_FAILED", (await this.repos.inbox.findDraft(draft.id))?.error ?? "Sending failed");
    return { sent: true, queuedForExtension: false };
  }

  async dismiss(draftId: string) {
    const draft = await this.repos.inbox.findDraft(draftId);
    if (!draft || !(await this.repos.inbox.updateDraft(draftId, ["pending", "failed"], { status: "dismissed" }))) {
      throw Errors.conflict("NOT_PENDING", "This draft is no longer waiting");
    }
    await this.repos.inbox.updateConversation(draft.conversationId, { status: "handled" });
    this.changed(draft.conversationId);
  }

  async setMode(conversationId: string, mode: ReplyMode | null) {
    if (!(await this.repos.inbox.findConversation(conversationId))) throw Errors.notFound("Chat not found");
    const c = await this.repos.inbox.updateConversation(conversationId, { replyMode: mode });
    this.changed(conversationId);
    return c;
  }

  async markHandled(conversationId: string) {
    if (!(await this.repos.inbox.findConversation(conversationId))) throw Errors.notFound("Chat not found");
    await this.repos.inbox.supersedePending(conversationId);
    const c = await this.repos.inbox.updateConversation(conversationId, { status: "handled" });
    this.changed(conversationId);
    return c;
  }

  list(query: { platform?: string; status?: string; q?: string; skip: number; take: number }) {
    return this.repos.inbox.listConversations(query);
  }

  async get(conversationId: string) {
    const conversation = await this.repos.inbox.findConversation(conversationId);
    if (!conversation) throw Errors.notFound("Chat not found");
    const [messages, drafts, settings] = await Promise.all([
      this.repos.inbox.recentMessages(conversationId, 200),
      this.repos.inbox.listDrafts(conversationId, 20),
      this.repos.inbox.getSettings(),
    ]);
    const effectiveMode = (conversation.replyMode as ReplyMode | null) ?? parseModes(settings.modes)[conversation.platform as InboxPlatform];
    return {
      conversation,
      effectiveMode,
      canReplyHere: conversation.platform !== "linkedin" && canReplyOnPlatform(conversation.platform, conversation.lastInboundAt, this.now()),
      messages,
      drafts,
    };
  }

  // ---- LinkedIn (through the extension) ----

  /** The extension read these chats in your LinkedIn tab. Returns drafts ready for them. */
  async syncLinkedIn(threads: IncomingThread[]) {
    for (const t of threads) await this.ingest("linkedin", "extension", t);
    return this.repos.inbox.pendingLinkedInDrafts();
  }

  pendingLinkedIn(threadId?: string) {
    return this.repos.inbox.pendingLinkedInDrafts(threadId);
  }

  /** The extension typed a draft; you pressed Send (or skipped it). */
  async reportLinkedIn(draftId: string, status: "sent" | "skipped", sentText?: string) {
    const draft = await this.repos.inbox.findDraft(draftId);
    if (!draft) throw Errors.notFound("Draft not found");
    const conversation = (await this.repos.inbox.findConversation(draft.conversationId))!;
    if (conversation.platform !== "linkedin") throw Errors.badRequest("Not a LinkedIn draft");
    const now = this.now();
    if (status === "skipped") {
      if (!(await this.repos.inbox.updateDraft(draftId, ["pending"], { status: "dismissed", decision: "Skipped in the extension" }))) {
        throw Errors.conflict("NOT_PENDING", "This draft is no longer waiting");
      }
      await this.repos.inbox.updateConversation(conversation.id, { status: "handled" });
    } else {
      const text = (sentText ?? draft.text).trim() || draft.text;
      if (!(await this.repos.inbox.updateDraft(draftId, ["pending"], { status: "sent", sentAt: now, text }))) {
        throw Errors.conflict("NOT_PENDING", "This draft is no longer waiting");
      }
      await this.repos.inbox.addMessages(conversation.id, [{ direction: "out", externalId: `li-sent:${draftId}`, text, author: draft.model ? "ai_approved" : "admin", sentAt: now }]);
      await this.repos.inbox.updateConversation(conversation.id, { status: "replied", lastOutboundAt: now, lastMessageAt: now });
    }
    this.changed(conversation.id);
    return (await this.repos.inbox.findDraft(draftId))!;
  }
}
