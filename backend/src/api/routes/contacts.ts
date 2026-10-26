import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeLinkedInProfileUrl } from "@platform/shared";
import type { ContactService } from "../../services/contacts/contactService.js";
import { BODY_LIMIT, type ChannelTemplateService } from "../../services/contacts/channelTemplates.js";
import { templateCsv, templateXlsx } from "../../services/contacts/sheet.js";
import type { CampaignLogService } from "../../services/outreach/campaignLogService.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_FILE_BYTES / 3) * 4;

const ImportBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  /** File contents, base64 */
  data: z.string().min(1).max(MAX_BASE64),
  listName: z.string().trim().max(100).nullish(),
});

const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

const ContactFilters = z.object({
  q: optionalText(200),
  listName: optionalText(100),
  hasLinkedIn: bool,
  hasEmail: bool,
  hasPhone: bool,
});

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const UpdateBody = z
  .object({
    name: z.string().trim().min(1).max(300),
    linkedinUrl: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .transform((v, ctx) => {
        if (!v) return null;
        const url = normalizeLinkedInProfileUrl(v);
        if (!url) ctx.addIssue({ code: "custom", message: "Not a LinkedIn profile URL" });
        return url;
      }),
    email: z
      .union([z.email().max(254), z.literal(""), z.null()])
      .transform((v) => (v ? v.toLowerCase() : null)),
    phone: nullableText(50),
    designation: nullableText(300),
    company: nullableText(300),
    listName: nullableText(100),
  })
  .partial()
  .strict();

const DeleteBody = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(5000) });

const TemplateChannel = z.enum(["sms", "linkedin"]);
const TemplateBody = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(Math.max(BODY_LIMIT.sms, BODY_LIMIT.linkedin)),
});

const LogChannel = z.enum(["email", "whatsapp", "linkedin"]);
const AttemptStatus = z.enum(["queued", "sending", "sent", "delivered", "failed", "skipped", "cancelled"]);

export async function contactRoutes(app: FastifyInstance, opts: { contacts: ContactService; channelTemplates: ChannelTemplateService; logs: CampaignLogService }) {
  const { contacts, channelTemplates, logs } = opts;

  // ---- Contacts uploaded from a sheet ----
  app.post("/api/contacts/import", { bodyLimit: MAX_BASE64 + 64 * 1024 }, async (request) => {
    const body = parse(ImportBody, request.body);
    const data = Buffer.from(body.data, "base64");
    return contacts.importSheet(body.fileName, data, body.listName || null);
  });

  app.get("/api/contacts/template.xlsx", async (_request, reply) =>
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", 'attachment; filename="contacts-template.xlsx"')
      .header("Cache-Control", "no-store")
      .send(await templateXlsx()),
  );

  app.get("/api/contacts/template.csv", async (_request, reply) =>
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="contacts-template.csv"')
      .header("Cache-Control", "no-store")
      .send(templateCsv()),
  );

  app.get("/api/contacts", async (request) => {
    const query = parse(Pagination.extend(ContactFilters.shape), request.query);
    const result = await contacts.list({ ...query, ...toSkipTake(query) });
    return { ...result, page: query.page, pageSize: query.pageSize };
  });

  app.get("/api/contacts/facets", async () => contacts.facets());
  app.get("/api/contacts/:id", async (request) => ({ contact: await contacts.get(parse(IdParams, request.params).id) }));
  app.patch("/api/contacts/:id", async (request) => ({
    contact: await contacts.update(parse(IdParams, request.params).id, parse(UpdateBody, request.body)),
  }));
  app.post("/api/contacts/delete", async (request) => ({ deleted: await contacts.deleteMany(parse(DeleteBody, request.body).ids) }));

  // ---- SMS and LinkedIn templates (email and WhatsApp keep their own routes) ----
  app.get("/api/channel-templates", async (request) => {
    const { channel } = parse(z.object({ channel: TemplateChannel }), request.query);
    return { items: await channelTemplates.list(channel) };
  });
  app.post("/api/channel-templates", async (request, reply) => {
    const body = parse(TemplateBody.extend({ channel: TemplateChannel }), request.body);
    return reply.code(201).send({ template: await channelTemplates.create(body.channel, body) });
  });
  app.post("/api/channel-templates/preview", async (request) => {
    const body = parse(z.object({ channel: TemplateChannel, body: z.string().max(10_000), contactId: z.string().min(1).max(64).optional() }), request.body);
    return channelTemplates.preview(body.channel, body.body, body.contactId);
  });
  app.patch("/api/channel-templates/:id", async (request) => ({
    template: await channelTemplates.update(parse(IdParams, request.params).id, parse(TemplateBody.partial().strict(), request.body)),
  }));
  app.delete("/api/channel-templates/:id", async (request) => {
    await channelTemplates.delete(parse(IdParams, request.params).id);
    return { ok: true };
  });

  // ---- Campaign logs across channels ----
  app.get("/api/campaign-logs/campaigns", async (request) => {
    const { channel } = parse(z.object({ channel: LogChannel.optional() }), request.query);
    return { items: await logs.campaigns(channel) };
  });
  app.get("/api/campaign-logs/messages", async (request) => {
    const query = parse(
      Pagination.extend({ channel: LogChannel.optional(), status: AttemptStatus.optional(), campaignId: optionalText(64), q: optionalText(200) }),
      request.query,
    );
    const result = await logs.messages({ ...query, ...toSkipTake(query) });
    return { ...result, page: query.page, pageSize: query.pageSize };
  });
  app.get("/api/campaign-logs/events", async () => ({ items: await logs.events(100) }));
}
