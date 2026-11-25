// Social Engagement: reads every connected Facebook Page and Instagram account every few minutes
// (webhooks bring changes sooner; this catches what they miss and works without them).

import { ownerScope } from "../database/ownerScope.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { EngagementService } from "../services/engagement/engagementService.js";

export class EngagementWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private round: Promise<void> | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly engagement: EngagementService,
    private readonly opts: { intervalMinutes: number; ready: () => boolean; log: (msg: string) => void },
  ) {}

  start() {
    if (this.timer || this.opts.intervalMinutes <= 0) return;
    this.timer = setInterval(() => void this.runOnce(), this.opts.intervalMinutes * 60_000);
    // First round a little after start-up, not during it.
    setTimeout(() => void this.runOnce(), 30_000).unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.round;
    await this.engagement.flushPending();
  }

  runOnce() {
    this.round ??= this.all()
      .catch((err) => this.opts.log(`Social engagement: ${String(err)}`))
      .finally(() => (this.round = null));
    return this.round;
  }

  private async all() {
    if (!this.opts.ready()) return;
    const accounts = await this.db.socialAccount.findMany({ where: { platform: { in: ["facebook_page", "instagram", "youtube_channel"] }, status: { not: "expired" } } });
    for (const account of accounts) {
      if (!this.engagement.canSync(account.platform)) continue; // its app (Meta / Google) is not set up
      if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) continue;
      const owner = account.ownerId ? await this.db.adminUser.findUnique({ where: { id: account.ownerId } }) : null;
      if (account.ownerId && owner?.status !== "active") continue; // owner disabled or deleted
      const scope = owner ? { userId: owner.id, ownerId: owner.id, customer: owner.role !== "super_admin" } : null;
      const run = () => this.engagement.syncAccount(account.id);
      try {
        await (scope ? ownerScope.run(scope, run) : run());
      } catch (err) {
        this.opts.log(`Social engagement: ${account.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
