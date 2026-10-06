import { z } from "zod";
import type { EmailProviderName } from "./types.js";

const ADDRESS = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/;
const NAMED_ADDRESS = /^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/;

const fromAddress = z
  .string()
  .trim()
  .refine((v) => ADDRESS.test(v) || NAMED_ADDRESS.test(v), 'must look like "you@domain.com" or "Name <you@domain.com>"');

const empty = (v: unknown) => (v === "" ? undefined : v);

const EmailEnv = z.object({
  EMAIL_PROVIDER: z.enum(["log", "resend", "smtp"]).default("log"),
  EMAIL_FROM: z.preprocess(empty, fromAddress.optional()),
  EMAIL_REPLY_TO: z.preprocess(empty, z.string().trim().regex(ADDRESS, "must be an email address").optional()),
  RESEND_API_KEY: z.preprocess(empty, z.string().trim().optional()),
  RESEND_WEBHOOK_SECRET: z.preprocess(empty, z.string().trim().startsWith("whsec_", "must start with whsec_").optional()),
  SMTP_HOST: z.preprocess(empty, z.string().trim().optional()),
  SMTP_PORT: z.preprocess(empty, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_SECURE: z.preprocess(empty, z.enum(["true", "false"]).optional()),
  SMTP_USER: z.preprocess(empty, z.string().optional()),
  SMTP_PASSWORD: z.preprocess(empty, z.string().optional()),
});

export type EmailConfig =
  | { provider: "log"; from: string; replyTo?: string }
  | { provider: "resend"; from: string; replyTo?: string; apiKey: string; webhookSecret?: string }
  | {
      provider: "smtp";
      from: string;
      replyTo?: string;
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      password?: string;
    };

const DEV_FROM = "Lead Platform (dev) <noreply@localhost.test>";

/** Validates email settings from the environment; throws a readable error listing what is missing. */
export function parseEmailConfig(env: Record<string, string | undefined>): EmailConfig {
  const parsed = EmailEnv.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`Email settings: ${issue.path.join(".")} ${issue.message}`);
  }
  const e = parsed.data;
  const provider: EmailProviderName = e.EMAIL_PROVIDER;
  const missing = (names: string[]) => {
    const absent = names.filter((n) => !e[n as keyof typeof e]);
    if (absent.length) throw new Error(`Email settings: EMAIL_PROVIDER=${provider} needs ${absent.join(", ")} in backend/.env`);
  };

  switch (provider) {
    case "log":
      return { provider, from: e.EMAIL_FROM ?? DEV_FROM, replyTo: e.EMAIL_REPLY_TO };
    case "resend":
      missing(["EMAIL_FROM", "RESEND_API_KEY"]);
      return { provider, from: e.EMAIL_FROM!, replyTo: e.EMAIL_REPLY_TO, apiKey: e.RESEND_API_KEY!, webhookSecret: e.RESEND_WEBHOOK_SECRET };
    case "smtp": {
      missing(["EMAIL_FROM", "SMTP_HOST"]);
      const port = e.SMTP_PORT ?? 587;
      if (e.SMTP_USER && !e.SMTP_PASSWORD) throw new Error("Email settings: SMTP_PASSWORD is required when SMTP_USER is set");
      return {
        provider,
        from: e.EMAIL_FROM!,
        replyTo: e.EMAIL_REPLY_TO,
        host: e.SMTP_HOST!,
        port,
        secure: e.SMTP_SECURE ? e.SMTP_SECURE === "true" : port === 465,
        user: e.SMTP_USER,
        password: e.SMTP_PASSWORD,
      };
    }
  }
}

/** Last 4 characters only, for showing which key is configured. */
export function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  return value.length <= 8 ? "••••" : `••••${value.slice(-4)}`;
}
