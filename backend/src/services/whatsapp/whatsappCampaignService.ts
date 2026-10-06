import type { CampaignRecord, LeadRecord, Repositories, TemplateRecord } from "../../database/repositories/index.js";
import { toWhatsAppNumber } from "../../providers/whatsapp/index.js";
import { Errors } from "../../utils/errors.js";
import { leadTemplateData } from "../email/render.js";
import type { EventBus } from "../events.js";
import { CampaignLifecycle, type CampaignInput, type RecipientSelection } from "../outreach/campaignLifecycle.js";
import { suppressedSet } from "../outreach/preferenceService.js";
import { whatsappConsent } from "./consent.js";
import { renderWhatsApp } from "./templateParams.js";

export interface WhatsAppRecipientSummary {
  selected: number;
  eligible: number;
  skipped: { noPhone: number; noOptIn: number; optedOut: number; duplicatePhone: number; missingValue: number };
}

/** Lead → "+918957926677", or null when the number cannot be a WhatsApp user. */
export function whatsappAddress(lead: Pick<LeadRecord, "normalizedPhone" | "phone">): string | null {
  const digits = toWhatsAppNumber(lead.normalizedPhone ?? lead.phone);
  return digits ? `+${digits}` : null;
}

export class WhatsAppCampaignService extends CampaignLifecycle {
  protected readonly noun = "WhatsApp messages";

  constructor(
    repos: Repositories,
    private readonly opts: { provider: string; timeZone: string; bus?: EventBus },
  ) {
    super(repos, "whatsapp", opts.bus);
  }

  private async approvedTemplate(id: string): Promise<TemplateRecord> {
    const template = await this.repos.templates.findById(id);
    if (!template || template.channel !== "whatsapp") throw Errors.badRequest("Template not found");
    if (template.approvalStatus !== "approved") {
      throw Errors.conflict(
        "TEMPLATE_NOT_APPROVED",
        `Template "${template.name}" is ${template.approvalStatus ?? "not marked approved"}. WhatsApp only delivers templates approved in WhatsApp Manager; mark it approved once Meta has approved it.`,
      );
    }
    return template;
  }

  /**
   * Who would receive the campaign. Only leads with a recorded WhatsApp opt-in qualify; also
   * left out: no usable mobile number, opted out, repeated number, and (when a template is
   * given) a variable with neither a value nor a fallback.
   */
  async recipients(selection: RecipientSelection, template?: TemplateRecord | null) {
    const leads = await this.selectLeads(selection);
    const prefs = new Map((await this.repos.preferences.findMany(leads.map((l) => l.id))).map((p) => [p.leadId, p]));
    const suppressed = await suppressedSet(this.repos, "whatsapp", leads.flatMap((l) => whatsappAddress(l) ?? []));
    const summary: WhatsAppRecipientSummary = {
      selected: leads.length,
      eligible: 0,
      skipped: { noPhone: 0, noOptIn: 0, optedOut: 0, duplicatePhone: 0, missingValue: 0 },
    };
    const seen = new Set<string>();
    const eligible: { leadId: string; phone: string }[] = [];
    for (const lead of leads) {
      const phone = whatsappAddress(lead);
      const consent = whatsappConsent(prefs.get(lead.id));
      if (!phone) summary.skipped.noPhone++;
      else if (consent === "opted_out" || suppressed.has(phone)) summary.skipped.optedOut++;
      else if (consent === "no_opt_in") summary.skipped.noOptIn++;
      else if (seen.has(phone)) summary.skipped.duplicatePhone++;
      else if (template && renderWhatsApp(template, leadTemplateData(lead)).missing.length) summary.skipped.missingValue++;
      else {
        seen.add(phone);
        eligible.push({ leadId: lead.id, phone });
      }
    }
    summary.eligible = eligible.length;
    return { summary, eligible };
  }

  async recipientSummary(selection: RecipientSelection, templateId?: string) {
    const template = templateId ? await this.repos.templates.findById(templateId) : null;
    return (await this.recipients(selection, template?.channel === "whatsapp" ? template : null)).summary;
  }

  async create(input: CampaignInput, adminId: string | null) {
    this.validateSchedule(input);
    const template = await this.approvedTemplate(input.templateId);
    const { summary, eligible } = await this.recipients(input.recipients, template);
    if (eligible.length === 0) {
      throw Errors.badRequest("None of the selected leads can get this WhatsApp message (no recorded opt-in, no mobile number, or opted out)");
    }

    const campaign = await this.repos.transaction(async (tx) => {
      const c = await tx.campaigns.create({
        channel: "whatsapp",
        name: input.name,
        templateId: template.id,
        provider: this.opts.provider,
        intervalSec: input.intervalSec,
        dailyLimit: input.dailyLimit,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone: this.opts.timeZone,
        startAt: input.startAt ?? null,
        createdById: adminId,
      });
      await tx.attempts.createMany(
        eligible.map((r) => ({ leadId: r.leadId, campaignId: c.id, channel: "whatsapp", provider: this.opts.provider, templateId: template.id, toAddress: r.phone })),
      );
      await tx.agentLogs.create({ jobId: null, action: "whatsapp_campaign_created", status: "info", message: `"${c.name}": ${summary.eligible} recipients` });
      return c;
    });
    return { campaign: this.changed(campaign), summary };
  }

  protected override async checkCanStart(campaign: CampaignRecord) {
    await this.approvedTemplate(campaign.templateId);
    if (campaign.provider !== this.opts.provider) {
      throw Errors.conflict(
        "PROVIDER_CHANGED",
        `This campaign was created for "${campaign.provider}" but the backend now uses "${this.opts.provider}". Create a new campaign.`,
      );
    }
  }
}
