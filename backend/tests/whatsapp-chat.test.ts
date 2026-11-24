import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MetaWhatsAppProvider } from "../src/providers/whatsapp/meta.js";
import type { ReplyContext, ReplyWriter } from "../src/services/inbox/replyWriter.js";
import { mediaKindOf, windowOpenUntil, withinHours } from "../src/services/whatsapp/chatService.js";
import { oggOpusChannels, opusPacketSamples, webmOpusToOgg } from "../src/services/whatsapp/oggOpus.js";
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
  if (u.includes("/block_users")) {
    sent.push({ url: `${init?.method} block_users`, body: JSON.parse(String(init?.body)) });
    return json({ block_users: { added_users: [] } });
  }
  if (u.includes("/whatsapp_business_profile")) {
    if (init?.method === "POST") {
      sent.push({ url: "profile", body: JSON.parse(String(init?.body)) });
      return json({ success: true });
    }
    return json({ data: [{ about: "Study visa experts", description: "Canada, UK, Australia", websites: ["https://visa.example.in"], vertical: "EDU", messaging_product: "whatsapp" }] });
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

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) =>
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
  await t.db.waQuickReply.deleteMany();
  await t.db.waChatSettings.deleteMany();
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
    expect(mediaKindOf("image/webp")).toBe("sticker");
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


// ---- Everything the Cloud API and the WhatsApp app have in common ----

const one = async () => {
  await incoming("wamid.IN1", "Hi, I need a Canada study visa");
  await settle();
  return (await call("GET", "/api/whatsapp/chats")).json().items[0] as { id: string };
};
const messages = async (chatId: string) => (await call("GET", `/api/whatsapp/chats/${chatId}/messages`)).json().items as Record<string, any>[];
const lastSent = () => sent.at(-1)?.body as Record<string, any>;

