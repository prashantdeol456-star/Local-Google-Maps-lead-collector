// Background sender shared by the email and WhatsApp workers. Every tick, each running
// campaign of the worker's channel may send at most one message, if its pacing allows
// (interval, daily limit, sending window).
//
// Safety:
// - an attempt is "claimed" (queued → sending) before sending, so it is never sent twice;
// - each channel re-checks consent right before sending (someone may have opted out meanwhile);
// - after a crash, attempts left in "sending" are marked failed, not re-sent, because we
//   cannot know whether the provider already delivered them.

import type { AttemptRecord, CampaignRecord, Channel, Repositories } from "../database/repositories/index.js";
import type { EventBus } from "../services/events.js";
import { MAX_TRIES, RETRY_DELAYS_MIN, decideSend } from "../services/email/pacing.js";
import { startOfDayInZone } from "../utils/time.js";

export interface CampaignWorkerOptions {
  bus?: EventBus;
  now?: () => Date;
  log?: (msg: string) => void;
}

export type StepResult = "sent" | "retry_later" | "failed" | "skipped" | "waiting" | "completed" | "idle" | "paused";

export abstract class CampaignWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  protected readonly now: () => Date;

  constructor(
    protected readonly repos: Repositories,
    protected readonly channel: Channel,
    protected readonly base: CampaignWorkerOptions,
  ) {
    this.now = base.now ?? (() => new Date());
  }

  /** Sends one claimed attempt and records the outcome on it. */
  protected abstract send(campaign: CampaignRecord, attempt: AttemptRecord, now: Date): Promise<StepResult>;

  /** Marks messages interrupted mid-send by a crash or restart. Call once at startup. */
  async recover(): Promise<number> {
    return this.repos.attempts.failStuckSending(
      this.channel,
      "Interrupted while sending (backend stopped). Not retried automatically to avoid sending it twice.",
      this.now(),
    );
  }

  start(everyMs = 5000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((err) => this.base.log?.(`${this.channel} worker: ${String(err)}`)), everyMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  /** One pass over all running campaigns (concurrent calls share the same pass). */
  tick(): Promise<void> {
    this.running ??= (async () => {
      try {
        for (const campaign of await this.repos.campaigns.listByStatus("running", this.channel)) {
          await this.step(campaign);
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  protected publish(campaign: CampaignRecord, status = campaign.status) {
    this.base.bus?.publish({ type: "campaign.updated", campaignId: campaign.id, status });
  }

  async step(listed: CampaignRecord): Promise<StepResult> {
    // Re-read: the admin may have paused or stopped it since the list was loaded.
    const campaign = await this.repos.campaigns.findById(listed.id);
    if (!campaign || campaign.status !== "running") return "waiting";
    const now = this.now();

    // Finished as soon as nothing is left to send (no need to wait for the next interval).
    if (!(await this.repos.attempts.hasPending(campaign.id))) {
      const done = await this.repos.campaigns.updateStatus(campaign.id, ["running"], { status: "completed", completedAt: now });
      if (done) {
        await this.repos.agentLogs.create({ jobId: null, action: `${this.channel}_campaign_completed`, status: "success", message: `"${campaign.name}"` });
        this.publish(done);
      }
      return "completed";
    }

    const sentToday = await this.repos.attempts.countSentSince(campaign.id, startOfDayInZone(now, campaign.timeZone));
    const decision = decideSend(now, { ...campaign, sentToday });
    if (!decision.send) return "waiting";

    const attempt = await this.repos.attempts.nextDue(campaign.id, now);
    if (!attempt) return "idle"; // only retries waiting for later
    if (!(await this.repos.attempts.claim(attempt.id))) return "idle";

    const result = await this.send(campaign, attempt, now);
    await this.repos.campaigns.touchLastSent(campaign.id, now); // every try counts toward pacing
    if (result !== "paused") this.publish(campaign); // pauseForSetup already announced the pause
    return result;
  }

  /** Temporary provider error: queue again with a growing delay, or fail after MAX_TRIES. */
  protected async retryOrFail(attempt: AttemptRecord, now: Date, message: string, retryable: boolean): Promise<StepResult> {
    const tries = attempt.tries + 1;
    if (retryable && tries < MAX_TRIES) {
      const delayMin = RETRY_DELAYS_MIN[tries - 1]!;
      await this.repos.attempts.update(attempt.id, {
        status: "queued",
        tries,
        error: message,
        nextTryAt: new Date(now.getTime() + delayMin * 60_000),
      });
      return "retry_later";
    }
    await this.repos.attempts.update(attempt.id, { status: "failed", tries, error: message, failedAt: now });
    return "failed";
  }

  /**
   * A problem that would make every following message fail too (bad token, template not
   * approved…): the attempt goes back to the queue untouched and the campaign is paused
   * until the admin fixes the setup and resumes.
   */
  protected async pauseForSetup(campaign: CampaignRecord, attempt: AttemptRecord, reason: string): Promise<StepResult> {
    await this.repos.attempts.update(attempt.id, { status: "queued", error: reason });
    const paused = await this.repos.campaigns.updateStatus(campaign.id, ["running"], { status: "paused", statusReason: reason.slice(0, 500) });
    await this.repos.agentLogs.create({ jobId: null, action: `${this.channel}_campaign_paused`, status: "error", message: `"${campaign.name}": ${reason}` });
    if (paused) this.publish(paused);
    return "paused";
  }
}
