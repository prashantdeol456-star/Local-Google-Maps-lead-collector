// Plain SMTP (Gmail, Zoho, Outlook, your own server…) via nodemailer.
// SMTP only reports "accepted by the server": no delivery/open/click events.

import nodemailer, { type Transporter } from "nodemailer";
import {
  EmailProviderError,
  NO_CAPABILITIES,
  WebhookVerificationFailed,
  type EmailProvider,
  type NormalizedEmailEvent,
  type OutgoingEmail,
  type SendResult,
} from "./types.js";

export interface SmtpOptions {
  host: string;
  port: number;
  /** true = TLS from the start (port 465); false = STARTTLS when offered (587). */
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
  /** Only for local test servers. Never disable certificate checks for real servers. */
  allowSelfSigned?: boolean;
}

// Errors where trying again later can help (connection problems, 4xx temporary SMTP codes).
const RETRYABLE_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET"]);

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp" as const;
  readonly capabilities = { ...NO_CAPABILITIES };
  readonly from: string;
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.from = options.from;
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.user ? { user: options.user, pass: options.password ?? "" } : undefined,
      tls: options.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  async sendEmail(message: OutgoingEmail): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: message.to,
        replyTo: message.replyTo ?? this.options.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: {
          ...message.headers,
          // Correlation tags travel as headers (SMTP has no tag concept).
          ...Object.fromEntries(Object.entries(message.tags ?? {}).map(([k, v]) => [`X-Lead-Platform-${k}`, v])),
        },
      });
      return { externalMessageId: String(info.messageId) };
    } catch (err) {
      const e = err as { code?: string; responseCode?: number; message?: string };
      const temporary = (e.responseCode !== undefined && e.responseCode >= 400 && e.responseCode < 500) || RETRYABLE_CODES.has(e.code ?? "");
      const hint = e.code === "EAUTH" ? " (check SMTP_USER / SMTP_PASSWORD)" : "";
      throw new EmailProviderError(`SMTP: ${e.message ?? "send failed"}${hint}`, temporary, e.responseCode);
    }
  }

  async sendBatch(messages: OutgoingEmail[]): Promise<SendResult[]> {
    const results: SendResult[] = [];
    for (const m of messages) results.push(await this.sendEmail(m));
    return results;
  }

  async getMessageStatus(): Promise<null> {
    return null; // SMTP cannot report status after hand-off
  }

  async handleWebhook(): Promise<NormalizedEmailEvent[]> {
    throw new WebhookVerificationFailed("SMTP has no webhooks");
  }

  /** Checks connection and login without sending anything. */
  async verify(): Promise<void> {
    try {
      await this.transport.verify();
    } catch (err) {
      throw new EmailProviderError(`SMTP: ${(err as Error).message}`, true);
    }
  }

  close() {
    this.transport.close();
  }
}
