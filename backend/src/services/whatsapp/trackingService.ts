// WhatsApp webhook events → stored events, attempt statuses, replies and opt-outs.
// Deterministic rules only. Nothing is ever sent back automatically: replies are stored for
// the admin to read and answer from WhatsApp itself.

import type { AttemptRecord, Repositories, WhatsAppEventType } from "../../database/repositories/index.js";
import type { WhatsAppEvent } from "../../providers/whatsapp/index.js";
import type { EventBus } from "../events.js";
import { addSuppressions, phoneAddress, suppressLead } from "../outreach/preferenceService.js";
import { SETUP_ERROR_CODES, STOPPED_MARKETING } from "./errors.js";

/** Whole-message replies treated as "stop messaging me" (case and punctuation ignored). */
export const STOP_KEYWORDS = new Set(["stop", "stop all", "stop messages", "stop promotions", "unsubscribe", "opt out", "optout", "opt-out"]);

export function isStopMessage(text: string | null): boolean {
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return STOP_KEYWORDS.has(normalized);
}

export interface OptOutInput {
  leadId: string | null;
  phone: string | null;
  attemptId?: string | null;
  reason: string;
  /** meta (WhatsApp told us), keyword (STOP reply), admin */
  provider: string;
  /** Suppression source: stop_reply, whatsapp_stop, whatsapp_error, admin (derived from provider when omitted) */
  source?: string;
  providerEventId?: string | null;
  occurredAt: Date;
}

/**
 * Withdraws the lead's WhatsApp opt-in and records why. Returns false when this exact event
 * was already handled (webhook retry).
 */
export async function recordWhatsAppOptOut(repos: Repositories, input: OptOutInput, bus?: EventBus): Promise<boolean> {
  const stored = await repos.whatsappEvents.create({
    type: "opted_out",
    attemptId: input.attemptId ?? null,
    leadId: input.leadId,
    phone: input.phone,
    providerEventId: input.providerEventId ?? null,
    externalMessageId: null,
    provider: input.provider,
    text: null,
    metadata: JSON.stringify({ reason: input.reason }),
    occurredAt: input.occurredAt,
  });
  if (!stored) return false;
  // The number itself is suppressed even when no lead matches (it may be collected later).
  const source = input.source ?? (input.provider === "keyword" ? "stop_reply" : input.provider === "admin" ? "admin" : "whatsapp_stop");
  const phone = phoneAddress(input.phone);
  if (phone) await addSuppressions(repos, [{ channel: "whatsapp", address: phone, reason: input.reason, source, leadId: input.leadId }], bus);
  if (input.leadId) {
    const lead = await repos.leads.findById(input.leadId);
    if (lead) await suppressLead(repos, lead, "whatsapp", { reason: input.reason, source }, bus);
    await repos.preferences.upsert(input.leadId, { whatsappAllowed: false });
    bus?.publish({ type: "lead.updated", leadId: input.leadId });
  }
  await repos.agentLogs.create({
    jobId: null,
    action: "whatsapp_opt_out",
    status: "warning",
    message: `${input.phone ?? "unknown number"}${input.leadId ? "" : " (no matching lead)"}: ${input.reason}`,
  });
  return true;
}

export class WhatsAppTrackingService {
  constructor(
    private readonly repos: Repositories,
    private readonly providerName: string,
    private readonly bus?: EventBus,
  ) {}

  /** Handles verified webhook events; returns how many were new (retries count as 0). */
  async handle(events: WhatsAppEvent[]): Promise<number> {
    let handled = 0;
    for (const event of events) {
      const isNew =
        event.kind === "status" ? await this.status(event) : event.kind === "inbound" ? await this.inbound(event) : await this.preference(event);
      if (isNew) handled++;
    }
    return handled;
  }

  /** The message an event is about: by WhatsApp message id, or by our attempt id (callback data) when the webhook beat our own save. */
  private async attemptFor(externalMessageId: string, callbackData: string | null): Promise<AttemptRecord | null> {
    const byExternal = await this.repos.attempts.findByExternalId(externalMessageId);
    if (byExternal) return byExternal.channel === "whatsapp" ? byExternal : null;
    if (!callbackData) return null;
    const byId = await this.repos.attempts.findById(callbackData);
    if (byId?.channel === "whatsapp" && (byId.externalMessageId === null || byId.externalMessageId === externalMessageId)) return byId;
    return null;
  }

  /** Lead and message behind a number: the last message we sent it, else a lead with that phone. */
  private async matchNumber(phone: string, replyTo: string | null) {
    let attempt = replyTo ? await this.repos.attempts.findByExternalId(replyTo) : null;
    if (attempt?.channel !== "whatsapp") attempt = null;
    attempt ??= await this.repos.attempts.findLatestWhatsAppTo(phone);
    const leadId = attempt?.leadId ?? (await this.repos.leads.findByNormalizedPhone(phone))[0]?.id ?? null;
    return { attempt, leadId };
  }

  private changed(attempt: AttemptRecord | null, leadId: string | null) {
    if (attempt?.campaignId) this.bus?.publish({ type: "campaign.updated", campaignId: attempt.campaignId, status: "tracking" });
    if (leadId) this.bus?.publish({ type: "lead.updated", leadId });
  }

