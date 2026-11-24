import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { UNIFIED_PLATFORMS, type UnifiedInboxService } from "../../services/inbox/unifiedInbox.js";
import { optionalText, parse } from "../validation.js";

const ListQuery = z.object({
  platform: z.enum(UNIFIED_PLATFORMS).optional(),
  filter: z.enum(["all", "unread", "needs_reply"]).optional(),
  q: optionalText(200),
});

/** The apps this user may use: WhatsApp Chat (whatsapp service) and the AI Inbox (ai_inbox service). */
function sources(request: FastifyRequest) {
  const admin = request.admin!;
  const all = admin.role === "super_admin";
  return { whatsapp: all || admin.services.includes("whatsapp"), inbox: all || admin.services.includes("ai_inbox") };
}

export async function messageRoutes(app: FastifyInstance, opts: { unified: UnifiedInboxService }) {
  app.get("/api/messages/chats", async (request) => opts.unified.list({ ...parse(ListQuery, request.query), sources: sources(request) }));
  app.get("/api/messages/summary", async (request) => opts.unified.summary(sources(request)));
}
