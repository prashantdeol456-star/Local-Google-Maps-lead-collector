import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// DATABASE_PROVIDER=postgresql uses prisma/postgres/ (schema generated from prisma/schema.prisma
// by `npm run db:pg:schema`, with its own migrations). Default: SQLite.
const postgres = ["postgresql", "postgres"].includes(process.env.DATABASE_PROVIDER ?? "");

export default defineConfig({
  schema: postgres ? "prisma/postgres/schema.prisma" : "prisma/schema.prisma",
  migrations: { path: postgres ? "prisma/postgres/migrations" : "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
