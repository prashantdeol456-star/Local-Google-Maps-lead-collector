// Copies all data from the local SQLite database into an EMPTY PostgreSQL database that already
// has the PostgreSQL migrations applied. One transaction: all or nothing. Row counts are
// compared at the end.
//
//   DATABASE_PROVIDER=postgresql DATABASE_URL=postgresql://… npm run db:migrate -w backend
//   npm run db:copy-to-postgres -w backend -- --from ../data/app.db --to postgresql://…
//
// Keep the same SESSION_SECRET on the server: webhook signing secrets are encrypted with it.

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitPostgresUrl } from "../database/client.js";

/** Parents before children (foreign keys). */
export const TABLES = [
  "AdminUser",
  "Session",
  "ApiToken",
  "Lead",
  "CollectionJob",
  "JobItem",
  "AgentLog",
  "LeadCommunicationPreference",
  "MessageTemplate",
  "Campaign",
  "ContactAttempt",
  "EmailEvent",
  "TrackedLink",
  "WhatsAppEvent",
  "Suppression",
  "WebhookEndpoint",
  "WebhookDelivery",
  "LinkedInLead",
  "OutreachContact",
  "LinkedInCampaign",
  "LinkedInMessage",
] as const;

const BATCH = 500;

/** SQLite text dates are ISO with an offset, or "YYYY-MM-DD HH:MM:SS" (UTC) from SQL defaults. */
export function sqliteDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return new Date(value);
  const s = String(value);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Unreadable date "${s}"`);
  return d;
}

function convert(value: unknown, pgType: string): unknown {
  if (value === null || value === undefined) return null;
  if (pgType === "boolean") return value === 1 || value === true || value === "1";
  if (pgType.startsWith("timestamp")) return sqliteDate(value);
  return value;
}

export interface CopyResult {
  table: string;
  rows: number;
}

export async function copySqliteToPostgres(opts: { sqlitePath: string; postgresUrl: string; log?: (msg: string) => void }): Promise<CopyResult[]> {
  const log = opts.log ?? (() => {});
  const { connectionString, schema } = splitPostgresUrl(opts.postgresUrl);
  const source = new Database(opts.sqlitePath, { readonly: true, fileMustExist: true });
  const target = new pg.Client({ connectionString });
  await target.connect();
  const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const table = (name: string) => (schema ? `${q(schema)}.${q(name)}` : q(name));
  try {
    const schemaName = schema ?? "public";
    for (const t of TABLES) {
      const { rows } = await target.query(`SELECT COUNT(*)::int AS n FROM ${table(t)}`);
      if (rows[0].n > 0) throw new Error(`Target table ${t} is not empty; copy only into a fresh database`);
    }

    const results: CopyResult[] = [];
    await target.query("BEGIN");
    for (const t of TABLES) {
      const cols = await target.query<{ column_name: string; data_type: string }>(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [schemaName, t],
      );
      const types = new Map(cols.rows.map((c) => [c.column_name, c.data_type]));
      const sourceCols = (source.prepare(`PRAGMA table_info(${q(t)})`).all() as { name: string }[]).map((c) => c.name).filter((c) => types.has(c));
      const missing = [...types.keys()].filter((c) => !sourceCols.includes(c));
      if (missing.length) log(`  ${t}: not in SQLite, left to their defaults: ${missing.join(", ")}`);

      const total = (source.prepare(`SELECT COUNT(*) AS n FROM ${q(t)}`).get() as { n: number }).n;
      const select = source.prepare(`SELECT ${sourceCols.map(q).join(", ")} FROM ${q(t)} ORDER BY rowid LIMIT ? OFFSET ?`);
      for (let offset = 0; offset < total; offset += BATCH) {
        const batch = select.all(BATCH, offset) as Record<string, unknown>[];
        const values: unknown[] = [];
        const tuples = batch.map((row) => {
          const params = sourceCols.map((c) => {
            values.push(convert(row[c], types.get(c)!));
            return `$${values.length}`;
          });
          return `(${params.join(", ")})`;
        });
        await target.query(`INSERT INTO ${table(t)} (${sourceCols.map(q).join(", ")}) VALUES ${tuples.join(", ")}`, values);
      }
      const copied = (await target.query(`SELECT COUNT(*)::int AS n FROM ${table(t)}`)).rows[0].n as number;
      if (copied !== total) throw new Error(`${t}: copied ${copied} of ${total} rows`);
      log(`  ${t}: ${total}`);
      results.push({ table: t, rows: total });
    }
    await target.query("COMMIT");
    return results;
  } catch (err) {
    await target.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await target.end();
    source.close();
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const from = arg("from") ?? "../data/app.db";
  const to = arg("to") ?? process.env.TARGET_DATABASE_URL;
  if (!to) {
    console.error("Usage: npm run db:copy-to-postgres -w backend -- --from ../data/app.db --to postgresql://user:pass@host:5432/db");
    process.exit(1);
  }
  console.log(`Copying ${path.resolve(from)} → PostgreSQL`);
  copySqliteToPostgres({ sqlitePath: path.resolve(from), postgresUrl: to, log: console.log })
    .then((r) => console.log(`Done: ${r.reduce((n, x) => n + x.rows, 0)} rows in ${r.length} tables`))
    .catch((err: unknown) => {
      console.error(`Copy failed, nothing was written: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
