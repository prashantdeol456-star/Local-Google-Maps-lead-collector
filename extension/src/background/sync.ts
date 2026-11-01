// Sends outbox items to the backend in order. No chrome APIs here (testable with fakes).
//
// Failure handling:
// - backend unreachable / 5xx / 429 / 402 (no lead credit left until the user recharges)
//                                    → keep the item, retry later with backoff, stop this flush
//   (later items wait so order is kept: a "completed" status never overtakes its leads)
// - 401                                → keep everything, stop (user must log in again)
// - other 4xx (invalid / not found)    → drop that item and report it; it would never succeed

import type { ApiError, ApiResult } from "./apiClient";
import type { OutboxItem, OutboxStore } from "../storage/outbox";

export interface JobCounters {
  id: string;
  totalFound: number;
  newRecords: number;
  duplicateRecords: number;
  errorRecords: number;
}

export type SyncEvent =
  | { type: "lead"; jobId: string; result: "new" | "duplicate"; matchedBy: string | null; replayed: boolean; name: string; job: JobCounters | null }
  | { type: "error_recorded"; jobId: string; job: JobCounters }
  | { type: "status"; jobId: string; status: string }
  | { type: "dropped"; item: OutboxItem; error: ApiError }
  | { type: "offline"; error: ApiError }
  | { type: "unauthorized" };

export type Send = (method: "POST" | "PATCH", path: string, body: unknown) => Promise<ApiResult<any>>;

export interface FlushSummary {
  sent: number;
  dropped: number;
  remaining: number;
  stoppedBy: "done" | "offline" | "unauthorized" | "backoff";
}

const BATCH = 25;
export const MAX_BACKOFF_MS = 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempts - 1));
}

function isRetryable(err: ApiError): boolean {
  return (
    err.kind === "unreachable" ||
    err.kind === "timeout" ||
    err.kind === "invalid_response" ||
    (err.status !== undefined && (err.status >= 500 || err.status === 429 || err.status === 402))
  );
}

function request(item: OutboxItem): { method: "POST" | "PATCH"; path: string; body: unknown } {
  switch (item.kind) {
    case "lead":
      return { method: "POST", path: "/api/leads", body: { jobId: item.jobId, clientKey: item.clientKey, lead: item.lead } };
    case "error":
      return {
        method: "POST",
        path: `/api/jobs/${encodeURIComponent(item.jobId)}/items/error`,
        body: { clientKey: item.clientKey, name: item.name, message: item.message },
      };
    case "status":
      return {
        method: "PATCH",
        path: `/api/jobs/${encodeURIComponent(item.jobId)}`,
        body: { status: item.status, statusReason: item.reason },
      };
  }
}

export class SyncEngine {
  private running: Promise<FlushSummary> | null = null;

  constructor(
    private readonly store: OutboxStore,
    private readonly send: Send,
    private readonly onEvent: (e: SyncEvent) => void | Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Flushes the outbox. Concurrent calls share one run. */
  flush(): Promise<FlushSummary> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<FlushSummary> {
    let sent = 0;
    let dropped = 0;
    for (;;) {
      const items = await this.store.peek(BATCH);
      if (items.length === 0) return { sent, dropped, remaining: 0, stoppedBy: "done" };

      for (const item of items) {
        if (item.nextAttemptAt > this.now()) {
          return { sent, dropped, remaining: await this.store.count(), stoppedBy: "backoff" };
        }
        const { method, path, body } = request(item);
        const res = await this.send(method, path, body);

        if (res.ok) {
          await this.store.remove(item.id);
          sent++;
          await this.onEvent(this.success(item, res.data));
          continue;
        }
        if (res.error.kind === "unauthorized") {
          await this.onEvent({ type: "unauthorized" });
          return { sent, dropped, remaining: await this.store.count(), stoppedBy: "unauthorized" };
        }
        if (isRetryable(res.error)) {
          const attempts = item.attempts + 1;
          await this.store.update(item.id, { attempts, nextAttemptAt: this.now() + backoffMs(attempts) });
          await this.onEvent({ type: "offline", error: res.error });
          return { sent, dropped, remaining: await this.store.count(), stoppedBy: "offline" };
        }
        // Permanent failure: it will never succeed, so drop it rather than block everything behind it.
        await this.store.remove(item.id);
        dropped++;
        await this.onEvent({ type: "dropped", item, error: res.error });
      }
    }
  }

  private success(item: OutboxItem, data: any): SyncEvent {
    switch (item.kind) {
      case "lead":
        return {
          type: "lead",
          jobId: item.jobId,
          result: data.result,
          matchedBy: data.matchedBy ?? null,
          replayed: !!data.replayed,
          name: item.lead.name,
          job: data.job ?? null,
        };
      case "error":
        return { type: "error_recorded", jobId: item.jobId, job: data.job };
      case "status":
        return { type: "status", jobId: item.jobId, status: item.status };
    }
  }
}
