// Background sender for WhatsApp campaigns (pacing, claiming and crash recovery are in
// CampaignWorker). Right before each message it re-checks the opt-in and the template's
// approval, and it pauses the whole campaign on errors that would hit every recipient.

import type { AttemptRecord, CampaignRecord, Repositories } from "../database/repositories/index.js";
import { WhatsAppProviderError, type WhatsAppProvider } from "../providers/whatsapp/index.js";
import { leadTemplateData } from "../services/email/render.js";
import { whatsappConsent } from "../services/whatsapp/consent.js";
import { SETUP_ERROR_CODES, STOPPED_MARKETING } from "../services/whatsapp/errors.js";
import { recordWhatsAppOptOut } from "../services/whatsapp/trackingService.js";
import { renderWhatsApp } from "../services/whatsapp/templateParams.js";
import { CampaignWorker, type CampaignWorkerOptions, type StepResult } from "./campaignWorker.js";

export class WhatsAppWorker extends CampaignWorker {
  constructor(
    repos: Repositories,
    private readonly provider: WhatsAppProvider | ((campaign: CampaignRecord) => Promise<WhatsAppProvider | null>),
    opts: CampaignWorkerOptions = {},
  ) {
    super(repos, "whatsapp", opts);
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
    if (template.approvalStatus !== "approved") {
      return this.pauseForSetup(campaign, attempt, `Template "${template.name}" is no longer marked approved (${template.approvalStatus ?? "no status"})`);
    }
    const provider = typeof this.provider === "function" ? await this.provider(campaign) : this.provider;
    if (!provider) return this.pauseForSetup(campaign, attempt, "No WhatsApp sender connected for this account");
    if (campaign.provider !== provider.name) {
      return this.pauseForSetup(campaign, attempt, `Created for provider "${campaign.provider}", but the sender now uses "${provider.name}"`);
    }
    const suppressed = (await this.repos.suppressions.findByAddresses("whatsapp", [attempt.toAddress])).length > 0;
    const consent = suppressed ? "opted_out" : whatsappConsent(pref);
    if (consent !== "allowed") {
      const error = consent === "no_opt_in" ? "No WhatsApp opt-in recorded" : "Lead opted out of WhatsApp before sending";
      await this.repos.attempts.update(attempt.id, { status: "skipped", error });
      return "skipped";
    }

    const rendered = renderWhatsApp(template, leadTemplateData(lead));
    if (rendered.missing.length) {
      const vars = rendered.missing.map((v) => `{{${v}}}`).join(", ");
      await this.repos.attempts.update(attempt.id, { status: "skipped", error: `No value for ${vars} (add it to the lead or a fallback to the template)` });
      return "skipped";
    }

    try {
      const { externalMessageId } = await provider.sendTemplate({
        to: attempt.toAddress.replace(/^\+/, ""),
        templateName: template.name,
        language: template.language ?? "en",
        bodyParams: rendered.params,
        callbackData: attempt.id,
      });
      const data = { externalMessageId, sentAt: now, renderedBody: rendered.text, tries: attempt.tries + 1, error: null };
      if (!(await this.repos.attempts.advanceStatus(attempt.id, ["sending"], { status: "sent", ...data }))) {
        // A status webhook (matched by the attempt id we passed as callback data) got here first.
        await this.repos.attempts.update(attempt.id, data);
      }
      return "sent";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof WhatsAppProviderError) {
        if (err.status === 401 || (err.code !== undefined && SETUP_ERROR_CODES.has(err.code))) {
          return this.pauseForSetup(campaign, attempt, message);
        }
        if (err.code === STOPPED_MARKETING) {
          await recordWhatsAppOptOut(
            this.repos,
            { leadId: lead.id, phone: attempt.toAddress, attemptId: attempt.id, reason: "Stopped marketing messages from this business (131050)", provider: provider.name, source: "whatsapp_error", occurredAt: now },
            this.base.bus,
          );
          await this.repos.attempts.update(attempt.id, { status: "failed", tries: attempt.tries + 1, error: message, failedAt: now });
          return "failed";
        }
      }
      return this.retryOrFail(attempt, now, message, err instanceof WhatsAppProviderError ? err.retryable : false);
    }
  }
}
