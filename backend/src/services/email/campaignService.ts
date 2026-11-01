import { ownerScope } from "../../database/ownerScope.js";
import type { CampaignRecord, Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import type { EventBus } from "../events.js";
import { CampaignLifecycle, type CampaignInput, type RecipientSelection } from "../outreach/campaignLifecycle.js";
import { emailAddress, suppressedSet } from "../outreach/preferenceService.js";
import { isPublicUrl } from "./unsubscribe.js";

export { MAX_CAMPAIGN_RECIPIENTS, type CampaignInput, type RecipientSelection } from "../outreach/campaignLifecycle.js";

export interface RecipientSummary {
  selected: number;
  eligible: number;
  skipped: { noEmail: number; optedOut: number; duplicateEmail: number };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class CampaignService extends CampaignLifecycle {
  protected readonly noun = "emails";

  constructor(
    repos: Repositories,
    private readonly opts: {
      provider: string;
      timeZone: string;
      publicBaseUrl: string | null;
      bus?: EventBus;
      /** The owner's sender (phase C: customers use their own); default: `provider` for everyone */
      senderFor?: (ownerId: string | null | undefined) => Promise<{ name: string } | null>;
    },
  ) {
    super(repos, "email", opts.bus);
  }

  /** Provider name for campaigns of this owner, or null when they have no sender connected. */
  private async providerOf(ownerId: string | null | undefined): Promise<string | null> {
    return this.opts.senderFor ? ((await this.opts.senderFor(ownerId))?.name ?? null) : this.opts.provider;
  }

  /** Who would receive the campaign: leads without an email, opted-out leads and repeated addresses are left out. */
  async recipients(selection: RecipientSelection): Promise<{ summary: RecipientSummary; eligible: { leadId: string; email: string }[] }> {
    const leads = await this.selectLeads(selection);
    const prefs = new Map((await this.repos.preferences.findMany(leads.map((l) => l.id))).map((p) => [p.leadId, p]));
    const suppressed = await suppressedSet(this.repos, "email", leads.flatMap((l) => emailAddress(l.email) ?? []));
    const summary: RecipientSummary = { selected: leads.length, eligible: 0, skipped: { noEmail: 0, optedOut: 0, duplicateEmail: 0 } };
    const seen = new Set<string>();
    const eligible: { leadId: string; email: string }[] = [];
    for (const lead of leads) {
      const email = lead.email?.trim().toLowerCase();
      const pref = prefs.get(lead.id);
      if (!email || !EMAIL.test(email)) summary.skipped.noEmail++;
      else if ((pref && (pref.optedOut || !pref.emailAllowed)) || suppressed.has(email)) summary.skipped.optedOut++;
      else if (seen.has(email)) summary.skipped.duplicateEmail++;
      else {
        seen.add(email);
        eligible.push({ leadId: lead.id, email });
      }
    }
    summary.eligible = eligible.length;
    return { summary, eligible };
  }

  async create(input: CampaignInput, adminId: string | null) {
    this.validateSchedule(input);
    const template = await this.repos.templates.findById(input.templateId);
    if (!template || template.channel !== "email") throw Errors.badRequest("Template not found");
    const { summary, eligible } = await this.recipients(input.recipients);
    if (eligible.length === 0) throw Errors.badRequest("None of the selected leads can be emailed (no email address or opted out)");

    // Recorded now; a customer without a sender yet can still prepare the campaign.
    const provider = (await this.providerOf(ownerScope.getStore()?.userId)) ?? "none";
    const campaign = await this.repos.transaction(async (tx) => {
      const c = await tx.campaigns.create({
        channel: "email",
        name: input.name,
        templateId: template.id,
        provider,
        intervalSec: input.intervalSec,
        dailyLimit: input.dailyLimit,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone: this.opts.timeZone,
        startAt: input.startAt ?? null,
        createdById: adminId,
      });
      await tx.attempts.createMany(
        eligible.map((r) => ({ leadId: r.leadId, campaignId: c.id, channel: "email", provider, templateId: template.id, toAddress: r.email })),
      );
      await tx.agentLogs.create({ jobId: null, action: "email_campaign_created", status: "info", message: `"${c.name}": ${summary.eligible} recipients` });
      return c;
    });
    return { campaign: this.changed(campaign), summary };
  }

  /** Everything sent (or queued) to one lead on any channel, newest first, plus its consent settings. */
  async leadHistory(leadId: string) {
    if (!(await this.repos.leads.findById(leadId))) throw Errors.notFound("Lead not found");
    const [{ items }, preference, events, whatsappEvents] = await Promise.all([
      this.repos.attempts.list({ leadId, skip: 0, take: 200 }),
      this.repos.preferences.find(leadId),
      this.repos.emailEvents.listByLead(leadId, 500),
      this.repos.whatsappEvents.listByLead(leadId, 500),
    ]);
    const parse = <T extends { metadata: string | null }>(e: T) => ({ ...e, metadata: e.metadata ? (JSON.parse(e.metadata) as unknown) : null });
    return { attempts: items, preference, events: events.map(parse), whatsappEvents: whatsappEvents.map(parse) };
  }

  protected override async checkCanStart(campaign: CampaignRecord) {
    const provider = await this.providerOf(campaign.ownerId);
    if (!provider) throw Errors.conflict("SENDER_REQUIRED", "Connect your email sender (My sender page) before starting a campaign");
    if (provider !== campaign.provider) {
      throw Errors.conflict("PROVIDER_CHANGED", `This campaign was created for "${campaign.provider}" but your sender now uses "${provider}". Create a new campaign.`);
    }
    if (provider !== "log" && !(this.opts.publicBaseUrl && isPublicUrl(this.opts.publicBaseUrl))) {
      throw Errors.conflict(
        "PUBLIC_URL_REQUIRED",
        "Set PUBLIC_BASE_URL in backend/.env to the public https address of this backend, so recipients can open the unsubscribe link",
      );
    }
  }
}
