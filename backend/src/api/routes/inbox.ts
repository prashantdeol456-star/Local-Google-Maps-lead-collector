import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { InboxWorker } from "../../jobs/inboxWorker.js";
import { PLATFORMS, REPLY_MODES, type InboxService } from "../../services/inbox/inboxService.js";
import type { InboxRuntime, SecretName } from "../../services/inbox/runtime.js";
import { Errors } from "../../utils/errors.js";
import { requireSession } from "../middleware/auth.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const Platform = z.enum(PLATFORMS as [string, ...string[]]);
const Mode = z.enum(REPLY_MODES as [string, ...string[]]);

const SettingsBody = z
  .object({
    enabled: z.boolean(),
    businessProfile: z.string().max(20_000),
    faqs: z.string().max(30_000),
    style: z.string().max(5_000),
    neverSay: z.string().max(5_000),
    modes: z.object(Object.fromEntries(PLATFORMS.map((p) => [p, Mode.optional()]))).strict(),
    minConfidence: z.number().min(0.5).max(1),
    maxAutoPerChatPerDay: z.number().int().min(1).max(50),
  })
  .partial()
  .strict();

const ListQuery = Pagination.extend({
  platform: Platform.optional(),
  status: z.enum(["needs_reply", "draft_ready", "replied", "handled", "no_reply"]).optional(),
  q: optionalText(200),
});

const TextBody = z.object({ text: z.string().trim().min(1).max(4000) });

// LinkedIn chats read by the extension in your own LinkedIn tab.
const LinkedInSync = z.object({
  threads: z
    .array(
      z.object({
        threadId: z.string().trim().min(1).max(300),
        participantName: z.string().trim().min(1).max(200),
        profileUrl: z.string().max(2000).nullish(),
        messages: z
          .array(z.object({ key: z.string().min(1).max(200), fromMe: z.boolean(), text: z.string().max(8000), sentAt: z.iso.datetime().nullish() }))
          .max(100),
      }),
    )
    .max(20),
});

const AiConfigBody = z
  .object({
    provider: z.enum(["anthropic", "gemini"]),
    // Empty = the provider's default model; a custom id may be typed.
    model: z.string().trim().max(100).regex(/^[a-z0-9.\-]*$/i, "model id: letters, digits, dots and dashes"),
    effort: z.enum(["low", "medium", "high"]),
  })
  .partial()
  .strict();

const SecretParams = z.object({ name: z.enum(["anthropicKey", "geminiKey", "telegramToken"]) });

