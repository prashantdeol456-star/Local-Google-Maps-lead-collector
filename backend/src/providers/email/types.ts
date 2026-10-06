// Provider-neutral email interface. Campaigns, queues and tracking (Phases 10–11) only use this,
// so switching EMAIL_PROVIDER never changes application code.

export type EmailProviderName = "log" | "resend" | "smtp";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Overrides the configured EMAIL_REPLY_TO. */
  replyTo?: string;
  /** Extra headers, e.g. List-Unsubscribe (Phase 11). */
  headers?: Record<string, string>;
  /** Correlation data echoed back in provider webhooks where supported (ASCII letters, digits, _ and -). */
  tags?: Record<string, string>;
  /** Same key → the provider sends at most once (safe retries). */
  idempotencyKey?: string;
}

export interface SendResult {
  /** Provider's id for this message; webhook events refer to it. */
  externalMessageId: string;
}

/** What a provider can report. Opens are approximate by nature (image proxies, privacy features). */
export interface EmailCapabilities {
  delivery: boolean;
  opens: boolean;
  clicks: boolean;
  bounces: boolean;
  replies: boolean;
  batch: boolean;
  statusLookup: boolean;
}

export type EmailEventType = "sent" | "delivered" | "delivery_delayed" | "opened" | "clicked" | "bounced" | "complained" | "failed";

export interface NormalizedEmailEvent {
  /** Unique per event from the provider (used to ignore webhook retries). */
  providerEventId: string;
  externalMessageId: string;
  type: EmailEventType;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

export interface RawWebhook {
  headers: Record<string, string | string[] | undefined>;
  /** Exact request body bytes/text (signatures are computed over it). */
  body: string;
}

export interface EmailProvider {
  readonly name: EmailProviderName;
  readonly capabilities: EmailCapabilities;
  /** The From address used for every message. */
  readonly from: string;
  sendEmail(message: OutgoingEmail): Promise<SendResult>;
  sendBatch(messages: OutgoingEmail[]): Promise<SendResult[]>;
  /** Latest known status, or null when the provider cannot tell. */
  getMessageStatus(externalMessageId: string): Promise<EmailEventType | null>;
  /** Verifies the webhook signature and returns its events. Throws WebhookVerificationFailed if it is not genuine. */
  handleWebhook(request: RawWebhook): Promise<NormalizedEmailEvent[]>;
}

/** A send/lookup failure. `retryable` = trying again later may succeed (network, rate limit, 5xx). */
export class EmailProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EmailProviderError";
  }
}

export class WebhookVerificationFailed extends Error {
  constructor(message = "Webhook signature verification failed") {
    super(message);
    this.name = "WebhookVerificationFailed";
  }
}

export const NO_CAPABILITIES: EmailCapabilities = {
  delivery: false,
  opens: false,
  clicks: false,
  bounces: false,
  replies: false,
  batch: false,
  statusLookup: false,
};
