import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";

/** A Prisma client or the client inside a transaction; repositories accept either. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/** True for a unique-constraint violation (e.g. two requests inserting the same lead at once). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// The only file that knows which database driver is used. DATABASE_PROVIDER selects it; the
// Prisma client must be generated for the same provider (npm run db:generate does that).
export type DbProvider = "sqlite" | "postgresql";

export function parseDbProvider(value: string | undefined): DbProvider {
  if (!value || value === "sqlite") return "sqlite";
  if (value === "postgresql" || value === "postgres") return "postgresql";
  throw new Error(`DATABASE_PROVIDER must be "sqlite" or "postgresql" (got "${value}")`);
}

export const DB_PROVIDER: DbProvider = parseDbProvider(process.env.DATABASE_PROVIDER);

/**
 * Prisma-style URL parameters that pg itself does not understand:
 * "?schema=name" and "?connection_limit=N" (pool size, default 10).
 */
export function splitPostgresUrl(url: string): { connectionString: string; schema: string | undefined; poolSize: number } {
  const parsed = new URL(url);
  const schema = parsed.searchParams.get("schema") ?? undefined;
  const limit = Number(parsed.searchParams.get("connection_limit"));
  parsed.searchParams.delete("schema");
  parsed.searchParams.delete("connection_limit");
  return { connectionString: parsed.toString(), schema, poolSize: Number.isInteger(limit) && limit > 0 ? limit : 10 };
}

export function createPrismaClient(databaseUrl: string, provider: DbProvider = DB_PROVIDER): PrismaClient {
  if (provider === "postgresql") {
    const { connectionString, schema, poolSize } = splitPostgresUrl(databaseUrl);
    return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: poolSize }, schema ? { schema } : undefined) });
  }
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
}

/**
 * Case-insensitive `contains` filter. SQLite's LIKE is already case-insensitive (ASCII)
 * and rejects `mode`; PostgreSQL needs `mode: "insensitive"`.
 */
export function containsInsensitive(value: string) {
  return (DB_PROVIDER === "postgresql" ? { contains: value, mode: "insensitive" } : { contains: value }) as { contains: string };
}

export type { PrismaClient };
