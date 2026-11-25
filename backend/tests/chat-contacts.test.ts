import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// All messages phase 3: one person across apps (chats linked to a Contacts record), labels and notes.

let t: Awaited<ReturnType<typeof createTestApp>>;
let superAuth: { authorization: string };

async function customer(name: string) {
  await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `${name}@shop.in`, phone: "9876543210", username: name, password: `${name}-password-1` } });
  const id = ((await t.app.inject({ method: "GET", url: `/api/users?q=${name}`, headers: superAuth })).json().items[0] as { id: string }).id;
  await t.app.inject({ method: "POST", url: `/api/users/${id}/approve`, headers: superAuth });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: name, password: `${name}-password-1` } });
  const c = res.cookies.find((x) => x.name === "mlc_session")!;
  return { id, session: { cookie: `${c.name}=${c.value}` } };
}

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 });
  superAuth = { authorization: `Bearer ${(await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } })).json().token}` };
});
afterAll(async () => {
  await t.close();
});

describe("one person across apps", () => {
  it("links WhatsApp and Instagram chats to the same contact by phone and username, and keeps users apart", async () => {
    const a = await customer("cc_a");
    const b = await customer("cc_b");
    const req = (method: "GET" | "POST" | "DELETE" | "PATCH", url: string, payload?: unknown, s = a.session) =>
      t.app.inject({ method, url, headers: s, ...(payload !== undefined ? { payload: payload as object } : {}) });

    const karan = await t.db.outreachContact.create({ data: { ownerId: a.id, name: "Karan Mehta", phone: "+91 98000 00001", instagramUrl: "https://www.instagram.com/karan.m/", listName: "Leads" } });
    const wa = await t.db.waChat.create({ data: { ownerId: a.id, phone: "919800000001", profileName: "Karan", lastMessageAt: new Date(Date.now() - 60_000), labels: JSON.stringify(["Hot"]) } });
    const ig = await t.db.inboxConversation.create({ data: { ownerId: a.id, platform: "instagram", accountKey: "acc", externalThreadId: "t1", participantName: "Karan M", participantUsername: "karan.m", lastMessageAt: new Date() } });
    const tg = await t.db.inboxConversation.create({ data: { ownerId: a.id, platform: "telegram", accountKey: "bot", externalThreadId: "t2", participantName: "Rohit Sharma", lastMessageAt: new Date() } });
    await t.db.outreachContact.create({ data: { ownerId: a.id, name: "Rohit Sharma", listName: "Leads" } });

    // Opening the WhatsApp chat links it (same phone); its Instagram chat follows (same username).
    const waContact = (await req("GET", `/api/messages/chats/whatsapp/${wa.id}/contact`)).json();
    expect(waContact).toMatchObject({ contact: { id: karan.id, name: "Karan Mehta" }, chats: [] });
    const igContact = (await req("GET", `/api/messages/chats/inbox/${ig.id}/contact`)).json();
    expect(igContact.contact.id).toBe(karan.id);
    expect(igContact.chats).toEqual([expect.objectContaining({ source: "whatsapp", id: wa.id, platform: "whatsapp" })]);
    expect((await req("GET", `/api/messages/chats?contactId=${karan.id}`)).json().items.map((c: { id: string }) => c.id).sort()).toEqual([wa.id, ig.id].sort());

    // Telegram gives no phone: a same-named contact is only suggested; or create one from the chat.
    const tgContact = (await req("GET", `/api/messages/chats/inbox/${tg.id}/contact`)).json();
    expect(tgContact.contact).toBeNull();
    expect(tgContact.suggestions.map((c: { name: string }) => c.name)).toEqual(["Rohit Sharma"]);
    const created = (await req("POST", `/api/messages/chats/inbox/${tg.id}/contact`, { create: { name: "Rohit S.", phone: "+91 98111 00002", email: "Rohit@Shop.in" } })).json();
    expect(created.contact).toMatchObject({ name: "Rohit S.", phone: "+91 98111 00002", email: "rohit@shop.in" });
    expect(await t.db.outreachContact.findFirst({ where: { id: created.contact.id, ownerId: a.id, listName: "Chats" } })).not.toBeNull();
    expect((await req("DELETE", `/api/messages/chats/inbox/${tg.id}/contact`)).json().contact).toBeNull();
    expect((await req("POST", `/api/messages/chats/inbox/${tg.id}/contact`, { contactId: karan.id })).json().chats).toHaveLength(2);

    // Labels and notes on an AI Inbox chat; one label list for every app.
    expect((await req("PATCH", `/api/messages/chats/inbox/${ig.id}`, { labels: ["Hot", " Follow up ", "Hot"], notes: "Asked for fees" })).json()).toEqual({ labels: ["Hot", "Follow up"], notes: "Asked for fees" });
    expect((await req("GET", "/api/messages/labels")).json().items).toEqual(["Follow up", "Hot"]);
    expect((await req("GET", "/api/messages/chats?label=Hot")).json().items.map((c: { id: string }) => c.id).sort()).toEqual([wa.id, ig.id].sort());
    expect((await req("GET", "/api/messages/contacts?q=kar")).json().items.map((c: { name: string }) => c.name)).toEqual(["Karan Mehta"]);

    // Another user cannot see or link A's chats.
    expect((await req("GET", `/api/messages/chats/inbox/${ig.id}/contact`, undefined, b.session)).statusCode).toBe(404);
    expect((await req("POST", `/api/messages/chats/whatsapp/${wa.id}/contact`, { contactId: karan.id }, b.session)).statusCode).toBe(404);
    expect((await req("GET", "/api/messages/contacts?q=kar", undefined, b.session)).json().items).toEqual([]);
  });
});
