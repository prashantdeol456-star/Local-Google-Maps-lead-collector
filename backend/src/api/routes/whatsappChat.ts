import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_LABELS, MAX_MEDIA_BYTES, type WhatsAppChatService } from "../../services/whatsapp/chatService.js";
import { Errors } from "../../utils/errors.js";
import { IdParams, parse } from "../validation.js";

// WhatsApp Chat page: chats through the user's own WhatsApp number (Meta Cloud API).
// Limits below are WhatsApp's own (Cloud API docs, Nov 2026).

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "unread", "archived", "starred"]).optional(),
  label: z.string().trim().max(40).optional(),
});
const MessagesQuery = z.object({
  before: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  starred: z.enum(["1", "0"]).optional(),
});
const ReplyTo = z.string().min(1).max(64).nullish();
const TextBody = z.object({ text: z.string().trim().min(1).max(4096), replyTo: ReplyTo });
const base64 = z.string().min(1).max(Math.ceil((MAX_MEDIA_BYTES * 4) / 3) + 8);
const FileBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(3).max(100).regex(/^[\w.+-]+\/[\w.+-]+$/),
  data: base64,
  caption: z.string().trim().max(1024).nullish(),
  replyTo: ReplyTo,
});
const VoiceBody = z.object({ mime: z.string().trim().max(100).regex(/^audio\/(webm|ogg)/), data: base64, replyTo: ReplyTo });
const LocationBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().max(100).nullish(),
  address: z.string().trim().max(200).nullish(),
  replyTo: ReplyTo,
});
const ContactsBody = z.object({
  contacts: z.array(z.object({ name: z.string().trim().min(1).max(100), phone: z.string().trim().min(6).max(30) })).min(1).max(10),
  replyTo: ReplyTo,
});
const Header = z.string().trim().max(60).nullish();
const Footer = z.string().trim().max(60).nullish();
const Body1024 = z.string().trim().min(1).max(1024);
const InteractiveBody = z.object({
  replyTo: ReplyTo,
  message: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("buttons"),
      header: Header,
      body: Body1024,
      footer: Footer,
      buttons: z.array(z.object({ id: z.string().trim().min(1).max(256), title: z.string().trim().min(1).max(20) })).min(1).max(3),
    }),
    z.object({
      type: z.literal("list"),
      header: Header,
      body: z.string().trim().min(1).max(4096),
      footer: Footer,
      button: z.string().trim().min(1).max(20),
      sections: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(24),
            rows: z.array(z.object({ id: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(24), description: z.string().trim().max(72).nullish() })).min(1).max(10),
          }),
        )
        .min(1)
        .max(10)
        .refine((s) => s.reduce((n, x) => n + x.rows.length, 0) <= 10, "A list can have at most 10 rows in all"),
    }),
    z.object({ type: z.literal("cta_url"), header: Header, body: Body1024, footer: Footer, displayText: z.string().trim().min(1).max(20), url: z.url().max(2000).regex(/^https?:\/\//) }),
    z.object({ type: z.literal("location_request"), body: Body1024 }),
  ]),
});
const ReactBody = z.object({ emoji: z.string().max(16) });
const ForwardBody = z.object({ chatIds: z.array(z.string().min(1).max(64)).min(1).max(5) });
const StarBody = z.object({ starred: z.boolean() });
const TemplateBody = z.object({ templateId: z.string().min(1).max(64) });
const StartBody = z.object({ phone: z.string().trim().min(6).max(30), templateId: z.string().min(1).max(64), name: z.string().trim().max(100).nullish() });
const UpdateChatBody = z
  .object({
    name: z.string().trim().max(100).nullable(),
    pinned: z.boolean(),
    archived: z.boolean(),
    mutedUntil: z.coerce.date().nullable(),
    labels: z.array(z.string().trim().min(1).max(40)).max(MAX_LABELS),
    notes: z.string().max(2000).nullable(),
    unread: z.boolean(),
  })
  .partial()
  .strict();
const BlockBody = z.object({ blocked: z.boolean() });
const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time like "09:30"');
const SettingsBody = z
  .object({
    greetingOn: z.boolean(),
    greetingText: z.string().trim().max(1000).nullable(),
    awayOn: z.boolean(),
    awayText: z.string().trim().max(1000).nullable(),
    workStart: Hhmm,
    workEnd: Hhmm,
    workDays: z.array(z.number().int().min(0).max(6)).max(7),
    notify: z.boolean(),
  })
  .partial()
  .strict();