describe("WhatsApp Chat: like the app", () => {
  it("shows replies, reactions, edits and deletions from the person", async () => {
    const chat = await one();
    const ours = (await call("POST", `/api/whatsapp/chats/${chat.id}/text`, { text: "Sure! Which intake?" })).json().message.wamid as string;
    // They quote our message, react to it, edit their first message, then delete it.
    await webhook({ contacts: [{ wa_id: PERSON, profile: { name: "Riya" } }], messages: [{ id: "wamid.IN2", from: PERSON, timestamp: ts(new Date()), type: "text", text: { body: "January please" }, context: { id: ours } }] });
    await webhook({ messages: [{ id: "wamid.R1", from: PERSON, timestamp: ts(new Date()), type: "reaction", reaction: { message_id: ours, emoji: "👍" } }] });
    await webhook({ messages: [{ id: "wamid.E1", from: PERSON, timestamp: ts(new Date()), type: "edit", edit: { original_message_id: "wamid.IN1", message: { type: "text", text: { body: "Hi, I need a UK study visa" } } } }] });
    await webhook({ messages: [{ id: "wamid.F1", from: PERSON, timestamp: ts(new Date()), type: "text", text: { body: "see this" }, context: { forwarded: true } }] });
    await settle();
    let list = await messages(chat.id);
    expect(list.map((m) => [m.direction, m.body])).toEqual([
      ["in", "Hi, I need a UK study visa"],
      ["out", "Sure! Which intake?"],
      ["in", "January please"],
      ["in", "see this"],
    ]);
    expect(list[0]!.editedAt).not.toBeNull();
    expect(list[1]!.reactions).toEqual({ in: "👍" });
    expect(list[2]!.quoted).toMatchObject({ direction: "out", body: "Sure! Which intake?" });
    expect(list[3]!.forwarded).toBe("forwarded");

    await webhook({ messages: [{ id: "wamid.D1", from: PERSON, timestamp: ts(new Date()), type: "revoke", revoke: { original_message_id: "wamid.IN2" } }] });
    await webhook({ messages: [{ id: "wamid.R2", from: PERSON, timestamp: ts(new Date()), type: "reaction", reaction: { message_id: ours } }] });
    list = await messages(chat.id);
    expect(list[2]).toMatchObject({ body: null, revokedAt: expect.any(String) });
    expect(list[1]!.reactions).toEqual({});
  });

  it("shows locations, contact cards and button choices from the person", async () => {
    const chat = await one();
    await webhook({ messages: [{ id: "wamid.L1", from: PERSON, timestamp: ts(new Date()), type: "location", location: { latitude: 28.6667, longitude: 77.122, name: "Our office", address: "Punjabi Bagh, Delhi" } }] });
    await webhook({ messages: [{ id: "wamid.C1", from: PERSON, timestamp: ts(new Date()), type: "contacts", contacts: [{ name: { formatted_name: "Aman Verma" }, phones: [{ phone: "+91 99999 00000", wa_id: "919999900000", type: "CELL" }] }] }] });
    await webhook({ messages: [{ id: "wamid.B1", from: PERSON, timestamp: ts(new Date()), type: "interactive", interactive: { type: "button_reply", button_reply: { id: "call_me", title: "Call me" } } }] });
    const list = await messages(chat.id);
    expect(list[1]).toMatchObject({ type: "location", body: "Our office, Punjabi Bagh, Delhi", payload: { location: { latitude: 28.6667, longitude: 77.122 } } });
    expect(list[2]).toMatchObject({ type: "contacts", body: "Aman Verma", payload: { contacts: [{ name: "Aman Verma", phones: [{ phone: "+91 99999 00000", waId: "919999900000" }] }] } });
    expect(list[3]).toMatchObject({ type: "text", body: "Call me", payload: { choice: { kind: "button", id: "call_me" } } });
  });

  it("sends quoted replies, reactions, locations, contact cards, buttons, lists, link buttons and location requests", async () => {
    const chat = await one();
    const [first] = await messages(chat.id);
    await call("POST", `/api/whatsapp/chats/${chat.id}/text`, { text: "Yes we do", replyTo: first!.id });
    expect(lastSent()).toMatchObject({ type: "text", context: { message_id: "wamid.IN1" } });
    expect((await call("POST", `/api/whatsapp/messages/${first!.id}/react`, { emoji: "❤️" })).statusCode).toBe(200);
    expect(lastSent()).toMatchObject({ type: "reaction", reaction: { message_id: "wamid.IN1", emoji: "❤️" } });
    await call("POST", `/api/whatsapp/chats/${chat.id}/location`, { latitude: 28.6667, longitude: 77.122, name: "Office", address: "Punjabi Bagh" });
    expect(lastSent()).toMatchObject({ type: "location", location: { latitude: 28.6667, longitude: 77.122, name: "Office" } });
    await call("POST", `/api/whatsapp/chats/${chat.id}/contacts`, { contacts: [{ name: "Counsellor Neha", phone: "+91 98100 00001" }] });
    expect(lastSent()).toMatchObject({ type: "contacts", contacts: [{ name: { formatted_name: "Counsellor Neha" }, phones: [{ phone: "+919810000001" }] }] });
    await call("POST", `/api/whatsapp/chats/${chat.id}/interactive`, { message: { type: "buttons", body: "When can we call?", buttons: [{ id: "today", title: "Today" }, { id: "tomorrow", title: "Tomorrow" }] } });
    expect(lastSent()).toMatchObject({ type: "interactive", interactive: { type: "button", action: { buttons: [{ type: "reply", reply: { id: "today", title: "Today" } }, { reply: { id: "tomorrow" } }] } } });
    await call("POST", `/api/whatsapp/chats/${chat.id}/interactive`, { message: { type: "list", body: "Pick a country", button: "Countries", sections: [{ title: "Popular", rows: [{ id: "ca", title: "Canada" }, { id: "uk", title: "UK", description: "Sept intake" }] }] } });
    expect(lastSent()).toMatchObject({ interactive: { type: "list", action: { button: "Countries", sections: [{ rows: [{ id: "ca" }, { id: "uk", description: "Sept intake" }] }] } } });
    await call("POST", `/api/whatsapp/chats/${chat.id}/interactive`, { message: { type: "cta_url", body: "Our fees", displayText: "See fees", url: "https://visa.example.in/fees" } });
    expect(lastSent()).toMatchObject({ interactive: { type: "cta_url", action: { name: "cta_url", parameters: { display_text: "See fees", url: "https://visa.example.in/fees" } } } });
    await call("POST", `/api/whatsapp/chats/${chat.id}/interactive`, { message: { type: "location_request", body: "Please share your location" } });
    expect(lastSent()).toMatchObject({ interactive: { type: "location_request_message", action: { name: "send_location" } } });
    // WhatsApp's limits are checked before sending.
    const tooMany = await call("POST", `/api/whatsapp/chats/${chat.id}/interactive`, { message: { type: "buttons", body: "x", buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` })) } });
    expect(tooMany.statusCode).toBe(400);
  });

  it("shows typing, blocks and unblocks, and forwards", async () => {
    const chat = await one();
    await call("POST", `/api/whatsapp/chats/${chat.id}/typing`);
    expect(lastSent()).toMatchObject({ status: "read", message_id: "wamid.IN1", typing_indicator: { type: "text" } });

    await incoming("wamid.IN7", "hello", new Date());
    const other = await webhook({ contacts: [{ wa_id: "919999900000", profile: { name: "Aman" } }], messages: [{ id: "wamid.A1", from: "919999900000", timestamp: ts(new Date()), type: "text", text: { body: "Hi" } }] });
    expect(other.statusCode).toBe(200);
    await settle();
    const chats = (await call("GET", "/api/whatsapp/chats")).json().items as { id: string; name: string }[];
    const aman = chats.find((c) => c.name === "Aman")!;
    const [msg] = await messages(chat.id);
    const fwd = (await call("POST", `/api/whatsapp/messages/${msg!.id}/forward`, { chatIds: [aman.id] })).json();
    expect(fwd.results).toEqual([{ chatId: aman.id, ok: true }]);
    expect(lastSent()).toMatchObject({ to: "919999900000", type: "text", text: { body: "Hi, I need a Canada study visa" } });

    const blocked = await call("POST", `/api/whatsapp/chats/${chat.id}/block`, { blocked: true });
    expect(blocked.json().chat.blocked).toBe(true);
    expect(sent.at(-1)).toMatchObject({ url: "POST block_users", body: { block_users: [{ user: `+${PERSON}` }] } });
    expect((await call("POST", `/api/whatsapp/chats/${chat.id}/text`, { text: "hi" })).json().error.code).toBe("BLOCKED");
    await call("POST", `/api/whatsapp/chats/${chat.id}/block`, { blocked: false });
    expect(sent.at(-1)).toMatchObject({ url: "DELETE block_users" });
  });

  it("pins, archives, labels, mutes, stars and hides, like the app", async () => {
    const chat = await one();
    await call("PATCH", `/api/whatsapp/chats/${chat.id}`, { labels: ["Hot lead", "Canada"], pinned: true, notes: "Wants Jan intake", name: "Riya S" });
    let view = (await call("GET", `/api/whatsapp/chats/${chat.id}`)).json().chat;
    expect(view).toMatchObject({ pinned: true, labels: ["Hot lead", "Canada"], notes: "Wants Jan intake", name: "Riya S" });
    expect((await call("GET", "/api/whatsapp/chat-labels")).json().items).toEqual(["Canada", "Hot lead"]);
    expect((await call("GET", "/api/whatsapp/chats?label=Canada")).json().items).toHaveLength(1);
    expect((await call("GET", "/api/whatsapp/chats?label=UK")).json().items).toHaveLength(0);

    await call("PATCH", `/api/whatsapp/chats/${chat.id}`, { archived: true });
    expect((await call("GET", "/api/whatsapp/chats")).json().items).toHaveLength(0);
    expect((await call("GET", "/api/whatsapp/chats?filter=archived")).json().items).toHaveLength(1);
    // A new message brings it back.
    await incoming("wamid.IN8", "hello again");
    expect((await call("GET", "/api/whatsapp/chats")).json().items).toHaveLength(1);

    const [first, second] = await messages(chat.id);
    await call("POST", `/api/whatsapp/messages/${first!.id}/star`, { starred: true });
    expect((await call("GET", `/api/whatsapp/chats/${chat.id}/messages?starred=1`)).json().items).toHaveLength(1);
    expect((await call("GET", "/api/whatsapp/chats?filter=starred")).json().items).toHaveLength(1);
    await call("POST", `/api/whatsapp/messages/${second!.id}/hide`);
    expect(await messages(chat.id)).toHaveLength(1);
    expect((await call("GET", `/api/whatsapp/chats/${chat.id}/messages?q=canada`)).json().items).toHaveLength(1);

    await call("PATCH", `/api/whatsapp/chats/${chat.id}`, { unread: true, mutedUntil: new Date(Date.now() + 3600_000).toISOString() });
    view = (await call("GET", `/api/whatsapp/chats/${chat.id}`)).json().chat;
    expect(view.unreadCount).toBe(1);
    expect(view.mutedUntil).not.toBeNull();
    expect((await call("DELETE", `/api/whatsapp/chats/${chat.id}`)).statusCode).toBe(200);
    expect((await call("GET", "/api/whatsapp/chats")).json().items).toHaveLength(0);
  });

  it("sends the greeting and away messages, and keeps quick replies", async () => {
    const away = await call("PATCH", "/api/whatsapp/chat-settings", { greetingOn: true, greetingText: "Welcome to Global Visa! How can we help?", awayOn: true, awayText: "We are closed now, we will reply in the morning.", workDays: [] });
    expect(away.statusCode).toBe(200);
    await one();
    await settle();
    const chat = (await call("GET", "/api/whatsapp/chats")).json().items[0];
    const outs = (await messages(chat.id)).filter((m) => m.direction === "out").map((m) => m.body);
    expect(outs).toEqual(["Welcome to Global Visa! How can we help?", "We are closed now, we will reply in the morning."]);
    // Not again for the next message.
    await incoming("wamid.IN9", "?");
    await settle();
    expect((await messages(chat.id)).filter((m) => m.direction === "out")).toHaveLength(2);
    expect(withinHours(new Date("2026-11-24T06:00:00Z"), "Asia/Kolkata", "10:00", "19:00", [1, 2, 3, 4, 5, 6])).toBe(true); // Tue 11:30 IST
    expect(withinHours(new Date("2026-11-22T06:00:00Z"), "Asia/Kolkata", "10:00", "19:00", [1, 2, 3, 4, 5, 6])).toBe(false); // Sunday

    const qr = await call("POST", "/api/whatsapp/quick-replies", { shortcut: "/Fees", text: "Our fee is ₹25,000 for Canada." });
    expect(qr.json().item.shortcut).toBe("fees");
    expect((await call("POST", "/api/whatsapp/quick-replies", { shortcut: "fees", text: "x" })).statusCode).toBe(409);
    expect((await call("GET", "/api/whatsapp/quick-replies")).json().items).toHaveLength(1);
    expect((await call("DELETE", `/api/whatsapp/quick-replies/${qr.json().item.id}`)).statusCode).toBe(200);
  });

  it("reads and updates the business profile", async () => {
    const p = (await call("GET", "/api/whatsapp/business-profile")).json().profile;
    expect(p).toMatchObject({ about: "Study visa experts", websites: ["https://visa.example.in"], vertical: "EDU" });
    await call("PATCH", "/api/whatsapp/business-profile", { about: "Study visa experts in Delhi" });
    expect(sent.at(-1)).toMatchObject({ url: "profile", body: { messaging_product: "whatsapp", about: "Study visa experts in Delhi" } });
  });
});

// ---- Voice notes recorded in the browser ----

/** A tiny WebM file shaped like Chrome's MediaRecorder output (unknown-size Segment and Cluster). */
function webm(packets: Buffer[], channels = 1) {
  const el = (id: number[], body: Buffer) => {
    const size = body.length;
    const sizeBytes = size < 127 ? [0x80 | size] : [0x40 | (size >> 8), size & 0xff];
    return Buffer.concat([Buffer.from(id), Buffer.from(sizeBytes), body]);
  };
  const unknown = (id: number[]) => Buffer.from([...id, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "ascii");
  head[8] = 1;
  head[9] = channels;
  head.writeUInt16LE(312, 10);
  head.writeUInt32LE(48000, 12);
  const trackEntry = el([0xae], Buffer.concat([el([0xd7], Buffer.from([1])), el([0x86], Buffer.from("A_OPUS")), el([0x63, 0xa2], head), el([0xe1], el([0x9f], Buffer.from([channels])))]));
  const blocks = packets.map((p, i) => el([0xa3], Buffer.concat([Buffer.from([0x81, 0x00, i * 20, 0x80]), p])));
  return Buffer.concat([
    el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from("webm"))),
    unknown([0x18, 0x53, 0x80, 0x67]),
    el([0x16, 0x54, 0xae, 0x6b], trackEntry),
    unknown([0x1f, 0x43, 0xb6, 0x75]),
    el([0xe7], Buffer.from([0])),
    ...blocks,
  ]);
}

/** Every Ogg page with a valid CRC. */
function oggPages(ogg: Buffer) {
  const table = new Uint32Array(256).map((_, i) => {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    return r >>> 0;
  });
  const pages: { flags: number; granule: bigint; crcOk: boolean }[] = [];
  let pos = 0;
  while (pos < ogg.length) {
    expect(ogg.subarray(pos, pos + 4).toString()).toBe("OggS");
    const nSeg = ogg[pos + 26]!;
    const len = 27 + nSeg + [...ogg.subarray(pos + 27, pos + 27 + nSeg)].reduce((a, b) => a + b, 0);
    const page = Buffer.from(ogg.subarray(pos, pos + len));
    const crc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    let c = 0;
    for (const b of page) c = ((c << 8) ^ table[((c >>> 24) ^ b) & 0xff]!) >>> 0;
    pages.push({ flags: page[5]!, granule: page.readBigInt64LE(6), crcOk: c === crc });
    pos += len;
  }
  return pages;
}

describe("voice notes", () => {
  const packet = () => Buffer.from([0xf8, 0xff, 0xfe, 0x01, 0x02]); // CELT 20 ms, one frame

  it("turns a browser recording (WebM) into a WhatsApp voice note (Ogg Opus)", () => {
    expect(opusPacketSamples(packet())).toBe(960);
    const out = webmOpusToOgg(webm(Array.from({ length: 50 }, packet)))!;
    expect(out.channels).toBe(1);
    expect(Math.round(out.durationMs)).toBe(Math.round((50 * 960 - 312) / 48));
    expect(oggOpusChannels(out.data)).toBe(1);
    const pages = oggPages(out.data);
    expect(pages.every((p) => p.crcOk)).toBe(true);
    expect(pages[0]!.flags).toBe(0x02); // first page
    expect(pages.at(-1)!.flags).toBe(0x04); // last page
    expect(pages.at(-1)!.granule).toBe(50n * 960n);
    expect(webmOpusToOgg(Buffer.from("not a webm"))).toBeNull();
  });

  it("sends it as a voice message", async () => {
    const chat = await one();
    const res = await call("POST", `/api/whatsapp/chats/${chat.id}/voice`, { mime: "audio/webm;codecs=opus", data: webm([packet(), packet()]).toString("base64") });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatchObject({ type: "audio", status: "sent", mediaMime: "audio/ogg", payload: { voice: true } });
    expect(lastSent()).toMatchObject({ type: "audio", audio: { id: "MEDIA_UP_1", voice: true } });
    // Played tick.
    await webhook({ statuses: [{ id: res.json().message.wamid, status: "played", timestamp: ts(new Date()), recipient_id: PERSON }] });
    expect((await messages(chat.id)).at(-1)!.status).toBe("played");
  });
});
