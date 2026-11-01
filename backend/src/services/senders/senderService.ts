import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../../database/client.js";
import { createEmailProvider, type EmailConfig, type EmailProvider } from "../../providers/email/index.js";
import { createWhatsAppProvider, toWhatsAppNumber, type WhatsAppConfig, type WhatsAppProvider } from "../../providers/whatsapp/index.js";
import { Errors } from "../../utils/errors.js";
import type { SecretBox } from "../../utils/secretBox.js";

// Each customer sends with their own email and WhatsApp account (phase C). Super admins, and
// data from before user accounts, use the platform senders from .env. Secrets are stored
// encrypted (SecretBox) and never returned by the API.

export type SenderChannel = "email" | "whatsapp";

export interface EmailSenderInput {
  provider: "resend" | "smtp" | "log";
  from: string;
  replyTo?: string | null;
  apiKey?: string | null;
  webhookSecret?: string | null;
  host?: string | null;
  port?: number | null;
  secure?: boolean | null;
  user?: string | null;
  password?: string | null;
}

export interface WhatsAppSenderInput {
  provider: "meta" | "log";
  accessToken?: string | null;
  phoneNumberId?: string | null;
  appSecret?: string | null;
  verifyToken?: string | null;
}

export interface SenderView {
  email: { provider: string; from: string } | null;
  whatsapp: { provider: string; phoneNumberId: string | null } | null;
  /** Where to point the provider webhooks (null until a public URL is set) */
  webhooks: { email: string | null; whatsapp: string | null };
}

interface Options {
  platformEmail: EmailProvider;
  platformWhatsApp: WhatsAppProvider;
  publicBaseUrl: string | null;
  /** "log" senders (record, do not deliver) are only for development and tests. */
  allowLogProvider: boolean;
}

const parseJson = <T>(v: string | null): T | null => (v ? (JSON.parse(v) as T) : null);

export class SenderService {
  private readonly cache = new Map<string, { at: number; email: EmailProvider | null; whatsapp: WhatsAppProvider | null }>();

  constructor(
    private readonly db: PrismaClient,
    private readonly box: SecretBox,
    private readonly opts: Options,
  ) {}

  private async isSuperAdmin(ownerId: string) {
    return (await this.db.adminUser.findUnique({ where: { id: ownerId }, select: { role: true } }))?.role === "super_admin";
  }

  private async row(ownerId: string) {
    return this.db.senderSettings.findUnique({ where: { ownerId } });
  }

  private async ensureRow(ownerId: string) {
    return (
      (await this.row(ownerId)) ??
      this.db.senderSettings.create({ data: { ownerId, webhookToken: randomBytes(18).toString("base64url") } })
    );
  }

  async view(ownerId: string): Promise<SenderView> {
    const row = await this.ensureRow(ownerId);
    const base = this.opts.publicBaseUrl;
    const email = parseJson<{ provider: string; from: string }>(row.emailSummary);
    const whatsapp = parseJson<{ provider: string; phoneNumberId: string | null }>(row.whatsappSummary);
    return {
      email,
      whatsapp,
      webhooks: {
        email: base && email?.provider === "resend" ? `${base}/api/webhooks/u/${row.webhookToken}/email/resend` : null,
        whatsapp: base && whatsapp?.provider === "meta" ? `${base}/api/webhooks/u/${row.webhookToken}/whatsapp/meta` : null,
      },
    };
  }

  private checkProvider(provider: string) {
    if (provider === "log" && !this.opts.allowLogProvider) throw Errors.badRequest("Choose Resend or SMTP");
  }

  async saveEmail(ownerId: string, input: EmailSenderInput): Promise<SenderView> {
    this.checkProvider(input.provider);
    const replyTo = input.replyTo?.trim() || undefined;
    let config: EmailConfig;
    if (input.provider === "resend") {
      if (!input.apiKey) throw Errors.badRequest("Resend API key is required");
      if (input.webhookSecret && !input.webhookSecret.startsWith("whsec_")) throw Errors.badRequest("The webhook signing secret starts with whsec_");
      config = { provider: "resend", from: input.from, replyTo, apiKey: input.apiKey.trim(), webhookSecret: input.webhookSecret?.trim() || undefined };
    } else if (input.provider === "smtp") {
      if (!input.host) throw Errors.badRequest("SMTP host is required");
      if (input.user && !input.password) throw Errors.badRequest("SMTP password is required with a user name");
      const port = input.port ?? 587;
      config = { provider: "smtp", from: input.from, replyTo, host: input.host.trim(), port, secure: input.secure ?? port === 465, user: input.user || undefined, password: input.password || undefined };
    } else {
      config = { provider: "log", from: input.from, replyTo };
    }
    await this.ensureRow(ownerId);
    await this.db.senderSettings.update({
      where: { ownerId },
      data: { emailConfig: this.box.seal(JSON.stringify(config)), emailSummary: JSON.stringify({ provider: config.provider, from: config.from }) },
    });
    this.cache.delete(ownerId);
    return this.view(ownerId);
  }

