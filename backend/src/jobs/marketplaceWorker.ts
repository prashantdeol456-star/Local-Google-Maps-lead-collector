// Marketplace leads: every minute, each enabled portal source whose last check is at least
// 5 minutes old is read for new enquiries (IndiaMART allows one call every 5 minutes), in its
// owner's data scope.

import { ownerScope } from "../database/ownerScope.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { MIN_POLL_MS, type MarketplaceService } from "../services/marketplace/marketplaceService.js";

export class MarketplaceWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private round: Promise<void> | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly marketplace: MarketplaceService,
    private readonly opts: { log: (msg: string) => void },
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), 60_000);
    setTimeout(() => void this.runOnce(), 20_000).unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.round;
  }

  runOnce() {
    this.round ??= this.all()
      .catch((err) => this.opts.log(`Marketplace: ${String(err)}`))
      .finally(() => (this.round = null));
    return this.round;
  }

  private async all() {
    const now = Date.now();
    for (const s of await this.marketplace.allEnabled()) {
      if (s.lastPolledAt && now - s.lastPolledAt.getTime() < MIN_POLL_MS) continue;
      const owner = s.ownerId ? await this.db.adminUser.findUnique({ where: { id: s.ownerId } }) : null;
      if (s.ownerId && owner?.status !== "active") continue;
      const run = () => this.marketplace.pull(s.id);
      await (owner ? ownerScope.run({ userId: owner.id, ownerId: owner.id, customer: owner.role !== "super_admin" }, run) : run()).catch((err) =>
        this.opts.log(`Marketplace ${s.name}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }
}
