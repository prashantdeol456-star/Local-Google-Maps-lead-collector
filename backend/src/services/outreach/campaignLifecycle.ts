// Campaign lifecycle shared by email and WhatsApp: listing, details, start / pause / stop.
// What differs per channel (who may receive it, what must be set up before starting) lives
// in the channel's own service.

import type { AttemptStatus, CampaignRecord, Channel, LeadRecord, Repositories } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { startOfDayInZone } from "../../utils/time.js";
import type { ExportFilters } from "../export/exportService.js";
import type { EventBus } from "../events.js";
import { decideSend, parseClock } from "../email/pacing.js";

export const MAX_CAMPAIGN_RECIPIENTS = 5000;

export type RecipientSelection = { leadIds: string[] } | { filters: Omit<ExportFilters, "sort" | "order"> };

export interface CampaignInput {
  name: string;
  templateId: string;
  recipients: RecipientSelection;
  intervalSec: number;
  dailyLimit: number;
  windowStart: string;
  windowEnd: string;
  startAt?: Date | null;
}

export abstract class CampaignLifecycle {
  /** "emails" / "WhatsApp messages", used in messages shown to the admin. */
  protected abstract readonly noun: string;

  constructor(
    protected readonly repos: Repositories,
    protected readonly channel: Channel,
    protected readonly bus?: EventBus,
  ) {}

  /** Throws when the campaign must not start yet (missing setup). */
  protected async checkCanStart(_campaign: CampaignRecord): Promise<void> {}

  protected changed(c: CampaignRecord) {
    this.bus?.publish({ type: "campaign.updated", campaignId: c.id, status: c.status });
    return c;
  }

  protected log(action: string, status: "info" | "success" | "warning" | "error", message: string) {
    return this.repos.agentLogs.create({ jobId: null, action: `${this.channel}_campaign_${action}`, status, message });
  }

  protected async selectLeads(selection: RecipientSelection): Promise<LeadRecord[]> {
    let leads: LeadRecord[];
    if ("leadIds" in selection) {
      leads = await this.repos.leads.findByIds([...new Set(selection.leadIds)]);
    } else {
      leads = [];
      const createdBefore = new Date();
      for (let skip = 0; leads.length <= MAX_CAMPAIGN_RECIPIENTS; skip += 500) {
        const { items } = await this.repos.leads.list({ ...selection.filters, sort: "createdAt", order: "asc", createdBefore, skip, take: 500 });
        leads.push(...items);
        if (items.length < 500) break;
      }
    }
    if (leads.length > MAX_CAMPAIGN_RECIPIENTS) {
      throw Errors.badRequest(`At most ${MAX_CAMPAIGN_RECIPIENTS} recipients per campaign; narrow the filters`);
    }
    return leads;
  }

  protected validateSchedule(input: Pick<CampaignInput, "windowStart" | "windowEnd">) {
    const start = parseClock(input.windowStart);
    const end = parseClock(input.windowEnd);
    if (start === null || end === null) throw Errors.badRequest("Sending window must use HH:MM (24h)");
    if (start === end) throw Errors.badRequest("Sending window start and end must differ");
  }

  list(page: { skip: number; take: number }) {
    return this.repos.campaigns.list({ channel: this.channel, ...page });
  }

  async get(id: string, now = new Date()) {
    const campaign = await this.repos.campaigns.findById(id);
    if (!campaign || campaign.channel !== this.channel) throw Errors.notFound("Campaign not found");
    const [counts, tracking, sentToday, template] = await Promise.all([
      this.repos.attempts.countByStatus(id),
      this.repos.attempts.trackingCounts(id),
      this.repos.attempts.countSentSince(id, startOfDayInZone(now, campaign.timeZone)),
      this.repos.templates.findById(campaign.templateId),
    ]);
    let nextSendAt: Date | null = null;
    let waitingFor: string | null = null;
    if (campaign.status === "running" && (counts.queued ?? 0) > 0) {
      const decision = decideSend(now, { ...campaign, sentToday });
      nextSendAt = decision.send ? now : decision.nextCheckAt;
      waitingFor = decision.send ? null : decision.reason;
    }
    return { campaign, template, counts: counts as Partial<Record<AttemptStatus, number>>, tracking, sentToday, nextSendAt, waitingFor };
  }

  attempts(id: string, query: { status?: AttemptStatus; skip: number; take: number }) {
    return this.repos.attempts.list({ campaignId: id, ...query });
  }

  async start(id: string) {
    const { campaign } = await this.get(id);
    await this.checkCanStart(campaign);
    if (!(await this.repos.attempts.hasPending(id))) throw Errors.conflict("NOTHING_TO_SEND", `This campaign has no queued ${this.noun}`);
    const updated = await this.repos.campaigns.updateStatus(id, ["draft", "paused"], {
      status: "running",
      statusReason: null,
      ...(campaign.startedAt ? {} : { startedAt: new Date() }),
    });
    if (!updated) throw Errors.conflict("INVALID_TRANSITION", `Cannot start a ${campaign.status} campaign`);
    await this.log("started", "info", `"${campaign.name}"`);
    return this.changed(updated);
  }

  async pause(id: string) {
    const { campaign } = await this.get(id);
    const updated = await this.repos.campaigns.updateStatus(id, ["running"], { status: "paused", statusReason: "paused_by_admin" });
    if (!updated) throw Errors.conflict("INVALID_TRANSITION", `Cannot pause a ${campaign.status} campaign`);
    return this.changed(updated);
  }

  /** Stops for good: queued messages are cancelled (a stopped campaign cannot be restarted). */
  async stop(id: string) {
    const { campaign } = await this.get(id);
    const updated = await this.repos.campaigns.updateStatus(id, ["draft", "running", "paused"], {
      status: "stopped",
      statusReason: "stopped_by_admin",
      completedAt: new Date(),
    });
    if (!updated) throw Errors.conflict("INVALID_TRANSITION", `Cannot stop a ${campaign.status} campaign`);
    const cancelled = await this.repos.attempts.cancelQueued(id);
    await this.log("stopped", "warning", `"${campaign.name}": ${cancelled} queued ${this.noun} cancelled`);
    return this.changed(updated);
  }
}
