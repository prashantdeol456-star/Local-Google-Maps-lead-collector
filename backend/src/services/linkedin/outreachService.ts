// LinkedIn message campaigns. The backend never talks to LinkedIn: it keeps the queue and the
// pacing, and the LinkedIn Messenger extension (in the user's own logged-in browser) asks for
// one message at a time, opens the profile, types it and reports what happened.
//
// - assisted mode: the extension types the message and the user presses Send;
// - auto mode: the extension presses Send too.
// Pacing is the same as email/WhatsApp: a fixed gap, a daily cap and a sending window.
// One message is handed out at a time; one handed out and never reported is marked failed
// (not re-sent) so a contact is never messaged twice.

import type {
  OutreachPlatform,
  AttemptStatus,
  ContactRecord,
  LinkedInCampaignRecord,
  LinkedInMessageRecord,
  LinkedInSendMode,
  Repositories,
} from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { startOfDayInZone } from "../../utils/time.js";
import { decideSend, parseClock, type PacingDecision } from "../email/pacing.js";
import type { EventBus } from "../events.js";
import { contactData, renderContactText } from "../contacts/channelTemplates.js";

export const MAX_LINKEDIN_RECIPIENTS = 2000;
/** LinkedIn restricts accounts that message too much; this is a hard ceiling, not a target. */
export const MAX_LINKEDIN_DAILY_LIMIT = 100;
export const MIN_LINKEDIN_INTERVAL_SEC = 60;
/** A handed-out message with no report after this long is marked failed. */
export const CLAIM_TIMEOUT_MS = 15 * 60_000;

export type LinkedInRecipients = { contactIds: string[] } | { filters: { listName?: string; q?: string } };

export interface LinkedInCampaignInput {
  /** linkedin (default) or instagram */
  platform?: OutreachPlatform;
  name: string;
  templateId: string;
  mode: LinkedInSendMode;
  recipients: LinkedInRecipients;
  intervalSec: number;
  dailyLimit: number;
  windowStart: string;
  windowEnd: string;
  startAt?: Date | null;
}

/** Same start and end = no hours limit (sends any time of day). */
export const ANY_TIME = { windowStart: "00:00", windowEnd: "00:00" } as const;

export type ScheduleInput = Partial<Pick<LinkedInCampaignInput, "intervalSec" | "dailyLimit" | "windowStart" | "windowEnd">>;

function checkSchedule(input: ScheduleInput) {
  if (input.windowStart !== undefined || input.windowEnd !== undefined) {
    if (parseClock(input.windowStart ?? "") === null || parseClock(input.windowEnd ?? "") === null) throw Errors.badRequest("Sending hours must use HH:MM (24h)");
  }
  if (input.dailyLimit !== undefined && input.dailyLimit > MAX_LINKEDIN_DAILY_LIMIT) throw Errors.badRequest(`Daily limit can be at most ${MAX_LINKEDIN_DAILY_LIMIT} LinkedIn messages`);
  if (input.intervalSec !== undefined && input.intervalSec < MIN_LINKEDIN_INTERVAL_SEC) throw Errors.badRequest(`Gap between messages must be at least ${MIN_LINKEDIN_INTERVAL_SEC} seconds`);
}

export type ResultStatus = "sent" | "failed" | "skipped" | "blocked";

export interface HandedOutMessage {
  id: string;
  campaignId: string;
  campaignName: string;
  mode: LinkedInSendMode;
  profileUrl: string;
  contactName: string;
  body: string;
}

export type NextResponse =
  | { message: HandedOutMessage }
  | { wait: { reason: "no_running_campaigns" | "in_flight" | PacingWaitReason; nextCheckAt: string | null; campaignName?: string } };

type PacingWaitReason = Extract<PacingDecision, { send: false }>["reason"];

const STALE_ERROR = "No result came back from the LinkedIn Messenger extension in time. Not retried, so the contact is never messaged twice; check the conversation on LinkedIn.";

