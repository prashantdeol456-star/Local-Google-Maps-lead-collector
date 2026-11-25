import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { UNIFIED_PLATFORMS, type UnifiedInboxService } from "../../services/inbox/unifiedInbox.js";
import type { ChatContactsService } from "../../services/inbox/chatContacts.js";
import { Errors } from "../../utils/errors.js";
import { optionalText, parse } from "../validation.js";

const ListQuery = z.object({
  platform: z.enum(UNIFIED_PLATFORMS).optional(),
  filter: z.enum(["all", "unread", "needs_reply"]).optional(),
  q: optionalText(200),
  label: optionalText(60),
  contactId: z.string().max(64).optional(),
});

const ChatParams = z.object({ source: z.enum(["whatsapp", "inbox"]), id: z.string().min(1).max(64) });
const LinkBody = z.union([
  z.object({ contactId: z.string().min(1).max(64) }),
  z.object({ create: z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().max(40).nullish(), email: z.string().trim().max(254).nullish(), company: z.string().trim().max(200).nullish() }) }),
]);

/** The apps this user may use: WhatsApp Chat (whatsapp service) and the AI Inbox (ai_inbox service). */
function sources(request: FastifyRequest) {
  const admin = request.admin!;
  const all = admin.role === "super_admin";
  return { whatsapp: all || admin.services.includes("whatsapp"), inbox: all || admin.services.includes("ai_inbox") };
}

export async function messageRoutes(app: FastifyInstance, opts: { unified: UnifiedInboxService; contacts: ChatContactsService }) {
  const { contacts } = opts;
  app.get("/api/messages/chats", async (request) => opts.unified.list({ ...parse(ListQuery, request.query), sources: sources(request) }));
  app.get("/api/messages/summary", async (request) => opts.unified.summary(sources(request)));
  app.get("/api/messages/labels", async () => ({ items: await contacts.labels() }));

  // One person across apps: the chat's contact in Contacts.
  const allowed = (request: Parameters<typeof sources>[0], source: "whatsapp" | "inbox") => {
    if (!sources(request)[source]) throw Errors.forbidden("This service is not enabled for your account", "SERVICE_DISABLED");
  };
  app.get("/api/messages/contacts", async (request) => ({ items: await contacts.search(parse(z.object({ q: optionalText(200) }), request.query).q ?? "") }));
  app.get("/api/messages/chats/:source/:id/contact", async (request) => {
    const { source, id } = parse(ChatParams, request.params);
    allowed(request, source);
    return contacts.contactFor(source, id);
  });
  app.post("/api/messages/chats/:source/:id/contact", async (request) => {
    const { source, id } = parse(ChatParams, request.params);
    allowed(request, source);
    const body = parse(LinkBody, request.body);
    return "contactId" in body ? contacts.link(source, id, body.contactId) : contacts.createAndLink(source, id, body.create);
  });
  app.delete("/api/messages/chats/:source/:id/contact", async (request) => {
    const { source, id } = parse(ChatParams, request.params);
    allowed(request, source);
    return contacts.unlink(source, id);
  });
  // Labels and notes of AI Inbox chats (WhatsApp chats: WhatsApp Chat's own contact info).
  app.patch("/api/messages/chats/inbox/:id", async (request) => {
    allowed(request, "inbox");
    const { id } = parse(z.object({ id: z.string().min(1).max(64) }), request.params);
    const body = parse(z.object({ labels: z.array(z.string().trim().min(1).max(30)).max(10).optional(), notes: z.string().max(2000).nullable().optional() }).strict(), request.body);
    return contacts.updateInboxChat(id, body);
  });
}