  async saveWhatsApp(ownerId: string, input: WhatsAppSenderInput): Promise<SenderView> {
    this.checkProvider(input.provider);
    let config: WhatsAppConfig;
    if (input.provider === "meta") {
      if (!input.accessToken || !input.phoneNumberId) throw Errors.badRequest("Access token and phone number ID are required");
      if (!/^\d+$/.test(input.phoneNumberId.trim())) throw Errors.badRequest("The phone number ID is numeric");
      if (input.verifyToken && input.verifyToken.trim().length < 8) throw Errors.badRequest("Use at least 8 characters for the verify token");
      config = {
        provider: "meta",
        accessToken: input.accessToken.trim(),
        phoneNumberId: input.phoneNumberId.trim(),
        appSecret: input.appSecret?.trim() || undefined,
        verifyToken: input.verifyToken?.trim() || undefined,
        apiVersion: "v26.0",
        endpoint: "messages",
      };
    } else {
      config = { provider: "log" };
    }
    await this.ensureRow(ownerId);
    await this.db.senderSettings.update({
      where: { ownerId },
      data: {
        whatsappConfig: this.box.seal(JSON.stringify(config)),
        whatsappSummary: JSON.stringify({ provider: config.provider, phoneNumberId: config.provider === "meta" ? config.phoneNumberId : null }),
      },
    });
    this.cache.delete(ownerId);
    return this.view(ownerId);
  }

  async clear(ownerId: string, channel: SenderChannel): Promise<SenderView> {
    await this.ensureRow(ownerId);
    await this.db.senderSettings.update({
      where: { ownerId },
      data: channel === "email" ? { emailConfig: null, emailSummary: null } : { whatsappConfig: null, whatsappSummary: null },
    });
    this.cache.delete(ownerId);
    return this.view(ownerId);
  }

  /** The user's own providers, built from their saved settings (cached until they change). */
  private async own(ownerId: string) {
    const row = await this.row(ownerId);
    if (!row) return { email: null, whatsapp: null };
    const at = row.updatedAt.getTime();
    const hit = this.cache.get(ownerId);
    if (hit && hit.at === at) return hit;
    const email = row.emailConfig ? createEmailProvider(JSON.parse(this.box.open(row.emailConfig)) as EmailConfig) : null;
    const whatsapp = row.whatsappConfig ? createWhatsAppProvider(JSON.parse(this.box.open(row.whatsappConfig)) as WhatsAppConfig) : null;
    const entry = { at, email, whatsapp };
    this.cache.set(ownerId, entry);
    return entry;
  }

  /** Sender for a campaign/send by this owner: the platform's for super admins, else their own (or null). */
  async emailFor(ownerId: string | null | undefined): Promise<EmailProvider | null> {
    if (!ownerId || (await this.isSuperAdmin(ownerId))) return this.opts.platformEmail;
    return (await this.own(ownerId)).email;
  }

  async whatsappFor(ownerId: string | null | undefined): Promise<WhatsAppProvider | null> {
    if (!ownerId || (await this.isSuperAdmin(ownerId))) return this.opts.platformWhatsApp;
    return (await this.own(ownerId)).whatsapp;
  }

  /** The user whose webhook URL this is, and their providers. */
  async byWebhookToken(token: string) {
    const row = await this.db.senderSettings.findUnique({ where: { webhookToken: token } });
    return row ? { ownerId: row.ownerId, ...(await this.own(row.ownerId)) } : null;
  }

  /** Test message through the user's own sender (WhatsApp: an approved template, e.g. hello_world). */
  async sendTest(ownerId: string, channel: SenderChannel, to: string, template = { name: "hello_world", language: "en_US" }) {
    if (channel === "email") {
      const provider = await this.emailFor(ownerId);
      if (!provider) throw Errors.conflict("SENDER_REQUIRED", "Connect your email sender first");
      const res = await provider.sendEmail({
        to,
        subject: "Test email from Lead Platform",
        text: "Your email sender is connected. Campaign emails will be sent from this account.",
        html: "<p>Your email sender is connected. Campaign emails will be sent from this account.</p>",
      });
      return { ok: true, provider: provider.name, externalMessageId: res.externalMessageId };
    }
    const provider = await this.whatsappFor(ownerId);
    if (!provider) throw Errors.conflict("SENDER_REQUIRED", "Connect your WhatsApp sender first");
    const number = toWhatsAppNumber(to);
    if (!number) throw Errors.badRequest("Enter a valid mobile number with country code, e.g. +91 98765 43210");
    const res = await provider.sendTemplate({ to: number, templateName: template.name, language: template.language, bodyParams: [], callbackData: "test" });
    return { ok: true, provider: provider.name, externalMessageId: res.externalMessageId };
  }
}