export class LinkedInOutreachService {
  constructor(
    private readonly repos: Repositories,
    private readonly opts: { timeZone: string; bus?: EventBus; now?: () => Date },
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  private changed(c: LinkedInCampaignRecord) {
    this.opts.bus?.publish({ type: "campaign.updated", campaignId: c.id, status: c.status });
    return c;
  }

  private log(action: string, status: "info" | "success" | "warning" | "error", message: string) {
    return this.repos.agentLogs.create({ jobId: null, action: `linkedin_campaign_${action}`, status, message });
  }

  private async selectContacts(selection: LinkedInRecipients, platform: OutreachPlatform): Promise<ContactRecord[]> {
    const contacts =
      "contactIds" in selection
        ? await this.repos.contacts.findByIds([...new Set(selection.contactIds)])
        : await this.repos.contacts.listAll({ ...selection.filters, ...(platform === "instagram" ? { hasInstagram: true } : { hasLinkedIn: true }) }, MAX_LINKEDIN_RECIPIENTS + 1);
    return contacts;
  }

  /** Who would receive it: contacts without a profile URL for the platform are left out. */
  async recipients(selection: LinkedInRecipients, platform: OutreachPlatform = "linkedin") {
    const contacts = await this.selectContacts(selection, platform);
    const withUrl = contacts.filter((c) => profileUrlOf(c, platform));
    return { selected: contacts.length, eligible: withUrl.length, noLinkedIn: contacts.length - withUrl.length, noProfileUrl: contacts.length - withUrl.length, tooMany: withUrl.length > MAX_LINKEDIN_RECIPIENTS };
  }

  async create(input: LinkedInCampaignInput, adminId: string | null) {
    checkSchedule(input);

    const platform: OutreachPlatform = input.platform ?? "linkedin";
    const label = platform === "instagram" ? "Instagram" : "LinkedIn";
    const template = await this.repos.templates.findById(input.templateId);
    if (!template || template.channel !== platform) throw Errors.badRequest(`Choose a ${label} message template`);

    const contacts = (await this.selectContacts(input.recipients, platform)).filter((c) => profileUrlOf(c, platform));
    if (contacts.length === 0) throw Errors.badRequest(`None of the selected contacts has a ${label} URL`);
    if (contacts.length > MAX_LINKEDIN_RECIPIENTS) throw Errors.badRequest(`At most ${MAX_LINKEDIN_RECIPIENTS} contacts per LinkedIn campaign; narrow the selection`);

    const messages = [...new Map(contacts.map((c) => [profileUrlOf(c, platform)!, c])).values()].map((c) => ({
      contactId: c.id,
      profileUrl: profileUrlOf(c, platform)!,
      contactName: c.name,
      renderedBody: renderContactText(template.body, contactData(c)),
    }));
    const empty = messages.filter((m) => !m.renderedBody).length;
    if (empty) throw Errors.badRequest("The template renders to an empty message");

    const campaign = await this.repos.linkedinOutreach.createCampaign(
      {
        platform,
        name: input.name,
        templateId: template.id,
        mode: input.mode,
        intervalSec: input.intervalSec,
        dailyLimit: input.dailyLimit,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone: this.opts.timeZone,
        startAt: input.startAt ?? null,
        createdById: adminId,
      },
      messages,
    );
    await this.log("created", "info", `"${campaign.name}": ${messages.length} ${label} messages queued (${input.mode} mode)`);
    return { campaign, queued: messages.length };
  }

  list(page: { skip: number; take: number; platform?: OutreachPlatform }) {
    return this.repos.linkedinOutreach.listCampaigns(page);
  }

  async get(id: string, now = this.now()) {
    const campaign = await this.repos.linkedinOutreach.findCampaign(id);
    if (!campaign) throw Errors.notFound("Campaign not found");
    const [counts, sentToday, template] = await Promise.all([
      this.repos.linkedinOutreach.countByStatus(id),
      this.repos.linkedinOutreach.countSentSince(id, startOfDayInZone(now, campaign.timeZone)),
      this.repos.templates.findById(campaign.templateId),
    ]);
    let nextSendAt: Date | null = null;
    let waitingFor: string | null = null;
    if (campaign.status === "running" && (counts.queued ?? 0) > 0) {
      const decision = decideSend(now, { ...campaign, sentToday });
      nextSendAt = decision.send ? now : decision.nextCheckAt;
      waitingFor = decision.send ? "extension" : decision.reason;
    }
    return { campaign, template, counts, sentToday, nextSendAt, waitingFor };
  }

  messages(id: string, query: { status?: AttemptStatus; skip: number; take: number }) {
    return this.repos.linkedinOutreach.listMessages({ campaignId: id, ...query });
  }

  /** Change the pace of a campaign that has not finished (takes effect on the next message). */
  async updateSchedule(id: string, input: ScheduleInput) {
    const { campaign } = await this.get(id);
    if (campaign.status === "completed" || campaign.status === "stopped") throw Errors.conflict("INVALID_TRANSITION", `Cannot change a ${campaign.status} campaign`);
    checkSchedule(input);
    const updated = await this.repos.linkedinOutreach.updateCampaignSchedule(id, input);
    const hours = updated.windowStart === updated.windowEnd ? "any time" : `${updated.windowStart}–${updated.windowEnd}`;
    await this.log("updated", "info", `"${campaign.name}": ${hours}, every ${Math.round(updated.intervalSec / 60)} min, ${updated.dailyLimit}/day`);
    return this.changed(updated);
  }

  async start(id: string) {
    const { campaign } = await this.get(id);
    if (!(await this.repos.linkedinOutreach.hasPending(id))) throw Errors.conflict("NOTHING_TO_SEND", "This campaign has no queued LinkedIn messages");
    const updated = await this.repos.linkedinOutreach.updateCampaignStatus(id, ["draft", "paused"], {
      status: "running",
      statusReason: null,
      ...(campaign.startedAt ? {} : { startedAt: this.now() }),
    });
    if (!updated) throw Errors.conflict("INVALID_TRANSITION", `Cannot start a ${campaign.status} campaign`);
    await this.log("started", "info", `"${campaign.name}" (${campaign.mode} mode)`);
    return this.changed(updated);
  }

  async pause(id: string, reason = "paused_by_admin") {
    const { campaign } = await this.get(id);
    const updated = await this.repos.linkedinOutreach.updateCampaignStatus(id, ["running"], { status: "paused", statusReason: reason.slice(0, 500) });
    if (!updated) throw Errors.conflict("INVALID_TRANSITION", `Cannot pause a ${campaign.status} campaign`);
    return this.changed(updated);
  }

  async stop(id: string) {
    const { campaign } = await this.get(id);
    const updated = await this.repos.linkedinOutreach.updateCampaignStatus(id, ["draft", "running", "paused"], {
      status: "stopped",
      statusReason: "stopped_by_admin",
      completedAt: this.now(),
    });
    if (!updated) throw Errors.conflict("INVALID_TRANSITION", `Cannot stop a ${campaign.status} campaign`);
    const cancelled = await this.repos.linkedinOutreach.cancelQueued(id);
    await this.log("stopped", "warning", `"${campaign.name}": ${cancelled} queued LinkedIn messages cancelled`);
    return this.changed(updated);
  }

  /** Running campaigns and what each is waiting for (the extension's status view). */
  async overview(now = this.now(), platform: OutreachPlatform = "linkedin") {
    const running = await this.repos.linkedinOutreach.listCampaignsByStatus("running", platform);
    return Promise.all(
      running.map(async (c) => {
        const { counts, sentToday, nextSendAt, waitingFor } = await this.get(c.id, now);
        return { id: c.id, name: c.name, mode: c.mode, dailyLimit: c.dailyLimit, sentToday, queued: counts.queued ?? 0, sent: counts.sent ?? 0, nextSendAt, waitingFor };
      }),
    );
  }

  /** The extension asks for the next message to send. Hands out at most one at a time. */
  async next(now = this.now(), platform: OutreachPlatform = "linkedin"): Promise<NextResponse> {
    const stale = await this.repos.linkedinOutreach.failStale(new Date(now.getTime() - CLAIM_TIMEOUT_MS), STALE_ERROR, now);
    if (stale) await this.log("message_timeout", "warning", `${stale} LinkedIn message(s) got no result from the extension and were marked failed`);

    const inFlight = await this.repos.linkedinOutreach.inFlight(platform);
    if (inFlight) return { wait: { reason: "in_flight", nextCheckAt: new Date((inFlight.claimedAt ?? now).getTime() + CLAIM_TIMEOUT_MS).toISOString() } };

    let earliest: { reason: PacingWaitReason; at: Date; campaignName: string } | null = null;
    const running = await this.repos.linkedinOutreach.listCampaignsByStatus("running", platform);
    for (const listed of running) {
      const campaign = await this.repos.linkedinOutreach.findCampaign(listed.id);
      if (!campaign || campaign.status !== "running") continue;
      if (!(await this.repos.linkedinOutreach.hasPending(campaign.id))) {
        const done = await this.repos.linkedinOutreach.updateCampaignStatus(campaign.id, ["running"], { status: "completed", completedAt: now });
        if (done) {
          await this.log("completed", "success", `"${campaign.name}"`);
          this.changed(done);
        }
        continue;
      }
      const sentToday = await this.repos.linkedinOutreach.countSentSince(campaign.id, startOfDayInZone(now, campaign.timeZone));
      const decision = decideSend(now, { ...campaign, sentToday });
      if (!decision.send) {
        if (!earliest || decision.nextCheckAt < earliest.at) earliest = { reason: decision.reason, at: decision.nextCheckAt, campaignName: campaign.name };
        continue;
      }
      const message = await this.repos.linkedinOutreach.nextQueued(campaign.id);
      if (!message || !(await this.repos.linkedinOutreach.claim(message.id, now))) continue;
      await this.repos.linkedinOutreach.touchLastSent(campaign.id, now);
      this.changed(campaign);
      return {
        message: {
          id: message.id,
          campaignId: campaign.id,
          campaignName: campaign.name,
          mode: campaign.mode === "auto" ? "auto" : "assisted",
          profileUrl: message.profileUrl,
          contactName: message.contactName,
          body: message.renderedBody,
        },
      };
    }
    if (earliest) return { wait: { reason: earliest.reason, nextCheckAt: earliest.at.toISOString(), campaignName: earliest.campaignName } };
    return { wait: { reason: "no_running_campaigns", nextCheckAt: null } };
  }

  /**
   * The extension reports the outcome of a handed-out message.
   * - sent / failed / skipped: final;
   * - blocked: LinkedIn is not usable right now (logged out, security check, weekly limit…):
   *   the message goes back to the queue untouched and every running LinkedIn campaign pauses.
   */
  async report(id: string, status: ResultStatus, error: string | null, now = this.now()): Promise<LinkedInMessageRecord> {
    const message = await this.repos.linkedinOutreach.findMessage(id);
    if (!message) throw Errors.notFound("Message not found");
    const campaign = await this.repos.linkedinOutreach.findCampaign(message.campaignId);
    const detail = error?.slice(0, 1000) ?? null;

    if (status === "blocked") {
      const reason = detail ?? "LinkedIn is not available";
      if (await this.repos.linkedinOutreach.release(id, reason)) {
        // Only the campaigns of the same platform: a LinkedIn problem does not stop Instagram.
        for (const c of await this.repos.linkedinOutreach.listCampaignsByStatus("running", campaign?.platform === "instagram" ? "instagram" : "linkedin")) {
          const paused = await this.repos.linkedinOutreach.updateCampaignStatus(c.id, ["running"], { status: "paused", statusReason: reason.slice(0, 500) });
          if (paused) this.changed(paused);
        }
        await this.log("paused", "error", `${campaign?.platform === "instagram" ? "Instagram" : "LinkedIn"} campaigns paused: ${reason}`);
      }
    } else {
      const done = await this.repos.linkedinOutreach.finish(id, {
        status,
        error: status === "sent" ? null : (detail ?? (status === "skipped" ? "Skipped" : "Failed")),
        sentAt: status === "sent" ? now : null,
        failedAt: status === "failed" ? now : null,
      });
      if (!done) throw Errors.conflict("NOT_IN_FLIGHT", `This message is already ${message.status}`);
    }
    if (campaign) this.changed(campaign);
    return (await this.repos.linkedinOutreach.findMessage(id))!;
  }
}

/** The profile link a campaign of this platform messages. */
function profileUrlOf(c: Pick<ContactRecord, "linkedinUrl" | "instagramUrl">, platform: OutreachPlatform): string | null {
  return platform === "instagram" ? c.instagramUrl : c.linkedinUrl;
}
