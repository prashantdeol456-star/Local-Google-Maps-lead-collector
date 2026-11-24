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

  /** Chat messages "sent" in development (nothing leaves the server). */
  readonly sentChats: { to: string; type: string; text: string | null; externalMessageId: string; at: Date }[] = [];

  private keep(to: string, type: string, text: string | null): WhatsAppSendResult {
    const externalMessageId = `wa_log_${randomUUID()}`;
    this.sentChats.unshift({ to, type, text, externalMessageId, at: new Date() });
    this.sentChats.length = Math.min(this.sentChats.length, 50);
    return { externalMessageId };
  }

  async sendText(to: string, text: string): Promise<WhatsAppSendResult> {
    return this.keep(to, "text", text);
  }

  async uploadMedia(): Promise<string> {
    return `log_media_${randomUUID()}`;
  }

  async sendMedia(to: string, media: { kind: string; caption?: string | null }): Promise<WhatsAppSendResult> {
    return this.keep(to, media.kind, media.caption ?? null);
  }

  async markRead(): Promise<void> {}

  async downloadMedia(): Promise<null> {
    return null;
  }

  verifySubscription(): string | null {
    return null;
  }

  async handleWebhook(): Promise<WhatsAppEvent[]> {
    throw new WhatsAppWebhookRejected("The log provider has no webhooks");
  }
}
