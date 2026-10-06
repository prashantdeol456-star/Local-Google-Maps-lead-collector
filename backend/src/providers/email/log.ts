// Development provider: sends nothing. Messages are kept in memory (last 50) so the
// whole flow can be tried without credentials or any risk of emailing real people.

import { randomUUID } from "node:crypto";
import {
  NO_CAPABILITIES,
  WebhookVerificationFailed,
  type EmailProvider,
  type NormalizedEmailEvent,
  type OutgoingEmail,
  type SendResult,
} from "./types.js";

const KEEP = 50;

export class LogEmailProvider implements EmailProvider {
  readonly name = "log" as const;
  readonly capabilities = { ...NO_CAPABILITIES, batch: true };
  readonly outbox: (OutgoingEmail & { externalMessageId: string; at: Date })[] = [];

  constructor(readonly from: string) {}

  async sendEmail(message: OutgoingEmail): Promise<SendResult> {
    const externalMessageId = `log_${randomUUID()}`;
    this.outbox.unshift({ ...message, externalMessageId, at: new Date() });
    this.outbox.length = Math.min(this.outbox.length, KEEP);
    return { externalMessageId };
  }

  async sendBatch(messages: OutgoingEmail[]): Promise<SendResult[]> {
    return Promise.all(messages.map((m) => this.sendEmail(m)));
  }

  async getMessageStatus(): Promise<null> {
    return null;
  }

  async handleWebhook(): Promise<NormalizedEmailEvent[]> {
    throw new WebhookVerificationFailed("The log provider has no webhooks");
  }
}
