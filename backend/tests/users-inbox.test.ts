import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// Phase C2: each user's AI inbox (chats, AI keys, Telegram bot) and social accounts.

let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };

async function cookieFor(login: string, password: string) {
  const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: login, password } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === "mlc_session")!;
  return { cookie: `${cookie.name}=${cookie.value}` };
}

async function customer(name: string) {
  await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${name}@shop.in`, phone: "9876543210", username: name, password: `${name}-password-1` } });
  const id = ((await t.app.inject({ method: "GET", url: `/api/users?q=${name}`, headers: superAuth })).json().items[0] as { id: string }).id;
  await t.app.inject({ method: "POST", url: `/api/users/${id}/approve`, headers: superAuth });
  return { id, session: await cookieFor(name, `${name}-password-1`) };
}

const get = (url: string, headers: Record<string, string>) => t.app.inject({ method: "GET", url, headers });

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  superAuth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("each user's own AI inbox", () => {
  it("keeps AI keys, chats and social accounts apart", async () => {
    const a = await customer("inbox_a");
    const b = await customer("inbox_b");

    // AI keys: a customer's key is theirs alone
    const save = await t.app.inject({ method: "PUT", url: "/api/inbox/secrets/anthropicKey", headers: a.session, payload: { value: "sk-ant-api03-CUSTOMER-A-KEY-1234" } });
    expect(save.statusCode, save.body).toBe(200);
    expect((await get("/api/inbox/ai-config", a.session)).json().keys.anthropicKey).toMatchObject({ set: true, source: "admin", hint: "…1234" });
    expect((await get("/api/inbox/ai-config", b.session)).json().keys.anthropicKey.set).toBe(false);
    expect((await get("/api/inbox/ai-config", a.session)).body).not.toContain("CUSTOMER-A-KEY");
    const rows = await t.db.aiAssistantSettings.findMany();
    expect(rows.map((r) => r.id)).toContain(a.id);

    // Chats
    const chat = (ownerId: string, thread: string) =>
      t.db.inboxConversation.create({ data: { ownerId, platform: "telegram", accountKey: "bot", externalThreadId: thread, participantName: thread, lastMessageAt: new Date() } });
    const aChat = await chat(a.id, "same-thread");
    await chat(b.id, "same-thread"); // the same chat id under another user's bot is a different chat
    const listA = (await get("/api/inbox/conversations", a.session)).json();
    expect(listA.items.map((c: { id: string }) => c.id)).toEqual([aChat.id]);
    expect((await get(`/api/inbox/conversations/${aChat.id}`, b.session)).statusCode).toBe(404);
    expect((await get(`/api/inbox/conversations/${aChat.id}`, a.session)).statusCode).toBe(200);

    // Social accounts
    await t.db.socialAccount.create({ data: { ownerId: a.id, platform: "facebook_page", externalId: "PAGE_X", name: "A's page", tokenEnc: "x" } });
    await t.db.socialAccount.create({ data: { ownerId: b.id, platform: "facebook_page", externalId: "PAGE_X", name: "B's page", tokenEnc: "x" } });
    expect((await get("/api/social/accounts", a.session)).json().items.map((s: { name: string }) => s.name)).toEqual(["A's page"]);

    // The LinkedIn inbox (extension) stays with super admins
    expect((await get("/api/inbox/linkedin/drafts", a.session)).statusCode).toBe(403);
    // Super admins see everyone's chats
    expect((await get("/api/inbox/conversations", superAuth)).json().total).toBeGreaterThanOrEqual(2);
  });
});
