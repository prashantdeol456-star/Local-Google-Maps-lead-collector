import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDbProvider, splitPostgresUrl } from "../src/database/client.js";
import { toPostgresSchema } from "../src/scripts/syncPostgresSchema.js";
import { ON_POSTGRES } from "./helpers.js";

const prisma = path.resolve(import.meta.dirname, "../prisma");
const read = (p: string) => readFileSync(path.join(prisma, p), "utf8");

describe("PostgreSQL support", () => {
  it("prisma/postgres/schema.prisma is in sync with prisma/schema.prisma (run npm run db:pg:schema)", () => {
    expect(read("postgres/schema.prisma")).toBe(toPostgresSchema(read("schema.prisma")));
  });

  it("the PostgreSQL migrations create every model and enum of the schema", () => {
    const schema = read("schema.prisma");
    const dir = path.join(prisma, "postgres/migrations");
    const sql = readdirSync(dir)
      .filter((n) => !n.endsWith(".toml"))
      .map((n) => read(`postgres/migrations/${n}/migration.sql`))
      .join("\n");
    const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!);
    const enums = [...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]!);
    for (const m of models) expect(sql, `table ${m}`).toContain(`CREATE TABLE "${m}"`);
    for (const e of enums) expect(sql, `enum ${e}`).toContain(`CREATE TYPE "${e}"`);
    // A column added to the schema must also have a PostgreSQL migration.
    for (const block of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      const fields = [...block[2]!.matchAll(/^\s{2}(\w+)\s+(String|Int|Float|Boolean|DateTime|\w+)(\?|\[\])?/gm)]
        .filter((f) => !f[3]?.includes("[") && /^(String|Int|Float|Boolean|DateTime)$|^[A-Z]/.test(f[2]!))
        .filter((f) => !models.includes(f[2]!)) // relation fields are not columns
        .map((f) => f[1]!);
      for (const field of fields) expect(sql, `${block[1]}.${field}`).toContain(`"${field}"`);
    }
    expect(read("postgres/migrations/migration_lock.toml")).toContain('provider = "postgresql"');
  });

  it("parses the provider and the Prisma-style ?schema= parameter", () => {
    expect(parseDbProvider(undefined)).toBe("sqlite");
    expect(parseDbProvider("postgres")).toBe("postgresql");
    expect(() => parseDbProvider("mysql")).toThrow("DATABASE_PROVIDER");
    expect(splitPostgresUrl("postgresql://u:p@db:5432/leads?schema=app&sslmode=require&connection_limit=4")).toEqual({
      connectionString: "postgresql://u:p@db:5432/leads?sslmode=require",
      schema: "app",
      poolSize: 4,
    });
    expect(splitPostgresUrl("postgresql://u:p@db:5432/leads").poolSize).toBe(10);
    expect(splitPostgresUrl("postgresql://u:p@db:5432/leads").schema).toBeUndefined();
  });
});

describe("SQLite → PostgreSQL copy", () => {
  it("copies every table of the schema, parents first", async () => {
    const { TABLES } = await import("../src/scripts/copySqliteToPostgres.js");
    const models = [...read("schema.prisma").matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!);
    expect([...TABLES].sort()).toEqual([...models].sort());
    expect(TABLES.indexOf("Lead")).toBeLessThan(TABLES.indexOf("ContactAttempt"));
    expect(TABLES.indexOf("WebhookEndpoint")).toBeLessThan(TABLES.indexOf("WebhookDelivery"));
  });

  it("reads both SQLite date formats", async () => {
    const { sqliteDate } = await import("../src/scripts/copySqliteToPostgres.js");
    expect(sqliteDate("2026-10-06T13:37:20.794+00:00")?.toISOString()).toBe("2026-10-06T13:37:20.794Z");
    expect(sqliteDate("2026-10-01 10:00:00")?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(sqliteDate(null)).toBeNull();
    expect(() => sqliteDate("yesterday")).toThrow("Unreadable date");
  });

  it.skipIf(!ON_POSTGRES)("copies a SQLite database into an empty PostgreSQL schema, converting types, all or nothing", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const os = await import("node:os");
    const pg = (await import("pg")).default;
    const { copySqliteToPostgres } = await import("../src/scripts/copySqliteToPostgres.js");
    const { postgresTestDb } = await import("./helpers.js");

    const dir = mkdtempSync(path.join(os.tmpdir(), "copy-test-"));
    const file = path.join(dir, "src.db");
    const src = new Database(file);
    for (const n of readdirSync(path.join(prisma, "migrations")).filter((x) => !x.endsWith(".toml")).sort()) src.exec(read(`migrations/${n}/migration.sql`));
    src.prepare(`INSERT INTO "Lead" (id, name, normalizedName, dedupeKey, rating, createdAt, updatedAt, firstSeenAt, lastSeenAt) VALUES ('l1', 'ERA University', 'era university', 'k1', 4.5, '2026-10-06T13:37:20.794+00:00', '2026-10-06T13:37:20.794+00:00', '2026-10-01 10:00:00', '2026-10-01 10:00:00')`).run();
    src.prepare(`INSERT INTO "LeadCommunicationPreference" (leadId, emailAllowed, whatsappAllowed, optedOut, updatedAt) VALUES ('l1', 0, 1, 0, '2026-10-02 09:00:00')`).run();
    src.prepare(`INSERT INTO "MessageTemplate" (id, channel, name, body, createdAt, updatedAt) VALUES ('t1', 'whatsapp', 'intro', 'Hi', '2026-10-02 09:00:00', '2026-10-02 09:00:00')`).run();
    src.close();

    const target = await postgresTestDb();
    try {
      const result = await copySqliteToPostgres({ sqlitePath: file, postgresUrl: target.url });
      expect(result.find((r) => r.table === "Lead")?.rows).toBe(1);
      const { connectionString, schema } = splitPostgresUrl(target.url);
      const c = new pg.Client({ connectionString });
      await c.connect();
      const lead = (await c.query(`SELECT name, rating, "firstSeenAt" FROM "${schema}"."Lead"`)).rows[0];
      const pref = (await c.query(`SELECT "emailAllowed", "whatsappAllowed" FROM "${schema}"."LeadCommunicationPreference"`)).rows[0];
      const tpl = (await c.query(`SELECT channel::text AS channel FROM "${schema}"."MessageTemplate"`)).rows[0];
      await c.end();
      expect(lead).toEqual({ name: "ERA University", rating: 4.5, firstSeenAt: new Date("2026-10-01T10:00:00Z") });
      expect(pref).toEqual({ emailAllowed: false, whatsappAllowed: true });
      expect(tpl.channel).toBe("whatsapp");

      // A second copy into the now non-empty database is refused.
      await expect(copySqliteToPostgres({ sqlitePath: file, postgresUrl: target.url })).rejects.toThrow("not empty");
    } finally {
      await target.drop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
