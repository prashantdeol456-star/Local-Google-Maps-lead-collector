import type { Repositories } from "../../database/repositories/index.js";
import { maskSecret, type EmailConfig, type EmailProvider } from "../../providers/email/index.js";
import { EmailProviderError } from "../../providers/email/index.js";
import { AppError } from "../../utils/errors.js";

/** Public description of the configured provider — never includes secrets. */
export interface EmailProviderInfo {
  provider: EmailConfig["provider"];
  from: string;
  replyTo: string | null;
  sendsRealEmail: boolean;
  capabilities: EmailProvider["capabilities"];
  details: Record<string, string | number | boolean | null>;
  tracking: {
    clickTracking: boolean;
    publicBaseUrl: string | null;
    /** Where to point the provider webhook (null when the provider has none or no public URL is set). */
    webhookUrl: string | null;
  };
}

export class EmailService {
  constructor(
    private readonly provider: EmailProvider,
    private readonly config: EmailConfig,
    private readonly repos: Repositories,
    private readonly opts: { publicBaseUrl: string | null; trackClicks: boolean } = { publicBaseUrl: null, trackClicks: false },
  ) {}

  info(): EmailProviderInfo {
    const c = this.config;
    let details: EmailProviderInfo["details"];
    if (c.provider === "resend") details = { apiKey: maskSecret(c.apiKey), webhookSecret: c.webhookSecret ? "configured" : "not set" };
    else if (c.provider === "smtp") details = { host: c.host, port: c.port, secure: c.secure, user: c.user ?? null, password: c.password ? "configured" : "not set" };
    else details = { note: "Development mode: nothing is sent. Set EMAIL_PROVIDER in backend/.env to send real email." };

    return {
      provider: c.provider,
      from: this.provider.from,
      replyTo: c.replyTo ?? null,
      sendsRealEmail: c.provider !== "log",
      capabilities: this.provider.capabilities,
      details,
      tracking: {
        clickTracking: this.opts.trackClicks,
        publicBaseUrl: this.opts.publicBaseUrl,
        webhookUrl: c.provider === "resend" && this.opts.publicBaseUrl ? `${this.opts.publicBaseUrl}/api/webhooks/email/resend` : null,
      },
    };
  }

  /** Sends a fixed test message (content is not user-controlled, so the endpoint cannot be used to spam). */
  async sendTest(to: string, requestedBy: string): Promise<{ externalMessageId: string; provider: string; sentReal: boolean }> {
    const sentAt = new Date().toISOString();
    try {
      const { externalMessageId } = await this.provider.sendEmail({
        to,
        subject: "Test email from your Lead Platform",
        text: `This is a test email from your Lead Platform (provider: ${this.provider.name}).\n\nRequested by ${requestedBy} at ${sentAt}.\nIf you received it, email sending is configured correctly.`,
        html: `<p>This is a test email from your Lead Platform (provider: <b>${this.provider.name}</b>).</p><p>Requested at ${sentAt}.</p><p>If you received it, email sending is configured correctly.</p>`,
        tags: { kind: "test" },
      });
      await this.repos.agentLogs.create({
        jobId: null,
        action: "email_test_sent",
        status: "success",
        message: `To ${to} via ${this.provider.name} (${externalMessageId})`,
      });
      return { externalMessageId, provider: this.provider.name, sentReal: this.provider.name !== "log" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repos.agentLogs.create({ jobId: null, action: "email_test_failed", status: "error", message: `To ${to}: ${message}` });
      if (err instanceof EmailProviderError) throw new AppError(502, "EMAIL_PROVIDER_ERROR", message);
      throw err;
    }
  }
}
