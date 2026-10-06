// Writes prisma/postgres/schema.prisma from prisma/schema.prisma (the one source of truth):
// only the datasource provider differs. Run after every schema change:
//   npm run db:pg:schema -w backend
// then create the PostgreSQL migration (see docs/DEPLOYMENT.md).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function toPostgresSchema(sqliteSchema: string): string {
  const header = "// GENERATED from prisma/schema.prisma by `npm run db:pg:schema`. Do not edit by hand.\n\n";
  const out = sqliteSchema
    .replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
    .replace(/output\s*=\s*"\.\.\/src\/generated\/prisma"/, 'output   = "../../src/generated/prisma"');
  if (out === sqliteSchema) throw new Error("schema.prisma does not look like the SQLite schema");
  return header + out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const source = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  writeFileSync(path.join(root, "prisma/postgres/schema.prisma"), toPostgresSchema(source));
  console.log("Wrote prisma/postgres/schema.prisma");
}
