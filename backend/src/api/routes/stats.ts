import type { FastifyInstance } from "fastify";
import type { StatsService } from "../../services/statsService.js";

export async function statsRoutes(app: FastifyInstance, opts: { stats: StatsService }) {
  app.get("/api/stats", async () => opts.stats.get());
}
