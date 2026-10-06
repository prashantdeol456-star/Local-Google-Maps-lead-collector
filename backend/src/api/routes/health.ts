import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../database/client.js";

export async function healthRoutes(app: FastifyInstance, opts: { db: PrismaClient }) {
  app.get("/api/health", async (_request, reply) => {
    try {
      await opts.db.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok", time: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: "degraded", database: "unreachable", time: new Date().toISOString() });
    }
  });
}