  private async status(e: Extract<WhatsAppEvent, { kind: "status" }>): Promise<boolean> {
    const attempt = await this.attemptFor(e.externalMessageId, e.callbackData);
    if (!attempt) return false; // a test message or one sent outside this app
    const stored = await this.repos.whatsappEvents.create({
      type: e.status as WhatsAppEventType,
      attemptId: attempt.id,
      leadId: attempt.leadId,
      phone: attempt.toAddress,
      providerEventId: e.providerEventId,
      externalMessageId: e.externalMessageId,
      provider: this.providerName,
      text: null,
      metadata: e.error ? JSON.stringify({ error: e.error, code: e.errorCode }) : null,
      occurredAt: e.occurredAt,
    });
    if (!stored) return false;

    // "sending" is included: the webhook can arrive before our own write after the send.
    if (e.status === "delivered" || e.status === "read") {
      await this.repos.attempts.markFirst(attempt.id, "deliveredAt", e.occurredAt); // read implies delivered
      if (e.status === "read") await this.repos.attempts.markFirst(attempt.id, "readAt", e.occurredAt);
      await this.repos.attempts.advanceStatus(attempt.id, ["sending", "sent"], { status: "delivered" });
    } else if (e.status === "failed") {
      await this.repos.attempts.advanceStatus(attempt.id, ["sending", "sent", "delivered"], {
        status: "failed",
        failedAt: e.occurredAt,
        error: e.error ?? "Failed (no reason given by WhatsApp)",
      });
      if (e.errorCode === STOPPED_MARKETING) {
        await recordWhatsAppOptOut(
          this.repos,
          { leadId: attempt.leadId, phone: attempt.toAddress, attemptId: attempt.id, reason: "Stopped marketing messages from this business (131050)", provider: this.providerName, source: "whatsapp_error", occurredAt: e.occurredAt },
          this.bus,
        );
      } else if (e.errorCode !== null && SETUP_ERROR_CODES.has(e.errorCode) && attempt.campaignId) {
        await this.pauseCampaign(attempt.campaignId, `WhatsApp reported: ${e.error}`);
      }
    }
    this.changed(attempt, attempt.leadId);
    return true;
  }

  /** The same account/template problem would fail every following message. */
  private async pauseCampaign(campaignId: string, reason: string) {
    const paused = await this.repos.campaigns.updateStatus(campaignId, ["running"], { status: "paused", statusReason: reason.slice(0, 500) });
    if (!paused) return;
    await this.repos.agentLogs.create({ jobId: null, action: "whatsapp_campaign_paused", status: "error", message: `"${paused.name}": ${reason}` });
    this.bus?.publish({ type: "campaign.updated", campaignId, status: paused.status });
  }

  private async inbound(e: Extract<WhatsAppEvent, { kind: "inbound" }>): Promise<boolean> {
    const phone = `+${e.from}`;
    const { attempt, leadId } = await this.matchNumber(phone, e.inReplyTo);
    const stored = await this.repos.whatsappEvents.create({
      type: "received",
      attemptId: attempt?.id ?? null,
      leadId,
      phone,
      providerEventId: e.providerEventId,
      externalMessageId: e.providerEventId,
      provider: this.providerName,
      text: e.text,
      metadata: JSON.stringify({ messageType: e.messageType, profileName: e.profileName, inReplyTo: e.inReplyTo }),
      occurredAt: e.occurredAt,
    });
    if (!stored) return false;
    if (attempt) await this.repos.attempts.markFirst(attempt.id, "repliedAt", e.occurredAt);
    this.bus?.publish({ type: "reply.received", channel: "whatsapp", eventId: stored.id });
    if (isStopMessage(e.text)) {
      await recordWhatsAppOptOut(
        this.repos,
        { leadId, phone, attemptId: attempt?.id ?? null, reason: `Replied "${e.text!.trim().slice(0, 40)}"`, provider: "keyword", occurredAt: e.occurredAt },
        this.bus,
      );
    }
    this.changed(attempt, leadId);
    return true;
  }

  private async preference(e: Extract<WhatsAppEvent, { kind: "preference" }>): Promise<boolean> {
    const phone = `+${e.waId}`;
    const { attempt, leadId } = await this.matchNumber(phone, null);
    if (e.value === "stop") {
      return recordWhatsAppOptOut(
        this.repos,
        { leadId, phone, reason: "Stopped marketing messages in WhatsApp", provider: this.providerName, providerEventId: e.providerEventId, occurredAt: e.occurredAt },
        this.bus,
      );
    }
    // Resuming in WhatsApp is recorded, but the opt-in is not restored automatically:
    // the admin records a new opt-in if the person wants messages again.
    const stored = await this.repos.whatsappEvents.create({
      type: "marketing_resumed",
      attemptId: null,
      leadId,
      phone,
      providerEventId: e.providerEventId,
      externalMessageId: null,
      provider: this.providerName,
      text: null,
      metadata: null,
      occurredAt: e.occurredAt,
    });
    if (stored) this.changed(attempt, leadId);
    return !!stored;
  }
}
