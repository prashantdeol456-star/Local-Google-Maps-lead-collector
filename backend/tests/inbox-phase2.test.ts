import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SecretBox } from "../src/utils/secretBox.js";
import { createTestApp } from "./helpers.js";

// All messages phase 2: Telegram Business, photos/voice/files, Meta message webhooks, private replies.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sent: { url: string; body: Record<string, unknown> }[] = [];
let tgUpdates: unknown[] = [];
let conversationsRead = 0;

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.hostname === "api.telegram.org") {
    if (url.pathname.startsWith("/file/")) {
      return new Response(url.pathname.endsWith("photo.jpg") ? "JPEGDATA" : "<svg onload=alert(1)>", { headers: { "Content-Type": url.pathname.endsWith("photo.jpg") ? "image/jpeg" : "image/svg+xml" } });
    }
    const method = url.pathname.split("/").pop();
    if (method === "getMe") return json({ ok: true, result: { id: 1, is_bot: true, first_name: "Shop bot", username: "shop_bot" } });
    if (method === "getUpdates") return json({ ok: true, result: tgUpdates.filter((u) => (u as { update_id: number }).update_id >= (body.offset ?? 0)) });
    if (method === "getFile") return json({ ok: true, result: { file_path: body.file_id === "PHOTO_BIG" ? "photos/photo.jpg" : "documents/x.svg", file_size: 100 } });
    if (method === "sendMessage") {
      sent.push({ url: url.href, body });
      return json({ ok: true, result: { message_id: 900 + sent.length, date: Math.floor(Date.now() / 1000), chat: { id: body.chat_id, type: "private" } } });
    }
  }
  if (url.hostname === "graph.facebook.com") {
    if (url.pathname.endsWith("/conversations")) {
      conversationsRead++;
      return json({
        data: [
          {
            id: "t_1",
            updated_time: new Date().toISOString(),
            participants: { data: [{ id: "psid-9", name: "Neha Singh" }, { id: "111", name: "Acme" }] },
            messages: { data: [{ id: "mid.1", created_time: new Date().toISOString(), from: { id: "psid-9", name: "Neha Singh" }, attachments: { data: [{ mime_type: "image/jpeg", name: "x.jpg", image_data: { url: "https://scontent.xx.fbcdn.net/v/x.jpg" } }] } }] },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/messages") && init?.method === "POST") {
      sent.push({ url: url.href, body });
      return json({ recipient_id: "psid-9", message_id: `m_${sent.length}` });
    }
  }
  return json({ ok: false, description: `unexpected ${url.href}` }, 500);
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const ago = (sec: number) => Math.floor(Date.now() / 1000) - sec;
const get = (url: string) => t.app.inject({ method: "GET", url, headers: { cookie } });

beforeAll(async () => {
  t = await createTestApp(
    {
      inbox: { ai: null, geminiApiKey: null, telegramBotToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", pollSeconds: 60 },
      social: { meta: { appId: "1", appSecret: "app-secret", graphVersion: "v26.0", scopes: [] }, linkedin: null, redirectBaseUrl: "http://localhost:3000" },
    },
    { inboxFetch: fakeFetch, socialFetch: fakeFetch },
  );
  const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: t.credentials.email, password: t.credentials.password } });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  sent.length = 0;
  tgUpdates = [];
});

describe("Telegram Business and files", () => {
  it("reads chats of your own Telegram number, answers through the business connection, and shows files", async () => {
    tgUpdates = [
      { update_id: 1, business_connection: { id: "bc1", user: { id: 777, is_bot: false, first_name: "Prashant", username: "prashant" }, user_chat_id: 777, date: ago(500), is_enabled: true, rights: { can_reply: true } } },
      {
        update_id: 2,
        business_message: { business_connection_id: "bc1", message_id: 10, date: ago(120), chat: { id: 555, type: "private", first_name: "Rohan", username: "rohan_m" }, from: { id: 555, is_bot: false, first_name: "Rohan" }, caption: "Is this available?", photo: [{ file_id: "PHOTO_SMALL" }, { file_id: "PHOTO_BIG" }] },
      },
      { update_id: 3, business_message: { business_connection_id: "bc1", message_id: 11, date: ago(60), chat: { id: 555, type: "private", first_name: "Rohan" }, from: { id: 777, is_bot: false, first_name: "Prashant" }, text: "Yes, in stock" } },
      { update_id: 4, message: { message_id: 20, date: ago(30), chat: { id: 600, type: "private", first_name: "Asha" }, from: { id: 600, is_bot: false, first_name: "Asha" }, document: { file_id: "DOC", file_name: "logo.svg", mime_type: "image/svg+xml" } } },
    ];
    expect(await t.app.inboxWorker.telegramOnce(0)).toBe(2);

    const business = await t.db.inboxConversation.findFirstOrThrow({ where: { accountKey: "business:bc1" } });
    expect(business).toMatchObject({ platform: "telegram", externalThreadId: "b:bc1:555", participantId: "555", status: "replied" });
    const msgs = await t.db.inboxMessage.findMany({ where: { conversationId: business.id }, orderBy: { sentAt: "asc" } });
    expect(msgs.map((m) => `${m.direction}:${m.text}`)).toEqual(["in:Is this available?", "out:Yes, in stock"]);
    expect(JSON.parse(msgs[0]!.attachments!)).toEqual([{ type: "image", ref: "tg:PHOTO_BIG", name: null, mime: null }]);

    const status = (await get("/api/inbox/status")).json();
    expect(status.telegram.business).toMatchObject({ name: "Prashant", username: "prashant", enabled: true, canReply: true });

    const list = (await get("/api/messages/chats?platform=telegram")).json().items as { id: string; handle: string | null; replyUntil: string | null }[];
    const row = list.find((c) => c.id === business.id)!;
    expect(row.handle).toBe("your Telegram · @rohan_m");
    expect(new Date(row.replyUntil!).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

    // Your reply goes out as your own account.
    expect((await t.app.inject({ method: "POST", url: `/api/inbox/conversations/${business.id}/send`, headers: { cookie }, payload: { text: "Delivery tomorrow" } })).statusCode).toBe(200);
    expect(sent[0]!.body).toMatchObject({ chat_id: "555", text: "Delivery tomorrow", business_connection_id: "bc1" });

    // Files come through the platform (the bot token never reaches the browser).
    const photo = await get(`/api/inbox/media/${msgs[0]!.id}/0`);
    expect(photo.headers["content-type"]).toBe("image/jpeg");
    expect(photo.body).toBe("JPEGDATA");
    const docMsg = await t.db.inboxMessage.findFirstOrThrow({ where: { text: "[file]" } });
    const doc = await get(`/api/inbox/media/${docMsg.id}/0`);
    expect(doc.headers["content-type"]).toBe("application/octet-stream");
    expect(doc.headers["content-disposition"]).toBe("attachment");
    expect((await get(`/api/inbox/media/${docMsg.id}/3`)).statusCode).toBe(404);

    // After 24 hours without a message from them, no reply from here.
    await t.db.inboxConversation.update({ where: { id: business.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
    const late = await t.app.inject({ method: "POST", url: `/api/inbox/conversations/${business.id}/send`, headers: { cookie }, payload: { text: "Hello?" } });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.message).toMatch(/24 hours/);
  });
});

describe("Meta message webhooks and private replies", () => {
  it("reads a Page's chat right away when Meta sends a message webhook, with the photo", async () => {
    const box = new SecretBox("test-secret-test-secret-test-secret-123", "social-tokens");
    const admin = await t.db.adminUser.findFirstOrThrow();
    await t.db.socialAccount.create({ data: { ownerId: admin.id, platform: "facebook_page", externalId: "111", name: "Acme", tokenEnc: box.seal("PAGE_TOKEN") } });
    const before = conversationsRead;
    const body = JSON.stringify({ object: "page", entry: [{ id: "111", time: Date.now(), messaging: [{ sender: { id: "psid-9" }, recipient: { id: "111" }, message: { mid: "mid.1", text: "" } }] }] });
    const res = await t.app.inject({ method: "POST", url: "/api/webhooks/meta/social", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}` }, payload: body });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 2600));
    expect(conversationsRead).toBeGreaterThan(before);
    const chat = await t.db.inboxConversation.findFirstOrThrow({ where: { externalThreadId: "t_1" } });
    const msg = await t.db.inboxMessage.findFirstOrThrow({ where: { conversationId: chat.id } });
    expect(JSON.parse(msg.attachments!)).toEqual([{ type: "image", url: "https://scontent.xx.fbcdn.net/v/x.jpg", name: "x.jpg", mime: "image/jpeg" }]);
    expect(msg.text).toBe("[attachment]");
  });

  it("sends one private message to the person who wrote a comment, within 7 days", async () => {
    const account = await t.db.socialAccount.findFirstOrThrow({ where: { externalId: "111" } });
    const person = await t.db.socialPerson.create({ data: { platform: "facebook", externalId: "u1", name: "Amit" } });
    const post = await t.db.socialPost.create({ data: { accountId: account.id, platform: "facebook", externalId: "111_1", postedAt: new Date() } });
    const comment = await t.db.socialEngagement.create({ data: { accountId: account.id, postId: post.id, personId: person.id, platform: "facebook", kind: "comment", externalId: "c1", text: "Price?", occurredAt: new Date() } });
    const send = (text: string, id = comment.id) => t.app.inject({ method: "POST", url: `/api/engagement/comments/${id}/private-reply`, headers: { cookie }, payload: { text } });

    const ok = await send("Hi Amit, sharing the price list here.");
    expect(ok.statusCode, ok.body).toBe(200);
    expect(sent.at(-1)!.url).toContain("/111/messages");
    expect(sent.at(-1)!.body).toEqual({ recipient: { comment_id: "c1" }, message: { text: "Hi Amit, sharing the price list here." } });
    expect((await send("Again")).statusCode).toBe(409);

    const old = await t.db.socialEngagement.create({ data: { accountId: account.id, postId: post.id, personId: person.id, platform: "facebook", kind: "comment", externalId: "c2", text: "Old", occurredAt: new Date(Date.now() - 8 * 24 * 3600_000) } });
    expect((await send("Late", old.id)).json().error.message).toMatch(/7 days/);
  });
});
