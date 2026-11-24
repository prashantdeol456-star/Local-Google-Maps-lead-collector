import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_MEDIA_BYTES, type WhatsAppChatService } from "../../services/whatsapp/chatService.js";
import { Errors } from "../../utils/errors.js";
import { IdParams, parse } from "../validation.js";

// WhatsApp Chat page: chats through the user's own WhatsApp number (Meta Cloud API).

const ListQuery = z.object({ q: z.string().trim().max(100).optional(), unread: z.enum(["1", "0"]).optional() });
const MessagesQuery = z.object({ before: z.coerce.date().optional() });
const TextBody = z.object({ text: z.string().trim().min(1).max(4096) });
const FileBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(3).max(100).regex(/^[\w.+-]+\/[\w.+-]+$/),
  /** base64 */
  data: z.string().min(1).max(Math.ceil((MAX_MEDIA_BYTES * 4) / 3) + 8),
  caption: z.string().trim().max(1024).nullish(),
});
const TemplateBody = z.object({ templateId: z.string().min(1).max(64) });
const StartBody = z.object({ phone: z.string().trim().min(6).max(30), templateId: z.string().min(1).max(64), name: z.string().trim().max(100).nullish() });
const RenameBody = z.object({ name: z.string().trim().max(100).nullable() });

export async function whatsappChatRoutes(app: FastifyInstance, opts: { chats: WhatsAppChatService }) {
  const { chats } = opts;
  const id = (request: { params: unknown }) => parse(IdParams, request.params).id;

  app.get("/api/whatsapp/chats", async (request) => {
    const q = parse(ListQuery, request.query);
    return { items: await chats.list({ q: q.q || undefined, unread: q.unread === "1" }) };
  });
  app.post("/api/whatsapp/chats", async (request) => chats.start(parse(StartBody, request.body)));
  app.get("/api/whatsapp/chats/:id", async (request) => ({ chat: await chats.get(id(request)) }));
  app.patch("/api/whatsapp/chats/:id", async (request) => ({ chat: await chats.rename(id(request), parse(RenameBody, request.body).name) }));
  app.get("/api/whatsapp/chats/:id/messages", async (request) => ({ items: await chats.messages(id(request), parse(MessagesQuery, request.query).before) }));
  app.post("/api/whatsapp/chats/:id/read", async (request) => chats.markRead(id(request)));
  app.post("/api/whatsapp/chats/:id/text", async (request) => ({ message: await chats.sendText(id(request), parse(TextBody, request.body).text) }));
  app.post("/api/whatsapp/chats/:id/file", { bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const body = parse(FileBody, request.body);
    const data = Buffer.from(body.data, "base64");
    if (data.length > MAX_MEDIA_BYTES) throw Errors.badRequest("Files up to 5 MB can be sent");
    return { message: await chats.sendFile(id(request), { data, mime: body.mime, filename: body.fileName, caption: body.caption ?? null }) };
  });
  app.post("/api/whatsapp/chats/:id/template", async (request) => ({ message: await chats.sendTemplate(id(request), parse(TemplateBody, request.body).templateId) }));
  app.post("/api/whatsapp/chats/:id/draft", async (request) => chats.draft(id(request)));

  app.get("/api/whatsapp/media/:id", async (request, reply) => {
    const media = await chats.media(id(request));
    // Shown in the page only for safe types (never SVG or HTML).
    const inline = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/)/.test(media.mime) || media.mime === "application/pdf";
    const name = (media.name ?? "file").replace(/[^\w. -]/g, "_");
    return reply
      .type(media.mime)
      .header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${name}"`)
      .header("Cache-Control", "private, max-age=86400")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox")
      .send(Buffer.from(media.data));
  });
}
