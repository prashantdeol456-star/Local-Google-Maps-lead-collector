import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDatabaseUrl, parseTrustProxy, productionChecks, type Env } from "../src/configChecks.js";
import { createTestApp } from "./helpers.js";

const good: Env = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  DATABASE_URL: "postgresql://leads:secret@db:5432/leads",
  DATABASE_PROVIDER: "postgresql",
  SESSION_SECRET: "k3J9x-0aQw7mZpL2vB8nR4tY6uE1sD5fG",
  ADMIN_PASSWORD: undefined,
  PUBLIC_BASE_URL: "https://leads.example.com",
  CORS_ORIGINS: "",
  TRUST_PROXY: "1",
};

describe("production settings", () => {
  it("accepts a safe production configuration", () => {
    expect(productionChecks(good)).toEqual({ errors: [], warnings: [] });
  });

  it("refuses example secrets, weak admin passwords, http public URLs and http CORS origins", () => {
    const { errors } = productionChecks({
      ...good,
      SESSION_SECRET: "change-me-to-a-long-random-string-at-least-32-chars",
      ADMIN_PASSWORD: "change-me",
      PUBLIC_BASE_URL: "http://leads.example.com",
      CORS_ORIGINS: "http://admin.example.com, https://ok.example.com",
    });
    expect(errors).toHaveLength(4);
    expect(errors.join("\n")).toMatch(/SESSION_SECRET[\s\S]*ADMIN_PASSWORD[\s\S]*https[\s\S]*CORS_ORIGINS entry "http:\/\/admin.example.com"/);
    expect(productionChecks({ ...good, PUBLIC_BASE_URL: undefined }).errors[0]).toContain("PUBLIC_BASE_URL is required");
  });

  it("warns about SQLite and a public HOST without a trusted proxy", () => {
    const { warnings } = productionChecks({ ...good, DATABASE_PROVIDER: undefined, DATABASE_URL: "file:../data/app.db", TRUST_PROXY: "false" });
    expect(warnings.join("\n")).toMatch(/sqlite[\s\S]*TRUST_PROXY/);
  });

  it("checks that DATABASE_URL matches DATABASE_PROVIDER", () => {
    expect(checkDatabaseUrl(good)).toBeNull();
    expect(checkDatabaseUrl({ ...good, DATABASE_PROVIDER: undefined })).toContain("DATABASE_PROVIDER=postgresql");
    expect(checkDatabaseUrl({ ...good, DATABASE_URL: "file:../data/app.db" })).toContain("postgresql://");
  });

  it("parses TRUST_PROXY", () => {
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("10.0.0.1, 10.0.0.2")).toEqual(["10.0.0.1", "10.0.0.2"]);
  });
});

