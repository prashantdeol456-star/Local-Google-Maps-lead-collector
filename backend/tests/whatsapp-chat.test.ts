import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MetaWhatsAppProvider } from "../src/providers/whatsapp/meta.js";
import type { ReplyContext, ReplyWriter } from "../src/services/inbox/replyWriter.js";
import { mediaKindOf, windowOpenUntil } from "../src/services/whatsapp/chatService.js";
import { createTestApp } from "./helpers.js";

const APP_SECRET = "chat-app-secret-123";
const NUMBER_ID = "106540352242922";
const PERSON = "919876543210";

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
let sent: { url: string; body: unknown }[] = [];
let n = 0;
let failNextSend: string | null = null;
let aiContexts: ReplyContext[] = [];

const graph = async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  if (u.endsWith("/media") && init?.method === "POST") {
    sent.push({ url: u, body: "upload" });
    return json({ id: "MEDIA_UP_1" });
  }
  if (u.endsWith("/messages")) {
    const body = JSON.parse(String(init?.body));
    sent.push({ url: u, body });
    if (body.status === "read") return json({ success: true });
    if (failNextSend) {
      const message = failNextSend;
      failNextSend = null;
      return json({ error: { message, code: 131047 } }, 400);
    }
    return json({ messaging_product: "whatsapp", messages: [{ id: `wamid.OUT${++n}` }] });
  }
  if (u.includes("/MEDIA_IN_1")) return json({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", mime_type: "image/jpeg", file_size: 4 });
  if (u.startsWith("https://lookaside.fbsbx.com/")) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { "content-type": "image/jpeg" } });
  return json({ error: { message: `unexpected ${u}` } }, 404);
};

const provider = new MetaWhatsAppProvider({ accessToken: "EAAGtestToken1234567890", phoneNumberId: NUMBER_ID, appSecret: APP_SECRET, verifyToken: "v", fetchImpl: graph as typeof fetch });

const writer: ReplyWriter = {
  model: "test-model",
  async write(context) {
    aiContexts.push(context);
    return { intent: "question", summary: "", language: "English", should_reply: true, reply: "Yes, we help with Canada study visas. When can we call you?", confidence: 0.9, needs_human: false, reason: "" };
  },
};

const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

