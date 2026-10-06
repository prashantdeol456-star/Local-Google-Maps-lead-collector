import type { Repositories } from "../../database/repositories/index.js";
import {
  toWhatsAppNumber,
  WhatsAppProviderError,
  type TemplateParam,
  type WhatsAppConfig,
  type WhatsAppProvider,
} from "../../providers/whatsapp/index.js";
import { maskSecret } from "../../providers/email/index.js";
import { AppError, Errors } from "../../utils/errors.js";

export interface WhatsAppProviderInfo {
  provider: WhatsAppConfig["provider"];
  sendsRealMessages: boolean;
  sender: string;
  capabilities: WhatsAppProvider["capabilities"];
  details: Record<string, string | null>;
  webhook: { url: string | null; verifyTokenSet: boolean; appSecretSet: boolean };
}

export class WhatsAppService {
  constructor(
    private readonly provider: WhatsAppProvider,
    private readonly config: WhatsAppConfig,
    private readonly repos: Repositories,
    private readonly publicBaseUrl: string | null,
  ) {}

  info(): WhatsAppProviderInfo {
    const c = this.config;
    return {
      provider: c.provider,
      sendsRealMessages: c.provider !== "log",
      sender: this.provider.sender,
      capabilities: this.provider.capabilities,
      details:
        c.provider === "meta"
          ? { phoneNumberId: c.phoneNumberId, accessToken: maskSecret(c.accessToken), apiVersion: c.apiVersion, endpoint: c.endpoint }
          : { note: "Development mode: nothing is sent. Set WHATSAPP_PROVIDER=meta in backend/.env to send real messages." },
      webhook: {
        url: c.provider === "meta" && this.publicBaseUrl ? `${this.publicBaseUrl}/api/webhooks/whatsapp/meta` : null,
        verifyTokenSet: c.provider === "meta" && !!c.verifyToken,
        appSecretSet: c.provider === "meta" && !!c.appSecret,
      },
    };
  }

  /**
   * Sends one approved template to one number, to test the setup (meant for your own number).
   * WhatsApp only delivers templates that Meta has approved for this business account.
   */
  async sendTest(input: { to: string; templateName: string; language: string; params: TemplateParam[] }) {
    const to = toWhatsAppNumber(input.to);
    if (!to) throw Errors.badRequest("Enter a valid mobile number with country code, e.g. +91 98765 43210");
    try {
      const { externalMessageId } = await this.provider.sendTemplate({
        to,
        templateName: input.templateName,
        language: input.language,
        bodyParams: input.params,
        callbackData: "test",
      });
      await this.repos.agentLogs.create({
        jobId: null,
        action: "whatsapp_test_sent",
        status: "success",
        message: `Template "${input.templateName}" to +${to} via ${this.provider.name} (${externalMessageId})`,
      });
      return { externalMessageId, provider: this.provider.name, sentReal: this.provider.name !== "log", to: `+${to}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repos.agentLogs.create({ jobId: null, action: "whatsapp_test_failed", status: "error", message: `+${to}: ${message}` });
      if (err instanceof WhatsAppProviderError) throw new AppError(502, "WHATSAPP_PROVIDER_ERROR", message);
      throw err;
    }
  }
}
