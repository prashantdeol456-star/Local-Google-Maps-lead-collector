import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp, type AppDeps } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createPrismaClient, DB_PROVIDER, splitPostgresUrl } from "../src/database/client.js";

export const TEST_ALLOWED_ORIGIN = "https://admin.example.test";

/** True when the suite runs against PostgreSQL (DATABASE_PROVIDER=postgresql + TEST_DATABASE_URL). */
export const ON_POSTGRES = DB_PROVIDER === "postgresql";

/** A fresh PostgreSQL schema with the PostgreSQL migrations applied; dropped by the returned cleanup. */
export async function postgresTestDb(): Promise<{ url: string; drop: () => Promise<void> }> {
  const configured = process.env.TEST_DATABASE_URL;
  if (!configured) throw new Error("Set TEST_DATABASE_URL to run the tests on PostgreSQL");
  const base = splitPostgresUrl(configured).connectionString; // for the setup client
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const client = new pg.Client({ connectionString: base });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const dir = path.resolve(import.meta.dirname, "../prisma/postgres/migrations");
    for (const name of readdirSync(dir).filter((n) => !n.endsWith(".toml")).sort()) {
      await client.query(readFileSync(path.join(dir, name, "migration.sql"), "utf8").replace(/CREATE SCHEMA IF NOT EXISTS "public";/g, ""));
    }
  } finally {
    await client.end();
  }
  const url = new URL(configured);
  url.searchParams.set("schema", schema);
  return {
    url: url.toString(),
    async drop() {
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`DROP SCHEMA "${schema}" CASCADE`);
      await c.end();
    },
  };
}

/** Builds the app against a fresh temporary database (SQLite file, or a PostgreSQL schema) with all migrations applied. */

export async function createTestApp(overrides: Partial<AppConfig> = {}, deps: Pick<AppDeps, "emailProvider" | "whatsappProvider" | "aiNavigator" | "socialFetch" | "replyWriter" | "inboxFetch"> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mlc-test-"));
  let dbFile = path.join(dir, "test.db");
  let dropDb: (() => Promise<void>) | null = null;

  if (ON_POSTGRES) {
    const created = await postgresTestDb();
    dbFile = created.url;
    dropDb = created.drop;
  } else {
    const raw = new Database(dbFile);
    const migrationsDir = path.resolve(import.meta.dirname, "../prisma/migrations");
    for (const name of readdirSync(migrationsDir).filter((n) => !n.endsWith(".toml")).sort()) {
      raw.exec(readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
    }
    raw.close();
  }

  const config: AppConfig = {
    env: "test",
    isProduction: false,
    port: 0,
    host: "127.0.0.1",
    trustProxy: false,
    logLevel: "silent",
    startupWarnings: [],
    databaseUrl: dbFile,
    adminDir: path.join(dir, "no-admin-build"),
    sessionSecret: "test-secret-test-secret-test-secret-123",
    sessionTtlMs: 60 * 60 * 1000,
    loginRateLimitPerMinute: 5,
    timeZone: "Asia/Kolkata",
    email: { provider: "log", from: "Test <noreply@test.local>" },
    whatsapp: { provider: "log" },
    ai: { provider: "off" },
    social: { meta: null, linkedin: null, redirectBaseUrl: "http://localhost:3000" },
    inbox: { ai: null, telegramBotToken: null, pollSeconds: 60 },
    publicBaseUrl: null,
    trackClicks: true,
    apiTokenTtlMs: 24 * 60 * 60 * 1000,
    corsOrigins: [TEST_ALLOWED_ORIGIN],
    initialAdmin: { email: "admin@test.local", password: "test-password-123" },
    ...overrides,
  };

  const db = createPrismaClient(dbFile);
  const app = await buildApp({ config, db, logger: false, ...deps });
  await app.authService.ensureInitialAdmin(config.initialAdmin);

  return {
    app,
    db,
    credentials: config.initialAdmin!,
    async close() {
      await app.close();
      await db.$disconnect();
      await dropDb?.();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