export async function inboxRoutes(app: FastifyInstance, opts: { inbox: InboxService; worker: InboxWorker; runtime: InboxRuntime }) {
  const { inbox, runtime, worker } = opts;

  // ---- AI provider, model and keys (entered in the admin panel) ----
  app.get("/api/inbox/ai-config", async () => runtime.describe());
  app.put("/api/inbox/ai-config", async (request) => {
    requireSession(request);
    const body = parse(AiConfigBody, request.body);
    await inbox.setAiChoice({
      ...(body.provider ? { aiProvider: body.provider } : {}),
      ...(body.model !== undefined ? { aiModel: body.model } : {}),
      ...(body.effort ? { aiEffort: body.effort } : {}),
    });
    return runtime.describe();
  });
  app.put("/api/inbox/secrets/:name", async (request) => {
    requireSession(request);
    const { name } = parse(SecretParams, request.params);
    const { value } = parse(z.object({ value: z.string().max(500).nullable() }), request.body);
    try {
      await runtime.setSecret(name as SecretName, value);
    } catch (err) {
      throw Errors.badRequest(err instanceof Error ? err.message : String(err));
    }
    // A new bot starts reading its own messages from the beginning.
    if (name === "telegramToken") await inbox.resetTelegramOffset();
    return runtime.describe();
  });
  app.post("/api/inbox/test/:what", async (request) => {
    requireSession(request);
    const { what } = parse(z.object({ what: z.enum(["ai", "telegram"]) }), request.params);
    return runtime.test(what);
  });

  // ---- Settings ----
  app.get("/api/inbox/settings", async () => ({ settings: await inbox.settings() }));
  app.put("/api/inbox/settings", async (request) => {
    requireSession(request);
    return { settings: await inbox.updateSettings(parse(SettingsBody, request.body) as Parameters<InboxService["updateSettings"]>[0]) };
  });
  app.get("/api/inbox/status", async () => inbox.status());

  // ---- Chats ----
  app.get("/api/inbox/conversations", async (request) => {
    const query = parse(ListQuery, request.query);
    const result = await inbox.list({ platform: query.platform, status: query.status, q: query.q, ...toSkipTake(query) });
    return { ...result, page: query.page, pageSize: query.pageSize };
  });
  app.get("/api/inbox/conversations/:id", async (request) => inbox.get(parse(IdParams, request.params).id));
  app.post("/api/inbox/conversations/:id/ai-reply", async (request) => ({ draft: await inbox.respond(parse(IdParams, request.params).id, { force: true }) }));
  app.post("/api/inbox/conversations/:id/send", async (request) => inbox.sendManual(parse(IdParams, request.params).id, parse(TextBody, request.body).text));
  app.post("/api/inbox/conversations/:id/handled", async (request) => ({ conversation: await inbox.markHandled(parse(IdParams, request.params).id) }));
  app.patch("/api/inbox/conversations/:id/mode", async (request) => {
    const { mode } = parse(z.object({ mode: Mode.nullable() }), request.body);
    return { conversation: await inbox.setMode(parse(IdParams, request.params).id, mode as Parameters<InboxService["setMode"]>[1]) };
  });

  // ---- Drafts ----
  app.post("/api/inbox/drafts/:id/approve", async (request) => {
    const body = parse(z.object({ text: z.string().max(4000).optional() }), request.body ?? {});
    return inbox.approve(parse(IdParams, request.params).id, body.text);
  });
  app.post("/api/inbox/drafts/:id/dismiss", async (request) => {
    await inbox.dismiss(parse(IdParams, request.params).id);
    return { ok: true };
  });

  // "Check now" in the admin panel (instead of waiting for the next poll).
  app.post("/api/inbox/refresh", async () => {
    await Promise.all([worker.pollMetaOnce(), worker.telegramOnce(0).catch(() => 0)]);
    await worker.processOnce();
    return { ok: true };
  });

  // ---- LinkedIn Messenger extension ----
  app.post("/api/inbox/linkedin/sync", async (request) => {
    const { threads } = parse(LinkedInSync, request.body);
    const now = Date.now();
    const drafts = await inbox.syncLinkedIn(
      threads.map((t) => ({
        externalThreadId: t.threadId,
        participantId: t.profileUrl ?? null,
        participantName: t.participantName,
        participantUsername: null,
        // LinkedIn shows relative times only: keep the page's order, newest last.
        messages: t.messages.map((m, i) => ({
          externalId: `li:${m.key}`,
          direction: m.fromMe ? ("out" as const) : ("in" as const),
          text: m.text,
          sentAt: m.sentAt ? new Date(m.sentAt) : new Date(now - (t.messages.length - i) * 1000),
        })),
      })),
    );
    await opts.worker.processOnce();
    return { drafts: drafts.map(publicLinkedInDraft) };
  });
  app.get("/api/inbox/linkedin/drafts", async (request) => {
    const { threadId } = parse(z.object({ threadId: optionalText(300) }), request.query);
    return { drafts: (await inbox.pendingLinkedIn(threadId)).map(publicLinkedInDraft) };
  });
  app.post("/api/inbox/linkedin/drafts/:id/result", async (request) => {
    const body = parse(z.object({ status: z.enum(["sent", "skipped"]), text: z.string().max(8000).optional() }), request.body);
    return { draft: await inbox.reportLinkedIn(parse(IdParams, request.params).id, body.status, body.text) };
  });
}

function publicLinkedInDraft(d: { id: string; threadId: string; participantName: string; text: string; confidence: number | null; decision: string | null }) {
  return { id: d.id, threadId: d.threadId, participantName: d.participantName, text: d.text, confidence: d.confidence, decision: d.decision };
}
