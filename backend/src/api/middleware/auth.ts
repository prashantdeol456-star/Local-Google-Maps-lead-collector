import type { FastifyInstance, FastifyRequest } from "fastify";
import { Errors } from "../../utils/errors.js";
import type { AuthenticatedAdmin, AuthService } from "../../services/auth/authService.js";
import { ownerScope, type OwnerScope } from "../../database/ownerScope.js";

export const SESSION_COOKIE = "mlc_session";

// API routes reachable without logging in.
const PUBLIC_ROUTES = new Set(["GET /api/health", "POST /api/auth/login", "POST /api/auth/token", "POST /api/auth/register"]);

/**
 * What customers may use (route templates). Everything else is for super admins until it is
 * separated per user: campaigns, templates, contacts, inbox, integrations and settings.
 */
const CUSTOMER_ROUTES =
  /^\/api\/(health|stats|events|auth\/(me|logout|tokens|tokens\/:id)|leads|leads\/facets|leads\/:id|jobs(\/.*)?|export\/(csv|xlsx)|linkedin\/(leads|leads\/check|leads\/:id|facets|import|export\.csv)|extensions(\/.*)?)$/;

/** Super admins can look at one user's data: header with that user's id. */
export const VIEW_OWNER_HEADER = "x-view-owner";

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

export function requireSuperAdmin(request: FastifyRequest) {
  if (request.admin?.role !== "super_admin") throw Errors.forbidden("Only a super admin can do this");
}

/** The data a request may see and the owner of what it creates (see database/ownerScope.ts). */
export function scopeFor(request: FastifyRequest): OwnerScope | null {
  const admin = request.admin;
  if (!admin) return null;
  if (admin.role !== "super_admin") return { userId: admin.id, ownerId: admin.id, customer: true };
  // Header from the admin panel's API client; ?viewOwner= for plain download links.
  const view = request.headers[VIEW_OWNER_HEADER] ?? (request.query as { viewOwner?: unknown } | undefined)?.viewOwner;
  const ownerId = typeof view === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(view) ? view : null;
  return { userId: admin.id, ownerId, customer: false };
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
    } else {
      request.admin = await auth.authenticate(readSessionToken(request));
      if (!request.admin) throw Errors.unauthorized();
      request.authMethod = "session";
    }

    if (request.admin.role !== "super_admin" && !CUSTOMER_ROUTES.test(request.routeOptions.url ?? "")) {
      throw Errors.forbidden("This part is not available for your account", "NOT_AVAILABLE_FOR_ACCOUNT");
    }
  });

  // Run the rest of the request (handler included) inside the user's data scope.
  app.addHook("preHandler", (request, _reply, done) => {
    const scope = scopeFor(request);
    if (!scope) return done();
    ownerScope.run(scope, done);
  });
}
