// Background sender for email campaigns (pacing, claiming and crash recovery are in
// CampaignWorker). Consent is re-checked right before each email.

import type { AttemptRecord, CampaignRecord, Repositories } from "../database/repositories/index.js";
import { EmailProviderError, type EmailProvider } from "../providers/email/index.js";
import { leadTemplateData, renderEmail } from "../services/email/render.js";
import { rewriteLinks } from "../services/email/trackingService.js";
import { unsubscribeUrl } from "../services/email/unsubscribe.js";
import { CampaignWorker, type CampaignWorkerOptions, type StepResult } from "./campaignWorker.js";

export type { StepResult } from "./campaignWorker.js";

export interface EmailWorkerOptions extends CampaignWorkerOptions {
  /** Base URL used in unsubscribe links. */
  baseUrl: string;
  /** Secret that signs unsubscribe links. */
  unsubscribeSecret: string;
  /** Route links through /t/c/:id to count clicks (the visible link text stays the real URL). */
  trackClicks?: boolean;
}

export class EmailWorker extends CampaignWorker {
  constructor(
    repos: Repositories,
    private readonly provider: EmailProvider,
    private readonly opts: EmailWorkerOptions,
  ) {
    super(repos, "email", opts);
  }

  protected async send(campaign: CampaignRecord, attempt: AttemptRecord, now: Date): Promise<StepResult> {
    const [lead, pref, template] = await Promise.all([
      this.repos.leads.findById(attempt.leadId),
      this.repos.preferences.find(attempt.leadId),
      attempt.templateId ? this.repos.templates.findById(attempt.templateId) : null,
    ]);
    if (!lead || !template) {
      await this.repos.attempts.update(attempt.id, { status: "skipped", error: !lead ? "Lead was deleted" : "Template was deleted" });
      return "skipped";
    }
    const suppressed = (await this.repos.suppressions.findByAddresses("email", [attempt.toAddress.toLowerCase()])).length > 0;
    if ((pref && (pref.optedOut || !pref.emailAllowed)) || suppressed) {
      await this.repos.attempts.update(attempt.id, { status: "skipped", error: "Lead unsubscribed / opted out before sending" });
      return "skipped";
    }

    const unsubscribe = unsubscribeUrl(this.opts.baseUrl, this.opts.unsubscribeSecret, lead.id);
    const rendered = renderEmail({ subject: template.subject ?? "", body: template.body }, leadTemplateData(lead), { unsubscribeUrl: unsubscribe });
    if (this.opts.trackClicks) {
      const tracked = rewriteLinks(rendered.html, this.opts.baseUrl, [unsubscribe]);
      await this.repos.trackedLinks.createMany(tracked.links.map((l) => ({ ...l, attemptId: attempt.id })));
      rendered.html = tracked.html;
    }

    try {
      const { externalMessageId } = await this.provider.sendEmail({
        to: attempt.toAddress,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        headers: {
          "List-Unsubscribe": `<${unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: { attempt: attempt.id, campaign: campaign.id },
        idempotencyKey: `attempt-${attempt.id}`,
      });
      await this.repos.attempts.update(attempt.id, {
        status: "sent",
        externalMessageId,
        sentAt: now,
        renderedSubject: rendered.subject,
        renderedBody: rendered.text,
        tries: attempt.tries + 1,
        error: null,
      });
      return "sent";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.retryOrFail(attempt, now, message, err instanceof EmailProviderError ? err.retryable : false);
    }
  }
}
