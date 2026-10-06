import { randomBytes } from "node:crypto";
import type { AttemptRecord, EmailEventType, Repositories, TrackedField } from "../../database/repositories/index.js";
import type { NormalizedEmailEvent } from "../../providers/email/index.js";
import { Errors } from "../../utils/errors.js";
import type { EventBus } from "../events.js";
import { suppressLead } from "../outreach/preferenceService.js";

// Records email tracking events from provider webhooks, our own click redirects,
// replies logged by the admin, and unsubscribes. Deterministic; no guessing.
//
// Notes on accuracy (shown in the UI too):
// - opens are approximate: mail apps block, proxy or pre-load tracking images;
// - clicks can include security scanners that open links automatically.

const FIRST_SEEN: Partial<Record<EmailEventType, TrackedField>> = {
  delivered: "deliveredAt",
  opened: "openedAt",
  clicked: "clickedAt",
  bounced: "bouncedAt",
  complained: "complainedAt",
  replied: "repliedAt",
};

export interface WebhookResult {
  received: number;
  recorded: number;
  duplicates: number;
  unmatched: number;
}

/** Rewrites http(s) links in the HTML part to /t/c/<id> redirects, except `keep` (e.g. the unsubscribe link). */
export function rewriteLinks(html: string, baseUrl: string, keep: string[]): { html: string; links: { id: string; url: string }[] } {
  const ids = new Map<string, string>();
  const out = html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url: string) => {
    const real = url.replace(/&amp;/g, "&");
    if (keep.includes(real)) return match;
    let id = ids.get(real);
    if (!id) {
      id = randomBytes(12).toString("base64url");
      ids.set(real, id);
    }
    return `href="${baseUrl.replace(/\/+$/, "")}/t/c/${id}"`;
  });
  return { html: out, links: [...ids].map(([url, id]) => ({ id, url })) };
}

export class TrackingService {
  constructor(
    private readonly repos: Repositories,
    private readonly bus?: EventBus,
  ) {}

  private async record(
    attempt: AttemptRecord | null,
    leadId: string | null,
    type: EmailEventType,
    occurredAt: Date,
    source: string,
    metadata: Record<string, unknown> | null,
    providerEventId: string | null = null,
  ): Promise<boolean> {
    const event = await this.repos.emailEvents.create({
      type,
      attemptId: attempt?.id ?? null,
      leadId: attempt?.leadId ?? leadId,
      providerEventId,
      source,
      metadata: metadata ? JSON.stringify(metadata).slice(0, 8000) : null,
      occurredAt,
    });
    if (!event) return false; // duplicate webhook
    if (type === "replied") this.bus?.publish({ type: "reply.received", channel: "email", eventId: event.id });

    if (attempt) {
      const field = FIRST_SEEN[type];
      if (field) await this.repos.attempts.markFirst(attempt.id, field, occurredAt);
      if (type === "delivered" && attempt.status === "sent") await this.repos.attempts.update(attempt.id, { status: "delivered" });
      if (type === "bounced" || type === "failed") {
        const reason = (metadata?.bounce as { message?: string } | undefined)?.message ?? (type === "bounced" ? "Bounced" : "Provider reported a failure");
        await this.repos.attempts.update(attempt.id, { status: "failed", failedAt: attempt.failedAt ?? occurredAt, error: String(reason).slice(0, 500) });
      }
      if (attempt.campaignId) this.bus?.publish({ type: "campaign.updated", campaignId: attempt.campaignId, status: "tracking" });
    }
    const lead = attempt?.leadId ?? leadId;
    // A spam complaint means: never email this person again.
    if (type === "complained" && lead) {
      await this.repos.preferences.upsert(lead, { emailAllowed: false, optOutReason: "spam_complaint", optedOutAt: occurredAt });
      const record = await this.repos.leads.findById(lead);
      if (record) await suppressLead(this.repos, record, "email", { reason: "Marked an email as spam", source: "spam_complaint" }, this.bus);
    }
    if (lead) this.bus?.publish({ type: "lead.updated", leadId: lead });
    return true;
  }

  /** Events from a verified provider webhook. */
  async applyProviderEvents(events: NormalizedEmailEvent[], provider: string): Promise<WebhookResult> {
    const result: WebhookResult = { received: events.length, recorded: 0, duplicates: 0, unmatched: 0 };
    for (const e of events) {
      const attempt = await this.repos.attempts.findByExternalId(e.externalMessageId);
      if (!attempt) {
        result.unmatched++; // e.g. a test email or a message sent outside this app
        continue;
      }
      const stored = await this.record(attempt, null, e.type, e.occurredAt, provider, e.metadata, e.providerEventId);
      if (stored) result.recorded++;
      else result.duplicates++;
    }
    return result;
  }

  /** Our click redirect: returns where to send the visitor, or null for an unknown link. */
  async click(linkId: string, userAgent: string | undefined, at = new Date()): Promise<string | null> {
    const link = await this.repos.trackedLinks.findById(linkId);
    if (!link) return null;
    const attempt = await this.repos.attempts.findById(link.attemptId);
    if (attempt) await this.record(attempt, null, "clicked", at, "click_tracking", { link: link.url, userAgent: userAgent?.slice(0, 300) ?? null });
    return link.url;
  }

  /** A reply the admin saw in their inbox (until inbound email / IMAP is connected). */
  async logReply(attemptId: string, message: string, at = new Date()) {
    const attempt = await this.repos.attempts.findById(attemptId);
    if (!attempt) throw Errors.notFound("Email not found");
    if (!attempt.sentAt) throw Errors.conflict("NOT_SENT", "This email was not sent, so it cannot have a reply");
    await this.record(attempt, null, "replied", at, "admin", { message });
  }

  async unsubscribed(leadId: string, at = new Date()) {
    await this.record(null, leadId, "unsubscribed", at, "unsubscribe_link", null);
  }

  async leadEvents(leadId: string) {
    return (await this.repos.emailEvents.listByLead(leadId, 500)).map((e) => ({ ...e, metadata: e.metadata ? (JSON.parse(e.metadata) as unknown) : null }));
  }
}
