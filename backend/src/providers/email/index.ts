import type { EmailConfig } from "./config.js";
import { LogEmailProvider } from "./log.js";
import { ResendEmailProvider } from "./resend.js";
import { SmtpEmailProvider } from "./smtp.js";
import type { EmailProvider } from "./types.js";

export function createEmailProvider(config: EmailConfig): EmailProvider {
  switch (config.provider) {
    case "log":
      return new LogEmailProvider(config.from);
    case "resend":
      return new ResendEmailProvider({
        apiKey: config.apiKey,
        from: config.from,
        replyTo: config.replyTo,
        webhookSecret: config.webhookSecret,
      });
    case "smtp":
      return new SmtpEmailProvider(config);
  }
}

export * from "./types.js";
export { maskSecret, parseEmailConfig, type EmailConfig } from "./config.js";
