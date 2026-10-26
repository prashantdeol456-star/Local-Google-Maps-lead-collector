import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OAuthError, type SocialService } from "../../services/social/socialService.js";
import { requireSession } from "../middleware/auth.js";
import { IdParams, parse } from "../validation.js";

const Provider = z.object({ provider: z.enum(["meta", "linkedin"]) });

const CallbackQuery = z
  .object({
    code: z.string().max(2000).optional(),
    state: z.string().max(200).optional(),
    error: z.string().max(200).optional(),
    error_reason: z.string().max(200).optional(),
    error_description: z.string().max(1000).optional(),
  })
  .passthrough();

export async function socialRoutes(app: FastifyInstance, opts: { social: SocialService }) {
  const { social } = opts;

  app.get("/api/social/providers", async () => social.providers());
  app.get("/api/social/accounts", async () => ({ items: await social.list() }));

  // Only from the admin panel (a person clicking Connect), never with an API token.
  app.post("/api/social/connect/:provider", async (request) => {
    requireSession(request);
    const { provider } = parse(Provider, request.params);
    return { url: social.start(provider, request.admin!.id) };
  });

  // The platform sends the browser back here. Public route: the single-use state proves who started it.
  app.get("/api/oauth/callback/:provider", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const back = (params: Record<string, string>) => reply.redirect(`/admin/social?${new URLSearchParams(params).toString()}`, 303);
    const parsedProvider = Provider.safeParse(request.params);
    const parsedQuery = CallbackQuery.safeParse(request.query);
    if (!parsedProvider.success || !parsedQuery.success) return back({ error: "Invalid login response" });
    try {
      const accounts = await social.callback(parsedProvider.data.provider, parsedQuery.data);
      return back({ connected: String(accounts.length), provider: parsedProvider.data.provider });
    } catch (err) {
      if (!(err instanceof OAuthError)) request.log.error(err, "social login failed");
      return back({ error: err instanceof OAuthError ? err.message : "Connecting failed. See the backend log." });
    }
  });

  app.post("/api/social/accounts/:id/check", async (request) => ({ account: await social.check(parse(IdParams, request.params).id) }));

  app.delete("/api/social/accounts/:id", async (request) => {
    requireSession(request);
    await social.disconnect(parse(IdParams, request.params).id);
    return { ok: true };
  });
}
