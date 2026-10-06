import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseEmailConfig, type EmailConfig } from "./providers/email/config.js";
import { parseWhatsAppConfig, type WhatsAppConfig } from "./providers/whatsapp/config.js";
import { parseAiConfig, type AiConfig } from "./providers/ai/config.js";
import { isValidTimeZone } from "./utils/time.js";
import { checkDatabaseUrl, parseTrustProxy, productionChecks } from "./configChecks.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(24),
  // 0 = extension tokens never expire (they can still be revoked)
  API_TOKEN_TTL_DAYS: z.coerce.number().min(0).default(90),
  // Extra browser origins allowed to call the API (comma-separated), e.g. a hosted admin panel.
  // The Chrome extension does not need an entry: its host_permissions exempt it from CORS.
  CORS_ORIGINS: z.string().default(""),
  // Public address of this backend (https), used in unsubscribe links. Required to start
  // campaigns with a real email provider. Example: https://leads.example.com
  PUBLIC_BASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  // Count clicks by routing email links through this backend (needs PUBLIC_BASE_URL to work for recipients).
  EMAIL_TRACK_CLICKS: z.enum(["true", "false"]).default("true"),
  // Used for "today" in stats and for campaign sending windows.
  APP_TIMEZONE: z.string().default("Asia/Kolkata").refine(isValidTimeZone, "APP_TIMEZONE is not a valid IANA time zone"),
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters").optional(),
  // sqlite (default, local) or postgresql (server). The Prisma client must be generated for it.
  DATABASE_PROVIDER: z.string().optional(),
  // Behind a reverse proxy (Caddy, nginx): "true" trusts X-Forwarded-For/-Proto, a number trusts
  // that many hops, or a comma-separated list of proxy IPs. Needed for real client IPs (rate
  // limits) and https detection. Leave "false" when the backend is reached directly.
  TRUST_PROXY: z.string().default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

const env = EnvSchema.parse(process.env);
const dbProblem = checkDatabaseUrl(env);
if (dbProblem) throw new Error(dbProblem);
const checks = env.NODE_ENV === "production" ? productionChecks(env) : { errors: [], warnings: [] };
if (checks.errors.length) {
  throw new Error(`Unsafe production settings in backend/.env:\n- ${checks.errors.join("\n- ")}`);
}

/** SQLite file URLs are resolved relative to the backend folder (same as Prisma CLI). */
function resolveDatabaseUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const file = url.slice("file:".length);
  return path.isAbsolute(file) ? file : path.resolve(backendRoot, file);
}

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  port: env.PORT,
  host: env.HOST,
  trustProxy: parseTrustProxy(env.TRUST_PROXY) as boolean | number | string[],
  logLevel: (env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug")) as string,
  /** Shown once at startup. */
  startupWarnings: checks.warnings as string[],
  databaseUrl: resolveDatabaseUrl(env.DATABASE_URL),
  /** Built admin panel (npm run build:admin writes here). */
  adminDir: path.resolve(backendRoot, "public/admin") as string,
  sessionSecret: env.SESSION_SECRET,
  sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  loginRateLimitPerMinute: 5 as number,
  timeZone: env.APP_TIMEZONE,
  email: parseEmailConfig(process.env) as EmailConfig,
  whatsapp: parseWhatsAppConfig(process.env) as WhatsAppConfig,
  ai: parseAiConfig(process.env) as AiConfig,
  trackClicks: env.EMAIL_TRACK_CLICKS === "true",
  publicBaseUrl: (env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? null) as string | null,
  apiTokenTtlMs: env.API_TOKEN_TTL_DAYS > 0 ? env.API_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 : null,
  corsOrigins: env.CORS_ORIGINS.split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  initialAdmin:
    env.ADMIN_EMAIL && env.ADMIN_PASSWORD
      ? { email: env.ADMIN_EMAIL.toLowerCase(), password: env.ADMIN_PASSWORD }
      : null,
} as const;

export type AppConfig = typeof config;
