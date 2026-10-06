// Resend (https://resend.com) — REST API + Svix-signed webhooks.
// API shapes verified against resend.com/docs on 2026-10-05.

import { Webhook } from "svix";
import {
  EmailProviderError,
  WebhookVerificationFailed,
  type EmailEventType,
  type EmailProvider,
  type NormalizedEmailEvent,
  type OutgoingEmail,
  type RawWebhook,
  type SendResult,
} from "./types.js";

const API = "https://api.resend.com";
const BATCH_LIMIT = 100;
const TIMEOUT_MS = 15_000;

/** Resend webhook/last_event type → our event type. Unlisted types (scheduled, received…) are ignored. */
const EVENT_MAP: Record<string, EmailEventType> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "failed",
};

const TAG_SAFE = /^[A-Za-z0-9_-]{1,256}$/;

export interface ResendOptions {
  apiKey: string;
  from: string;
  replyTo?: string;
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}

function header(headers: RawWebhook["headers"], name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend" as const;
  readonly capabilities = {
    delivery: true,
    opens: true,
    clicks: true,
    bounces: true,
    replies: false, // inbound replies need a receiving setup (Phase 11)
    batch: true,
    statusLookup: true,
  };
  readonly from: string;
  private readonly fetchImpl: typeof fetch;
  private readonly webhook: Webhook | null;

  constructor(private readonly options: ResendOptions) {
    this.from = options.from;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.webhook = options.webhookSecret ? new Webhook(options.webhookSecret) : null;
  }

  private body(message: OutgoingEmail) {
    const tags = Object.entries(message.tags ?? {}).map(([name, value]) => {
      if (!TAG_SAFE.test(name) || !TAG_SAFE.test(value)) {
        throw new EmailProviderError(`Invalid tag ${name}=${value}: only letters, digits, _ and - are allowed`, false);
      }
      return { name, value };
    });
    const replyTo = message.replyTo ?? this.options.replyTo;
    return {
      from: this.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(message.headers && Object.keys(message.headers).length ? { headers: message.headers } : {}),
      ...(tags.length ? { tags } : {}),
    };
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 256) } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new EmailProviderError("Could not reach Resend", true);
    } finally {
      clearTimeout(timer);
    }
    const data = (await res.json().catch(() => null)) as { message?: string; name?: string } | null;
    if (!res.ok) {
      // Never include the API key or request body in errors/logs.
      const reason = data?.message ?? `HTTP ${res.status}`;
      const retryable = res.status === 429 || res.status >= 500;
      const hint = res.status === 401 || res.status === 403 ? " (check RESEND_API_KEY and the verified sending domain)" : "";
      throw new EmailProviderError(`Resend: ${reason}${hint}`, retryable, res.status);
    }
    return data as T;
  }

  async sendEmail(message: OutgoingEmail): Promise<SendResult> {
    const data = await this.request<{ id?: string }>("POST", "/emails", this.body(message), message.idempotencyKey);
    if (!data?.id) throw new EmailProviderError("Resend did not return a message id", true);
    return { externalMessageId: data.id };
  }

  async sendBatch(messages: OutgoingEmail[]): Promise<SendResult[]> {
    const results: SendResult[] = [];
    for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
      const chunk = messages.slice(i, i + BATCH_LIMIT);
      const data = await this.request<{ data?: { id: string }[] }>("POST", "/emails/batch", chunk.map((m) => this.body(m)));
      if (!data?.data || data.data.length !== chunk.length) throw new EmailProviderError("Unexpected Resend batch response", true);
      results.push(...data.data.map((d) => ({ externalMessageId: d.id })));
    }
    return results;
  }

  async getMessageStatus(externalMessageId: string): Promise<EmailEventType | null> {
    const data = await this.request<{ last_event?: string }>("GET", `/emails/${encodeURIComponent(externalMessageId)}`);
    return (data?.last_event && EVENT_MAP[`email.${data.last_event}`]) || null;
  }

  async handleWebhook(request: RawWebhook): Promise<NormalizedEmailEvent[]> {
    if (!this.webhook) throw new WebhookVerificationFailed("RESEND_WEBHOOK_SECRET is not configured");
    const svixHeaders = {
      "svix-id": header(request.headers, "svix-id") ?? "",
      "svix-timestamp": header(request.headers, "svix-timestamp") ?? "",
      "svix-signature": header(request.headers, "svix-signature") ?? "",
    };
    try {
      // Checks the HMAC signature and rejects old timestamps (replay protection).
      this.webhook.verify(request.body, svixHeaders);
    } catch {
      throw new WebhookVerificationFailed();
    }

    const payload = JSON.parse(request.body) as { type?: string; created_at?: string; data?: Record<string, unknown> };
    const type = payload.type ? EVENT_MAP[payload.type] : undefined;
    const emailId = payload.data?.email_id;
    if (!type || typeof emailId !== "string") return [];

    const { to, from, subject, ...rest } = payload.data ?? {};
    return [
      {
        providerEventId: svixHeaders["svix-id"],
        externalMessageId: emailId,
        type,
        occurredAt: payload.created_at ? new Date(payload.created_at) : new Date(),
        // Keep event details (click link, bounce reason, tags) but not the message content.
        metadata: { resendType: payload.type, ...rest, ...(to ? { to } : {}) },
      },
    ];
  }
}
