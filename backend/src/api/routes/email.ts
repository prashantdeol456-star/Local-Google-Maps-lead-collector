import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EmailService } from "../../services/email/emailService.js";
import { parse } from "../validation.js";

const SendTestBody = z.object({ to: z.email().max(254) });

export async function emailRoutes(app: FastifyInstance, opts: { email: EmailService }) {
  const { email } = opts;

  app.get("/api/email/provider", async () => email.info());

  // Fixed test message to one address; rate-limited.
  app.post("/api/email/send-test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const { to } = parse(SendTestBody, request.body);
    return email.sendTest(to.toLowerCase(), request.admin!.email);
  });
}
