import type { FastifyInstance, FastifyRequest } from "fastify";
import { Errors } from "../../utils/errors.js";
import type { AuthenticatedAdmin, AuthService } from "../../services/auth/authService.js";

export const SESSION_COOKIE = "mlc_session";

// API routes reachable without logging in.
const PUBLIC_ROUTES = new Set(["GET /api/health", "POST /api/auth/login", "POST /api/auth/token"]);

export type AuthMethod = "session" | "token";

declare module "fastify" {
  interface FastifyRequest {
    admin: AuthenticatedAdmin | null;
    authMethod: AuthMethod | null;
    /** Set when authenticated with a bearer token. */
    apiTokenId: string | null;
    apiTokenScope: string | null;
  }
}

export function readSessionToken(request: FastifyRequest): string | undefined {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return undefined;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : undefined;
}

export function readBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value.trim() : undefined;
}

/** For settings that only a person in the admin panel may change (not a bearer token). */
export function requireSession(request: FastifyRequest) {
  if (request.authMethod !== "session") throw Errors.forbidden("Only available when logged in to the admin panel");
}

/**
 * Every /api route requires a valid login unless listed in PUBLIC_ROUTES.
 * Accepts either a bearer token (extension) or a session cookie (admin panel).
 */
export function registerAuthGuard(app: FastifyInstance, auth: AuthService) {
  app.decorateRequest("admin", null);
  app.decorateRequest("authMethod", null);
  app.decorateRequest("apiTokenId", null);
  app.decorateRequest("apiTokenScope", null);

  app.addHook("onRequest", async (request) => {
    const routeKey = `${request.method} ${request.routeOptions.url ?? ""}`;
    if (!request.url.startsWith("/api/") || PUBLIC_ROUTES.has(routeKey)) return;
    // Provider webhooks authenticate with signatures instead of a login.
    if (request.routeOptions.url?.startsWith("/api/webhooks/")) return;
    // OAuth redirects from Facebook/LinkedIn: checked with a single-use state instead.
    if (request.method === "GET" && request.routeOptions.url === "/api/oauth/callback/:provider") return;

    const bearer = readBearerToken(request);
    if (bearer) {
      // A bearer header that fails is rejected outright, without falling back to the cookie.
      const result = await auth.authenticateApiToken(bearer);
      if (!result) throw Errors.unauthorized("Invalid or expired token");
      request.admin = result.admin;
      request.authMethod = "token";
      request.apiTokenId = result.tokenId;
      request.apiTokenScope = result.scope;
      if (result.scope === "read") {
        // Read-only integration tokens: GET only, and never the token or integration settings.
        const url = request.routeOptions.url ?? "";
        if ((request.method !== "GET" && request.method !== "HEAD") || url.startsWith("/api/auth/tokens") || url.startsWith("/api/integrations")) {
          throw Errors.forbidden("This token is read-only");
        }
      }
      return;
    }

    request.admin = await auth.authenticate(readSessionToken(request));
    if (!request.admin) throw Errors.unauthorized();
    request.authMethod = "session";
  });
}