async function webhook(value: Record<string, unknown>) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: NUMBER_ID }, ...value } }] }],
  });
  const signature = `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
  return t.app.inject({ method: "POST", url: "/api/webhooks/whatsapp/meta", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, payload: body });
}

const ts = (date: Date) => String(Math.floor(date.getTime() / 1000));
const incoming = (id: string, text: string, at = new Date()) =>
  webhook({ contacts: [{ wa_id: PERSON, profile: { name: "Riya" } }], messages: [{ id, from: PERSON, timestamp: ts(at), type: "text", text: { body: text } }] });

const settle = () => new Promise((r) => setTimeout(r, 50));

beforeAll(async () => {
  t = await createTestApp({}, { whatsappProvider: provider, replyWriter: writer });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.waMessage.deleteMany();
  await t.db.waChat.deleteMany();
  await t.db.waMedia.deleteMany();
  sent = [];
  aiContexts = [];
});

describe("WhatsApp chat rules", () => {
  it("knows the 24-hour window and file kinds", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    expect(windowOpenUntil(new Date("2026-11-24T10:00:00Z"), now)?.toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(windowOpenUntil(new Date("2026-11-23T11:00:00Z"), now)).toBeNull();
    expect(windowOpenUntil(null, now)).toBeNull();
    expect(mediaKindOf("image/jpeg")).toBe("image");
    expect(mediaKindOf("image/webp")).toBe("document");
    expect(mediaKindOf("audio/ogg")).toBe("audio");
    expect(mediaKindOf("application/pdf")).toBe("document");
  });
});

describe("WhatsApp Chat", () => {
  it("shows an incoming message as a chat, with an AI draft, and sends your reply", async () => {
    expect((await incoming("wamid.IN1", "Hi, do you do Canada study visa?")).statusCode).toBe(200);
    await settle();

    const list = (await call("GET", "/api/whatsapp/chats")).json().items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ phone: `+${PERSON}`, name: "Riya", unreadCount: 1, lastMessageText: "Hi, do you do Canada study visa?" });
    expect(list[0].windowOpenUntil).not.toBeNull();
    expect(list[0].aiDraft).toBe("Yes, we help with Canada study visas. When can we call you?");
    expect(aiContexts[0]).toMatchObject({ platform: "whatsapp", participantName: "Riya", messages: [{ direction: "in", text: "Hi, do you do Canada study visa?" }] });

    // Delivered twice by Meta: stored once.
    await incoming("wamid.IN1", "Hi, do you do Canada study visa?");
    const chatId = list[0].id;
    expect((await call("GET", `/api/whatsapp/chats/${chatId}/messages`)).json().items).toHaveLength(1);

    // Opening the chat: unread 0 and blue ticks for the person.
    await call("POST", `/api/whatsapp/chats/${chatId}/read`);
    expect(sent.find((s) => (s.body as { status?: string }).status === "read")?.body).toMatchObject({ status: "read", message_id: "wamid.IN1" });
    expect((await call("GET", `/api/whatsapp/chats/${chatId}`)).json().chat.unreadCount).toBe(0);

    const reply = await call("POST", `/api/whatsapp/chats/${chatId}/text`, { text: "Yes! Can we call you at 5 pm?" });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().message).toMatchObject({ direction: "out", status: "sent", wamid: "wamid.OUT1", body: "Yes! Can we call you at 5 pm?" });
    expect(sent.at(-1)?.body).toMatchObject({ to: PERSON, type: "text", text: { body: "Yes! Can we call you at 5 pm?" } });
    expect((await call("GET", `/api/whatsapp/chats/${chatId}`)).json().chat.aiDraft).toBeNull();

    // Ticks: delivered, then read; an older "sent" never goes back.
    const tick = (status: string) => webhook({ statuses: [{ id: "wamid.OUT1", status, timestamp: ts(new Date()), recipient_id: PERSON }] });
    await tick("delivered");
    await tick("read");
    await tick("sent");
    const out = (await call("GET", `/api/whatsapp/chats/${chatId}/messages`)).json().items.at(-1);
    expect(out.status).toBe("read");
  });

  it("keeps received photos, and sends files", async () => {
    await webhook({
      contacts: [{ wa_id: PERSON, profile: { name: "Riya" } }],
      messages: [{ id: "wamid.IMG1", from: PERSON, timestamp: ts(new Date()), type: "image", image: { id: "MEDIA_IN_1", mime_type: "image/jpeg", caption: "My passport" } }],
    });
    await settle();
    const chat = (await call("GET", "/api/whatsapp/chats")).json().items[0];
    const [msg] = (await call("GET", `/api/whatsapp/chats/${chat.id}/messages`)).json().items;
    expect(msg).toMatchObject({ type: "image", body: "My passport", mediaMime: "image/jpeg", mediaSize: 4 });
    const file = await call("GET", `/api/whatsapp/media/${msg.mediaId}`);
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect(file.headers["content-disposition"]).toMatch(/^inline/);
    expect(file.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const pdf = Buffer.from("%PDF-1.4 brochure").toString("base64");
    const res = await call("POST", `/api/whatsapp/chats/${chat.id}/file`, { fileName: "brochure.pdf", mime: "application/pdf", data: pdf, caption: "Our fees" });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatchObject({ type: "document", status: "sent", mediaName: "brochure.pdf", body: "Our fees" });
    expect(sent.at(-1)?.body).toMatchObject({ to: PERSON, type: "document", document: { id: "MEDIA_UP_1", filename: "brochure.pdf", caption: "Our fees" } });
  });

  it("allows only a template after 24 hours, and for a new chat", async () => {
    await incoming("wamid.OLD", "Hello", new Date(Date.now() - 25 * 60 * 60 * 1000));
    await settle();
    const chat = (await call("GET", "/api/whatsapp/chats")).json().items[0];
    expect(chat.windowOpenUntil).toBeNull();
    const closed = await call("POST", `/api/whatsapp/chats/${chat.id}/text`, { text: "Hi again" });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe("WINDOW_CLOSED");

    const template = (await call("POST", "/api/whatsapp/templates", { name: "visa_followup", language: "en", category: "marketing", paramFormat: "positional", approvalStatus: "approved", body: "Hello {{name|there}}, any update on your study plans?" })).json().template;
    const res = await call("POST", `/api/whatsapp/chats/${chat.id}/template`, { templateId: template.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatchObject({ type: "template", templateName: "visa_followup", body: "Hello Riya, any update on your study plans?" });
    expect(sent.at(-1)?.body).toMatchObject({ type: "template", template: { name: "visa_followup" } });

    const started = await call("POST", "/api/whatsapp/chats", { phone: "+91 99999 00000", templateId: template.id, name: "Aman" });
    expect(started.statusCode).toBe(200);
    expect(started.json().chat).toMatchObject({ phone: "+919999900000", name: "Aman", windowOpenUntil: null });
    expect(started.json().message.body).toBe("Hello Aman, any update on your study plans?");
  });

  it("shows why a message failed", async () => {
    await incoming("wamid.IN9", "Price?");
    await settle();
    const chat = (await call("GET", "/api/whatsapp/chats")).json().items[0];
    failNextSend = "Re-engagement message";
    const res = await call("POST", `/api/whatsapp/chats/${chat.id}/text`, { text: "₹25,000" });
    expect(res.json().message).toMatchObject({ status: "failed", error: expect.stringContaining("Re-engagement message") });
  });
});
