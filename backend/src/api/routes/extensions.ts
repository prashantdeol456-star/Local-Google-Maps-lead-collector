import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ExtensionDownload } from "../../scripts/packExtensions.js";
import { EXTENSION_SERVICES } from "../../services/auth/serviceAccess.js";
import { Errors } from "../../utils/errors.js";
import { IdParams, parse } from "../validation.js";

// Zips of the Chrome extensions (built by `npm run build:extensions`), offered on the admin
// panel's Extensions page. Login required like every /api route. No secrets are inside: the
// extensions log in with the admin's email and password.

function readIndex(dir: string): ExtensionDownload[] {
  try {
    return JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as ExtensionDownload[];
  } catch {
    return [];
  }
}

export async function extensionRoutes(app: FastifyInstance, opts: { extensionsDir: string }) {
  // Only the extensions of services the user has (super admins: all).
  const allowed = (request: { admin: { services: string[] } | null }, id: string) => {
    const service = EXTENSION_SERVICES[id];
    return !service || !!request.admin?.services.includes(service);
  };

  app.get("/api/extensions", async (request) => ({ items: readIndex(opts.extensionsDir).filter((e) => allowed(request, e.id)) }));

  app.get("/api/extensions/:id/download", async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    const ext = readIndex(opts.extensionsDir).find((e) => e.id === id && allowed(request, e.id));
    const file = ext && path.join(opts.extensionsDir, path.basename(ext.file));
    if (!ext || !file || !existsSync(file)) throw Errors.notFound("Extension not built. Run: npm run build:extensions");
    return reply
      .type("application/zip")
      .header("Content-Disposition", `attachment; filename="${ext.id}-${ext.version}.zip"`)
      .header("Cache-Control", "no-store")
      .send(createReadStream(file));
  });
}
