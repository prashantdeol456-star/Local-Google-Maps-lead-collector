// Checks on the environment settings, kept apart from config.ts so they can be tested
// without loading backend/.env.

import { parseDbProvider } from "./database/client.js";

/** The settings these checks read (a subset of the validated environment). */
export interface Env {
  NODE_ENV: "development" | "production" | "test";
  HOST: string;
  DATABASE_URL: string;
  DATABASE_PROVIDER?: string | undefined;
  SESSION_SECRET: string;
  ADMIN_PASSWORD?: string | undefined;
  PUBLIC_BASE_URL?: string | undefined;
  CORS_ORIGINS: string;
  TRUST_PROXY: string;
}

/** Fastify trustProxy value from TRUST_PROXY. */
export function parseTrustProxy(value: string): boolean | number | string[] {
  const v = value.trim().toLowerCase();
  if (v === "" || v === "false") return false;
  if (v === "true") return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

const EXAMPLE_VALUES = ["change-me", "change-me-to-a-long-random-string-at-least-32-chars"];

/**
 * Settings that are fine on a laptop but unsafe on a server. In production the backend refuses
 * to start until they are fixed (errors); warnings are logged.
 */
export function productionChecks(e: Env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (EXAMPLE_VALUES.some((x) => e.SESSION_SECRET.includes(x))) errors.push("SESSION_SECRET is still the example value: set a long random string");
  if (e.ADMIN_PASSWORD && (EXAMPLE_VALUES.includes(e.ADMIN_PASSWORD) || e.ADMIN_PASSWORD.length < 12)) {
    errors.push("ADMIN_PASSWORD must be at least 12 characters and not the example value (or remove it once the admin exists)");
  }
  if (!e.PUBLIC_BASE_URL) errors.push("PUBLIC_BASE_URL is required in production (the https address of this backend)");
  else if (!e.PUBLIC_BASE_URL.startsWith("https://")) errors.push("PUBLIC_BASE_URL must start with https:// in production");
  for (const o of e.CORS_ORIGINS.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!o.startsWith("https://")) errors.push(`CORS_ORIGINS entry "${o}" must use https:// in production`);
  }
  const provider = parseDbProvider(e.DATABASE_PROVIDER);
  if (provider === "sqlite") warnings.push("DATABASE_PROVIDER is sqlite: fine for one small server, PostgreSQL is recommended for production");
  if (e.HOST === "0.0.0.0" && parseTrustProxy(e.TRUST_PROXY) === false) {
    warnings.push("HOST=0.0.0.0 without TRUST_PROXY: if a reverse proxy is in front, set TRUST_PROXY so rate limits see real client IPs");
  }
  return { errors, warnings };
}

/** DATABASE_URL must match DATABASE_PROVIDER. */
export function checkDatabaseUrl(e: Env): string | null {
  const provider = parseDbProvider(e.DATABASE_PROVIDER);
  const isPg = /^postgres(ql)?:\/\//.test(e.DATABASE_URL);
  if (provider === "postgresql" && !isPg) return "DATABASE_PROVIDER=postgresql needs a postgresql:// DATABASE_URL";
  if (provider === "sqlite" && isPg) return "DATABASE_URL is a PostgreSQL URL: also set DATABASE_PROVIDER=postgresql";
  return null;
}