const QuickReplyBody = z.object({ shortcut: z.string().trim().min(1).max(26), text: z.string().trim().min(1).max(4096) });
const ProfileBody = z
  .object({
    about: z.string().trim().min(1).max(139),
    address: z.string().trim().max(256),
    description: z.string().trim().max(512),
    email: z.email().max(128),
    websites: z.array(z.url().max(256).regex(/^https?:\/\//)).max(2),
    vertical: z.string().trim().max(40),
  })
  .partial()
  .strict();

export async function whatsappChatRoutes(app: FastifyInstance, opts: { chats: WhatsAppChatService }) {
  const { chats } = opts;
  const id = (request: { params: unknown }) => parse(IdParams, request.params).id;
  const fileLimit = { bodyLimit: 8 * 1024 * 1024 };

  // ---- Chats ----
  app.get("/api/whatsapp/chats", async (request) => {
    const q = parse(ListQuery, request.query);
    return { items: await chats.list({ q: q.q || undefined, filter: q.filter, label: q.label || undefined }) };
  });
  app.get("/api/whatsapp/chat-labels", async () => ({ items: await chats.labels() }));
  app.post("/api/whatsapp/chats", async (request) => chats.start(parse(StartBody, request.body)));
  app.get("/api/whatsapp/chats/:id", async (request) => ({ chat: await chats.get(id(request)) }));
  app.patch("/api/whatsapp/chats/:id", async (request) => ({ chat: await chats.update(id(request), parse(UpdateChatBody, request.body)) }));
  app.delete("/api/whatsapp/chats/:id", async (request) => chats.remove(id(request)));
  app.post("/api/whatsapp/chats/:id/block", async (request) => ({ chat: await chats.block(id(request), parse(BlockBody, request.body).blocked) }));
  app.get("/api/whatsapp/chats/:id/messages", async (request) => {
    const q = parse(MessagesQuery, request.query);
    return { items: await chats.messages(id(request), { before: q.before, q: q.q || undefined, starred: q.starred === "1" }) };
  });
  app.post("/api/whatsapp/chats/:id/read", async (request) => chats.markRead(id(request)));
  app.post("/api/whatsapp/chats/:id/typing", async (request) => chats.typing(id(request)));
  app.post("/api/whatsapp/chats/:id/draft", async (request) => chats.draft(id(request)));

  // ---- Sending ----
  app.post("/api/whatsapp/chats/:id/text", async (request) => {
    const body = parse(TextBody, request.body);
    return { message: await chats.sendText(id(request), body.text, body.replyTo) };
  });
  app.post("/api/whatsapp/chats/:id/file", fileLimit, async (request) => {
    const body = parse(FileBody, request.body);
    const data = Buffer.from(body.data, "base64");
    if (data.length > MAX_MEDIA_BYTES) throw Errors.badRequest("Files up to 5 MB can be sent");
    return { message: await chats.sendFile(id(request), { data, mime: body.mime, filename: body.fileName, caption: body.caption ?? null }, body.replyTo) };
  });
  app.post("/api/whatsapp/chats/:id/voice", fileLimit, async (request) => {
    const body = parse(VoiceBody, request.body);
    return { message: await chats.sendVoice(id(request), { data: Buffer.from(body.data, "base64"), mime: body.mime }, body.replyTo) };
  });
  app.post("/api/whatsapp/chats/:id/location", async (request) => {
    const { replyTo, ...location } = parse(LocationBody, request.body);
    return { message: await chats.sendLocation(id(request), location, replyTo) };
  });
  app.post("/api/whatsapp/chats/:id/contacts", async (request) => {
    const body = parse(ContactsBody, request.body);
    return { message: await chats.sendContacts(id(request), body.contacts, body.replyTo) };
  });
  app.post("/api/whatsapp/chats/:id/interactive", async (request) => {
    const body = parse(InteractiveBody, request.body);
    return { message: await chats.sendInteractive(id(request), body.message, body.replyTo) };
  });
  app.post("/api/whatsapp/chats/:id/template", async (request) => ({ message: await chats.sendTemplate(id(request), parse(TemplateBody, request.body).templateId) }));

  // ---- One message ----
  app.post("/api/whatsapp/messages/:id/react", async (request) => chats.react(id(request), parse(ReactBody, request.body).emoji));
  app.post("/api/whatsapp/messages/:id/forward", async (request) => chats.forward(id(request), parse(ForwardBody, request.body).chatIds));
  app.post("/api/whatsapp/messages/:id/star", async (request) => chats.star(id(request), parse(StarBody, request.body).starred));
  app.post("/api/whatsapp/messages/:id/hide", async (request) => chats.hide(id(request)));

  // ---- Settings, quick replies, business profile ----
  app.get("/api/whatsapp/chat-settings", async () => ({ settings: await chats.settings() }));
  app.patch("/api/whatsapp/chat-settings", async (request) => ({ settings: await chats.updateSettings(parse(SettingsBody, request.body)) }));
  app.get("/api/whatsapp/quick-replies", async () => ({ items: await chats.quickReplies() }));
  app.post("/api/whatsapp/quick-replies", async (request) => ({ item: await chats.saveQuickReply(parse(QuickReplyBody, request.body)) }));
  app.patch("/api/whatsapp/quick-replies/:id", async (request) => ({ item: await chats.saveQuickReply({ id: id(request), ...parse(QuickReplyBody, request.body) }) }));
  app.delete("/api/whatsapp/quick-replies/:id", async (request) => chats.deleteQuickReply(id(request)));
  app.get("/api/whatsapp/business-profile", async () => ({ profile: await chats.profile() }));
  app.patch("/api/whatsapp/business-profile", async (request) => ({ profile: await chats.updateProfile(parse(ProfileBody, request.body)) }));

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
