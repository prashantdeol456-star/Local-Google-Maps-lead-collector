// Email finder → Bulk: works through the waiting sheets one row at a time (a short pause between
// rows, so websites and Hunter are not hammered). Jobs of several users take turns.

import type { BulkEnrichService } from "../services/enrich/bulkEnrich.js";

export class EnrichWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private current: Promise<unknown> | null = null;

  constructor(
    private readonly bulk: BulkEnrichService,
    private readonly opts: { gapMs?: number; idleMs?: number; log: (msg: string) => void },
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(5_000);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.current;
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.current = this.bulk
        .step()
        .catch((err) => {
          this.opts.log(`Email finder (bulk): ${err instanceof Error ? err.message : String(err)}`);
          return false;
        })
        .then((worked) => this.schedule(worked ? (this.opts.gapMs ?? 1_500) : (this.opts.idleMs ?? 10_000)));
    }, ms);
  }
}
