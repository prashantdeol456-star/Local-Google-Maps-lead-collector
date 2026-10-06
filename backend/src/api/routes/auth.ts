import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../../services/auth/authService.js";
import { readSessionToken, requireSession, SESSION_COOKIE } from "../middleware/auth.js";
import { Errors } from "../../utils/errors.js";

const Credentials = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

const TokenBody = Credentials.extend({
  name: z.string().trim().min(1).max(80).default("Chrome extension"),
});

const TokenParams = z.object({ id: z.string().min(1).max(64) });

const IntegrationTokenBody = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["read", "full"]).default("read"),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(365),
});

interface AuthRouteOptions {
  auth: AuthService;
  secureCookies: boolean;
  loginRateLimitPerMinute: number;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const { auth, secureCookies } = opts;
  const LOGIN_RATE_LIMIT = { rateLimit: { max: opts.loginRateLimitPerMinute, timeWindow: "1 minute" } };

  // Admin panel: session cookie
  app.post("/api/auth/login", { config: LOGIN_RATE_LIMIT }, async (request, reply) => {
    const parsed = Credentials.safeParse(request.body);
    if (!parsed.success) throw Errors.badRequest("Email and password are required");

    const { token, expiresAt, admin } = await auth.login(parsed.data.email, parsed.data.password);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookies,
      signed: true,
      expires: expiresAt,
    });
    return { admin, expiresAt };
  });

  // Chrome extension: bearer token (returned once, only its hash is stored)
  app.post("/api/auth/token", { config: LOGIN_RATE_LIMIT }, async (request) => {
    const parsed = TokenBody.safeParse(request.body);
    if (!parsed.success) throw Errors.badRequest("Email and password are required");
    const { email, password, name } = parsed.data;
    return auth.issueApiToken(email, password, name);
  });

  // Logs out whichever credential was used: revokes the bearer token or ends the cookie session.
  app.post("/api/auth/logout", async (request, reply) => {
    if (request.authMethod === "token" && request.apiTokenId) {
      await auth.revokeApiToken(request.apiTokenId, request.admin!.id);
    } else {
      await auth.logout(readSessionToken(request));
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
    }
    return { ok: true };
  });

  app.get("/api/auth/me", async (request) => ({ admin: request.admin, authMethod: request.authMethod }));

  app.get("/api/auth/tokens", async (request) => ({
    tokens: (await auth.listApiTokens(request.admin!.id)).map((t) => ({
      ...t,
      current: t.id === request.apiTokenId,
    })),
  }));

  /** API token for an integration (n8n…). Only from the admin panel, so a token cannot mint tokens. */
  app.post("/api/auth/tokens", async (request, reply) => {
    requireSession(request);
    const parsed = IntegrationTokenBody.safeParse(request.body);
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "Invalid request");
    const created = await auth.createIntegrationToken(request.admin!.id, parsed.data);
    return reply.code(201).send(created);
  });

  app.delete("/api/auth/tokens/:id", async (request) => {
    const parsed = TokenParams.safeParse(request.params);
    if (!parsed.success) throw Errors.badRequest("Invalid token id");
    await auth.revokeApiToken(parsed.data.id, request.admin!.id);
    return { ok: true };
  });
}
