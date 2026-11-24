import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// All messages: WhatsApp Chat and AI Inbox chats in one list, per user, with unread counts.

let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };

async function cookieFor(login: string, password: string) {
  const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: login, password } });
  const cookie = res.cookies.find((c) => c.name === "mlc_session")!;
  return { cookie: `${cookie.name}=${cookie.value}` };
}

async function customer(name: string) {
  await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${name}@shop.in`, phone: "9876543210", username: name, password: `${name}-password-1` } });
  const id = ((await t.app.inject({ method: "GET", url: `/api/users?q=${name}`, headers: superAuth })).json().items[0] as { id: string }).id;
  await t.app.inject({ method: "POST", url: `/api/users/${id}/approve`, headers: superAuth });
  return { id, session: await cookieFor(name, `${name}-password-1`) };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  superAuth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("all messages", () => {
  it("lists every app's chats newest first, with unread counts and reply windows, per user", async () => {
    const a = await customer("msg_a");
    const b = await customer("msg_b");
    await t.db.waChat.create({ data: { ownerId: a.id, phone: "919800000001", profileName: "Riya", lastInboundAt: ago(30), lastMessageAt: ago(30), lastMessageText: "Hi, fees?", unreadCount: 2 } });
    await t.db.waChat.create({ data: { ownerId: b.id, phone: "919800000002", profileName: "B's customer", lastMessageAt: ago(1), unreadCount: 1 } });
    const ig = await t.db.inboxConversation.create({
      data: { ownerId: a.id, platform: "instagram", accountKey: "acc", externalThreadId: "t1", participantName: "Karan", participantUsername: "karan.m", lastInboundAt: ago(5), lastMessageAt: ago(5), unreadCount: 1, status: "needs_reply" },
    });
    await t.db.inboxMessage.create({ data: { ownerId: a.id, conversationId: ig.id, direction: "in", text: "Weekend batch?", author: "customer", sentAt: ago(5) } });
    await t.db.inboxConversation.create({
      data: { ownerId: a.id, platform: "facebook", accountKey: "acc", externalThreadId: "t2", participantName: "Old chat", lastInboundAt: ago(3 * 24 * 60), lastMessageAt: ago(3 * 24 * 60), status: "replied" },
    });
    await t.db.inboxConversation.create({ data: { ownerId: a.id, platform: "telegram", accountKey: "bot", externalThreadId: "t3", participantName: "Tele", lastMessageAt: ago(60), status: "replied" } });

    const get = (url: string, s = a.session) => t.app.inject({ method: "GET", url, headers: s }).then((r) => r.json());
    const list = await get("/api/messages/chats");
    expect(list.items.map((c: { name: string; platform: string }) => `${c.platform}:${c.name}`)).toEqual(["instagram:Karan", "whatsapp:Riya", "telegram:Tele", "facebook:Old chat"]);
    const [karan, riya, tele, old] = list.items;
    expect(karan).toMatchObject({ source: "inbox", handle: "@karan.m", lastMessageText: "Weekend batch?", unreadCount: 1, needsReply: true });
    expect(new Date(karan.replyUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(riya).toMatchObject({ source: "whatsapp", handle: "+919800000001", unreadCount: 2 });
    expect(tele.replyUntil).toBe("always");
    expect(old.replyUntil).toBeNull();
    expect(list.counts).toEqual({ whatsapp: { chats: 1, unread: 2 }, instagram: { chats: 1, unread: 1 }, facebook: { chats: 1, unread: 0 }, telegram: { chats: 1, unread: 0 } });

    expect((await get("/api/messages/chats?filter=unread")).items).toHaveLength(2);
    expect((await get("/api/messages/chats?platform=whatsapp")).items).toHaveLength(1);
    expect((await get("/api/messages/chats?q=kar")).items.map((c: { name: string }) => c.name)).toEqual(["Karan"]);
    expect(await get("/api/messages/summary")).toMatchObject({ unread: 3, latest: { name: "Karan", platform: "instagram" } });

    // B sees only their own chat.
    expect((await get("/api/messages/chats", b.session)).items.map((c: { name: string }) => c.name)).toEqual(["B's customer"]);

    // Opening the Instagram chat clears its unread count.
    expect((await t.app.inject({ method: "POST", url: `/api/inbox/conversations/${ig.id}/read`, headers: a.session })).statusCode).toBe(200);
    expect((await get("/api/messages/summary")).unread).toBe(2);

    // A switched-off service leaves its chats out.
    await t.app.inject({ method: "PUT", url: `/api/users/${a.id}/services`, headers: superAuth, payload: { services: ["ai_inbox"] } });
    const after = await get("/api/messages/chats");
    expect(after.items.some((c: { platform: string }) => c.platform === "whatsapp")).toBe(false);
    expect(after.items).toHaveLength(3);
  });

  it("counts new messages from the person as unread until you answer", async () => {
    const sync = (messages: { key: string; fromMe: boolean; text: string }[]) =>
      t.app.inject({ method: "POST", url: "/api/inbox/linkedin/sync", headers: superAuth, payload: { threads: [{ threadId: "li-1", participantName: "Neha", profileUrl: "https://www.linkedin.com/in/neha", messages }] } });
    expect((await sync([{ key: "m1", fromMe: false, text: "Hello" }, { key: "m2", fromMe: false, text: "Are you there?" }])).statusCode).toBe(200);
    const row = await t.db.inboxConversation.findFirstOrThrow({ where: { externalThreadId: "li-1" } });
    expect(row.unreadCount).toBe(2);
    await sync([{ key: "m1", fromMe: false, text: "Hello" }, { key: "m2", fromMe: false, text: "Are you there?" }, { key: "m3", fromMe: true, text: "Yes!" }]);
    expect((await t.db.inboxConversation.findFirstOrThrow({ where: { externalThreadId: "li-1" } })).unreadCount).toBe(0);
  });
});