describe("HTTP hardening", () => {
  it("adds security headers to API responses, and HSTS only in production over https", async () => {
    const dev = await createTestApp();
    try {
      const res = await dev.app.inject({ method: "GET", url: "/api/health" });
      expect(res.headers).toMatchObject({ "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" });
      expect(res.headers["strict-transport-security"]).toBeUndefined();
    } finally {
      await dev.close();
    }
    const prod = await createTestApp({ isProduction: true, trustProxy: true });
    try {
      const https = await prod.app.inject({ method: "GET", url: "/api/health", headers: { "x-forwarded-proto": "https" } });
      expect(https.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
      const http = await prod.app.inject({ method: "GET", url: "/api/health" });
      expect(http.headers["strict-transport-security"]).toBeUndefined();
    } finally {
      await prod.close();
    }
  });

  it("behind a trusted proxy, login rate limits apply per real client IP", async () => {
    const t = await createTestApp({ trustProxy: true, loginRateLimitPerMinute: 2 });
    try {
      const login = (ip: string) =>
        t.app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-forwarded-for": ip }, payload: { email: "x@y.in", password: "wrong-password" } });
      expect((await login("203.0.113.1")).statusCode).toBe(401);
      expect((await login("203.0.113.1")).statusCode).toBe(401);
      expect((await login("203.0.113.1")).statusCode).toBe(429);
      expect((await login("203.0.113.2")).statusCode).toBe(401); // another client is not blocked
    } finally {
      await t.close();
    }
  });

  it("serves a rebuilt admin panel without a restart; hashed assets are cached, missing files are 404", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mlc-admin-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>v1</title><script src=/admin/assets/app-1.js></script>");
    writeFileSync(path.join(dir, "assets", "app-1.js"), "1");
    const t = await createTestApp({ adminDir: dir });
    try {
      expect((await t.app.inject({ method: "GET", url: "/admin/leads/abc" })).body).toContain("<title>v1</title>");

      // npm run build:admin while the backend runs: new index and a new hashed asset.
      writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>v2</title><script src=/admin/assets/app-2.js></script>");
      writeFileSync(path.join(dir, "assets", "app-2.js"), "2");
      const page = await t.app.inject({ method: "GET", url: "/admin/campaigns" });
      expect(page.body).toContain("<title>v2</title>");
      expect(page.headers["cache-control"]).toBe("no-cache");
      expect(page.headers["content-security-policy"]).toContain("default-src 'self'");
      const asset = await t.app.inject({ method: "GET", url: "/admin/assets/app-2.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

      const missing = await t.app.inject({ method: "GET", url: "/admin/assets/nope.js" });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe("NOT_FOUND");
    } finally {
      await t.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("maintenance", () => {
  it("removes expired sessions and old webhook logs, keeps recent ones and pending deliveries", async () => {
    const { MaintenanceWorker } = await import("../src/jobs/maintenanceWorker.js");
    const { createRepositories } = await import("../src/database/repositories/index.js");
    const t = await createTestApp();
    try {
      const now = new Date("2026-10-06T12:00:00Z");
      const day = 86_400_000;
      const admin = await t.db.adminUser.findFirstOrThrow();
      await t.db.session.createMany({
        data: [
          { tokenHash: "old", userId: admin.id, expiresAt: new Date(now.getTime() - 1000) },
          { tokenHash: "live", userId: admin.id, expiresAt: new Date(now.getTime() + day) },
        ],
      });
      const e = await t.db.webhookEndpoint.create({ data: { name: "n8n", url: "http://localhost:5678/x", secretEnc: "x", secretHint: "abcd", events: "[]" } });
      const at = (days: number) => new Date(now.getTime() - days * day);
      await t.db.webhookDelivery.createMany({
        data: [
          { endpointId: e.id, eventId: "a", event: "lead.created", payload: "{}", status: "delivered", createdAt: at(31) },
          { endpointId: e.id, eventId: "b", event: "lead.created", payload: "{}", status: "delivered", createdAt: at(5) },
          { endpointId: e.id, eventId: "c", event: "lead.created", payload: "{}", status: "failed", createdAt: at(91) },
          { endpointId: e.id, eventId: "d", event: "lead.created", payload: "{}", status: "failed", createdAt: at(31) },
          { endpointId: e.id, eventId: "f", event: "lead.created", payload: "{}", status: "pending", createdAt: at(200) },
        ],
      });

      const result = await new MaintenanceWorker(createRepositories(t.db), { now: () => now }).run();
      expect(result).toEqual({ sessions: 1, deliveredWebhooks: 1, failedWebhooks: 1 });
      expect((await t.db.session.findMany()).map((s) => s.tokenHash)).toEqual(["live"]);
      expect((await t.db.webhookDelivery.findMany({ orderBy: { eventId: "asc" } })).map((d) => d.eventId)).toEqual(["b", "d", "f"]);
    } finally {
      await t.close();
    }
  });
});

describe("SQLite backup", () => {
  it("writes a consistent copy and keeps the newest 14", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { readdirSync } = await import("node:fs");
    const { backupSqlite } = await import("../src/scripts/backupSqlite.js");
    const dir = mkdtempSync(path.join(os.tmpdir(), "mlc-backup-"));
    try {
      const src = path.join(dir, "app.db");
      const db = new Database(src);
      db.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('kept')");
      db.close();
      const out = path.join(dir, "backups");
      let last = "";
      for (let i = 0; i < 16; i++) last = await backupSqlite(src, out, new Date(Date.UTC(2026, 9, 1 + i)));
      expect(readdirSync(out)).toHaveLength(14);
      expect(readdirSync(out).sort()[0]).toBe("app-2026-10-03T00-00-00.db");
      const copy = new Database(last, { readonly: true });
      expect(copy.prepare("SELECT x FROM t").get()).toEqual({ x: "kept" });
      copy.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
