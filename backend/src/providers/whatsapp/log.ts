// Development provider: sends nothing; keeps the last 50 messages in memory.

import { randomUUID } from "node:crypto";
import { WhatsAppWebhookRejected, type OutgoingTemplate, type WhatsAppEvent, type WhatsAppProvider, type WhatsAppSendResult } from "./types.js";

export class LogWhatsAppProvider implements WhatsAppProvider {
  readonly name = "log" as const;
  readonly capabilities = { delivery: false, read: false, replies: false };
  readonly sender = "development (nothing is sent)";
  readonly outbox: (OutgoingTemplate & { externalMessageId: string; at: Date })[] = [];

  async sendTemplate(message: OutgoingTemplate): Promise<WhatsAppSendResult> {
    const externalMessageId = `wa_log_${randomUUID()}`;
    this.outbox.unshift({ ...message, externalMessageId, at: new Date() });
    this.outbox.length = Math.min(this.outbox.length, 50);
    return { externalMessageId };
  }

  verifySubscription(): string | null {
    return null;
  }

  async handleWebhook(): Promise<WhatsAppEvent[]> {
    throw new WhatsAppWebhookRejected("The log provider has no webhooks");
  }
}
