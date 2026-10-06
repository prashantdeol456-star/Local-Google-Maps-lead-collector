// Housekeeping so a long-running server does not grow without limit: expired login sessions
// and old webhook delivery logs. Leads, communication history and opt-outs are never removed.

import type { Repositories } from "../database/repositories/index.js";

export const RETENTION_DAYS = { deliveredWebhooks: 30, failedWebhooks: 90 };
const DAY = 86_400_000;

export class MaintenanceWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly opts: { now?: () => Date; log?: (msg: string) => void } = {},
  ) {}

  async run(): Promise<{ sessions: number; deliveredWebhooks: number; failedWebhooks: number }> {
    const now = this.opts.now?.() ?? new Date();
    const result = {
      sessions: await this.repos.sessions.deleteExpired(now),
      deliveredWebhooks: await this.repos.webhooks.deleteOld("delivered", new Date(now.getTime() - RETENTION_DAYS.deliveredWebhooks * DAY)),
      failedWebhooks: await this.repos.webhooks.deleteOld("failed", new Date(now.getTime() - RETENTION_DAYS.failedWebhooks * DAY)),
    };
    if (result.sessions + result.deliveredWebhooks + result.failedWebhooks > 0) {
      this.opts.log?.(`maintenance: removed ${result.sessions} expired sessions, ${result.deliveredWebhooks + result.failedWebhooks} old webhook deliveries`);
    }
    return result;
  }

  /** Runs now and then every `everyMs` (default 6 hours). */
  start(everyMs = 6 * 60 * 60 * 1000) {
    if (this.timer) return;
    const tick = () => void this.run().catch((err) => this.opts.log?.(`maintenance: ${String(err)}`));
    tick();
    this.timer = setInterval(tick, everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
