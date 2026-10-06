// Sends queued webhook deliveries (integrations such as n8n). At-least-once: a delivery can
// arrive twice (e.g. a timeout after the receiver already got it), so receivers should
// de-duplicate on the event id. Redirects are not followed.
//
// Headers on every request:
//   X-Lead-Platform-Event       event type, e.g. lead.created
//   X-Lead-Platform-Event-Id    stable event id (the same on retries)
//   X-Lead-Platform-Delivery    delivery id
//   X-Lead-Platform-Timestamp   unix seconds
//   X-Lead-Platform-Signature   v1=<hex HMAC-SHA256 of "<timestamp>.<body>" with the secret>
//   X-Lead-Platform-Token       the secret itself, for n8n's built-in "Header Auth"

import { createHmac } from "node:crypto";
import type { Repositories, WebhookDeliveryRecord } from "../database/repositories/index.js";
import type { SecretBox } from "../utils/secretBox.js";

export const WEBHOOK_RETRY_DELAYS_MIN = [1, 5, 15, 60];
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MIN.length + 1;
const TIMEOUT_MS = 10_000;
const BATCH = 20;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export type DeliveryResult = { ok: true; status: number } | { ok: false; status: number | null; error: string };

export class WebhookWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;
  private readonly log?: (msg: string) => void;

  constructor(
    private readonly repos: Repositories,
    private readonly box: SecretBox,
    opts: { now?: () => Date; fetchImpl?: typeof fetch; log?: (msg: string) => void } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log;
  }

  start(everyMs = 5000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((err) => this.log?.(`webhook worker: ${String(err)}`)), everyMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  find(id: string) {
    return this.repos.webhooks.findDelivery(id);
  }

  tick(): Promise<void> {
    this.running ??= (async () => {
      try {
        for (const d of await this.repos.webhooks.due(this.now(), BATCH)) await this.deliver(d);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** One attempt for one delivery; records the outcome and schedules a retry if needed. */
  async deliver(d: WebhookDeliveryRecord, opts: { retry?: boolean } = { retry: true }): Promise<DeliveryResult> {
    const now = this.now();
    const result = await this.send(d, now);
    const attempts = d.attempts + 1;
    if (result.ok) {
      await this.repos.webhooks.updateDelivery(d.id, { status: "delivered", attempts, responseStatus: result.status, lastError: null, deliveredAt: now });
    } else if (opts.retry !== false && attempts < WEBHOOK_MAX_ATTEMPTS) {
      const delay = WEBHOOK_RETRY_DELAYS_MIN[attempts - 1]! * 60_000;
      await this.repos.webhooks.updateDelivery(d.id, {
        status: "pending",
        attempts,
        responseStatus: result.status,
        lastError: result.error,
        nextAttemptAt: new Date(now.getTime() + delay),
      });
    } else {
      await this.repos.webhooks.updateDelivery(d.id, { status: "failed", attempts, responseStatus: result.status, lastError: result.error });
    }
    return result;
  }

  private async send(d: WebhookDeliveryRecord, now: Date): Promise<DeliveryResult> {
    const endpoint = await this.repos.webhooks.findEndpoint(d.endpointId);
    if (!endpoint) return { ok: false, status: null, error: "Webhook was deleted" };
    let secret: string;
    try {
      secret = this.box.open(endpoint.secretEnc);
    } catch {
      return { ok: false, status: null, error: "Signing secret cannot be read (SESSION_SECRET changed?). Rotate the secret" };
    }

    const timestamp = Math.floor(now.getTime() / 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "LeadPlatform-Webhooks/1.0",
          "X-Lead-Platform-Event": d.event,
          "X-Lead-Platform-Event-Id": d.eventId,
          "X-Lead-Platform-Delivery": d.id,
          "X-Lead-Platform-Timestamp": String(timestamp),
          "X-Lead-Platform-Signature": signPayload(secret, timestamp, d.payload),
          "X-Lead-Platform-Token": secret,
        },
        body: d.payload,
        redirect: "manual",
        signal: controller.signal,
      });
      await res.body?.cancel().catch(() => undefined); // the response body is not needed
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
      const hint =
        res.status === 401 || res.status === 403
          ? " (check the Header Auth value in n8n)"
          : res.status === 404
            ? " (is the n8n workflow published? Test URLs only work while listening)"
            : res.status >= 300 && res.status < 400
              ? " (redirects are not followed)"
              : "";
      return { ok: false, status: res.status, error: `HTTP ${res.status}${hint}` };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return { ok: false, status: null, error: aborted ? `No answer within ${TIMEOUT_MS / 1000} s` : `Could not connect to ${new URL(endpoint.url).host}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
