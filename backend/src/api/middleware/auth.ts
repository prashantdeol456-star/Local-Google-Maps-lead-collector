import type { FastifyInstance, FastifyRequest } from "fastify";
import { Errors } from "../../utils/errors.js";
import type { AuthenticatedAdmin, AuthService } from "../../services/auth/authService.js";
import { ownerScope, type OwnerScope } from "../../database/ownerScope.js";
import { serviceForRoute } from "../../services/auth/serviceAccess.js";

export const SESSION_COOKIE = "mlc_session";

// API routes reachable without logging in.
const PUBLIC_ROUTES = new Set(["GET /api/health", "POST /api/auth/login", "POST /api/auth/token", "POST /api/auth/register"]);

/**
 * What customers may use (route templates). Everything else is for super admins until it is
 * separated per user: inbox, social accounts, integrations, settings and campaign logs.
 */
const CUSTOMER_ROUTES = new RegExp(
  "^/api/(" +
    [
      "health",
      "stats",
      "events",
      "auth/(me|logout|tokens|tokens/:id)",
      "leads|leads/facets|leads/:id",
      "leads/:id/(preferences|communications|email-opt-out|email-opt-in|do-not-contact|whatsapp-opt-in)",
      "jobs(/.*)?",
      "export/(csv|xlsx)",
      "linkedin/(leads|leads/check|leads/:id|facets|import|export\\.csv)",
      "extensions(/.*)?",
      // Outreach (phase B): templates, opt-outs, contacts and campaigns, each user's own
      "templates|templates/:id|templates/preview",
      "channel-templates|channel-templates/:id|channel-templates/preview",
      "opt-outs|opt-outs/:id",
      "quick-send/contacts",
      // Their own lead credits and online recharge
      "billing/(me|me/entries|orders|verify)",
      "contacts|contacts/:id|contacts/facets|contacts/template\\.(csv|xlsx)|contacts/delete|contacts/import",
      "email/campaigns|email/campaigns/recipients|email/campaigns/:id|email/campaigns/:id/(attempts|start|pause|stop)|email/attempts/:id/reply",
      "whatsapp/templates|whatsapp/templates/:id|whatsapp/templates/preview",
      "whatsapp/campaigns|whatsapp/campaigns/recipients|whatsapp/campaigns/:id|whatsapp/campaigns/:id/(attempts|start|pause|stop)",
      // Their own sender (phase C)
      "senders|senders/email|senders/whatsapp|senders/:channel|senders/test",
      // AI Inbox and social accounts (phase C2); the LinkedIn inbox (extension) stays with super admins
      "inbox/(ai-config|secrets/:name|test/:what|settings|status|conversations|refresh)",
      "inbox/conversations/:id|inbox/conversations/:id/(ai-reply|send|handled|mode)|inbox/drafts/:id/(approve|dismiss)",
      "social/(providers|accounts|connect/:provider)|social/accounts/:id|social/accounts/:id/check",
    ].join("|") +
    ")$",
);

/**
 * Test sends through the platform's own accounts. Customers test their sender on the
 * My sender page (/api/senders/test); starting a campaign checks that their sender is set.
 */
const SENDING_ROUTES = /^\/api\/(email|whatsapp)\/send-test$/;

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

    if (request.admin.role !== "super_admin" && SENDING_ROUTES.test(request.routeOptions.url ?? "")) {
      throw Errors.forbidden("Test your own sender on the My sender page", "SENDER_REQUIRED");
    }
    if (request.admin.role !== "super_admin" && !CUSTOMER_ROUTES.test(request.routeOptions.url ?? "")) {
      throw Errors.forbidden("This part is not available for your account", "NOT_AVAILABLE_FOR_ACCOUNT");
    }
    // Services the super admin switched off for this customer
    const service = request.admin.role === "super_admin" ? null : serviceForRoute(request.routeOptions.url ?? "");
    if (service && !request.admin.services.includes(service)) {
      throw Errors.forbidden("This service is not enabled for your account. Contact the administrator.", "SERVICE_DISABLED");
    }
  });

  // Run the rest of the request (handler included) inside the user's data scope.
  app.addHook("preHandler", (request, _reply, done) => {
    const scope = scopeFor(request);
    if (!scope) return done();
    ownerScope.run(scope, done);
  });
}
