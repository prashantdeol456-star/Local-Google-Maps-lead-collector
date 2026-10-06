// Consistent copy of the SQLite database while the backend keeps running (SQLite online
// backup API). Keeps the newest 14 copies.
//   npm run db:backup -w backend            → data/backups/app-<date>.db
// For PostgreSQL use deploy/backup-postgres.sh (pg_dump) instead.

import "dotenv/config";
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KEEP = 14;
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function backupSqlite(source: string, dir: string, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = path.join(dir, `app-${stamp}.db`);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
  const old = readdirSync(dir).filter((f) => /^app-.*\.db$/.test(f)).sort().slice(0, -KEEP);
  for (const f of old) rmSync(path.join(dir, f));
  return target;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL ?? "file:../data/app.db";
  if (!url.startsWith("file:")) {
    console.error("DATABASE_URL is not a SQLite file. For PostgreSQL use deploy/backup-postgres.sh");
    process.exit(1);
  }
  const file = path.resolve(backendRoot, url.slice("file:".length));
  backupSqlite(file, path.join(path.dirname(file), "backups"))
    .then((t) => console.log(`Backup written: ${t}`))
    .catch((err: unknown) => {
      console.error(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
