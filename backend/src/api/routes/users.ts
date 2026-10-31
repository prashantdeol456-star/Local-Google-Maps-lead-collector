import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { UserService } from "../../services/auth/userService.js";
import { MIN_PASSWORD_LENGTH } from "../../services/auth/userService.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import { IdParams, optionalText, parse } from "../validation.js";

const RegisterBody = z.object({
  email: z.email().max(254),
  phone: z
    .string()
    .trim()
    .min(7)
    .max(20)
    .regex(/^\+?[\d\s()-]+$/, "Phone: digits only (with an optional +)"),
  username: z.string().trim().min(3).max(32),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  name: z.string().trim().max(100).nullish(),
});

const ListQuery = z.object({ status: z.enum(["pending", "active", "disabled"]).optional(), q: optionalText(200) });
const PasswordBody = z.object({ password: z.string().min(MIN_PASSWORD_LENGTH).max(200) });

export async function userRoutes(app: FastifyInstance, opts: { users: UserService; registerRateLimitPerMinute: number }) {
  const { users } = opts;

  // Public: anyone can ask for an account; it stays "pending" until a super admin approves it.
  app.post("/api/auth/register", { config: { rateLimit: { max: opts.registerRateLimitPerMinute, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await users.register(parse(RegisterBody, request.body));
    return reply.code(201).send({ user: { email: user.email, username: user.username, status: user.status } });
  });

  // ---- Super admin: user management ----
  app.get("/api/users", async (request) => {
    requireSuperAdmin(request);
    return users.list(parse(ListQuery, request.query));
  });

  app.post("/api/users/:id/approve", async (request) => {
    requireSuperAdmin(request);
    return { user: await users.approve(parse(IdParams, request.params).id) };
  });

  app.post("/api/users/:id/disable", async (request) => {
    requireSuperAdmin(request);
    return { user: await users.disable(parse(IdParams, request.params).id, request.admin!.id) };
  });

  app.post("/api/users/:id/enable", async (request) => {
    requireSuperAdmin(request);
    return { user: await users.enable(parse(IdParams, request.params).id) };
  });

  app.post("/api/users/:id/password", async (request) => {
    requireSuperAdmin(request);
    return { user: await users.resetPassword(parse(IdParams, request.params).id, parse(PasswordBody, request.body).password) };
  });
}
