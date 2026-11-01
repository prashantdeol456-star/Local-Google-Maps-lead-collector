import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// Serves the built admin panel (admin/ → backend/public/admin) at /admin.
// Files are looked up per request, so rebuilding the panel needs no restart. The panel is a
// single-page app: other /admin/* paths without a file extension get index.html (see
// isAdminPageRequest, used by the app's not-found handler).

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    // Profile pictures of connected social accounts come from the platforms' image servers.
    "default-src 'self'; connect-src 'self'; img-src 'self' data: https://*.fbcdn.net https://platform-lookaside.fbsbx.com https://*.cdninstagram.com https://media.licdn.com; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

function withSecurityHeaders(reply: FastifyReply) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  return reply;
}

/** A client-side route of the panel (e.g. /admin/leads/abc), not a missing asset. */
export function isAdminPageRequest(request: Pick<FastifyRequest, "method" | "url">, adminDir: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = request.url.split("?")[0]!;
  if (!pathname.startsWith("/admin/")) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !last.includes(".") && existsSync(path.join(adminDir, "index.html"));
}

export function sendAdminIndex(reply: FastifyReply, adminDir: string) {
  return withSecurityHeaders(reply)
    .code(200)
    .header("Cache-Control", "no-cache")
    .type("text/html; charset=utf-8")
    .send(createReadStream(path.join(adminDir, "index.html")));
}

export async function adminRoutes(app: FastifyInstance, opts: { adminDir: string }) {
  const indexFile = path.join(opts.adminDir, "index.html");
  if (!existsSync(indexFile)) {
    app.get("/admin", (_request, reply) =>
      reply.code(503).type("text/plain").send("Admin panel is not built yet. Run: npm run build:admin"),
    );
    return;
  }

  await app.register(fastifyStatic, {
    root: opts.adminDir,
    prefix: "/admin/",
    index: false,
    wildcard: true,
    setHeaders: (reply, filePath) => {
      withSecurityHeaders(reply);
      // Built assets have content hashes in their names: safe to cache for a long time.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) reply.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  });

  app.get("/admin", (_request, reply) => reply.redirect("/admin/"));
  app.get("/admin/", (_request, reply) => sendAdminIndex(reply, opts.adminDir));
}
