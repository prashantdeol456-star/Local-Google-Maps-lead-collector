import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { looksLikeLead } from "../src/services/engagement/engagementService.js";
import { createTestApp } from "./helpers.js";

// Social Engagement: comments, reactions and shares on connected Facebook Pages and Instagram
// accounts, per customer. Fake Graph API answers by path.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const calls: { path: string; method: string; body?: string }[] = [];

let reactions: { id: string; name: string; type: string }[] = [];
let fbComments: unknown[] = [];
let postCounts = { comments: 3, reactions: 2 };

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
  calls.push({ path, method: init?.method ?? "GET", body: init?.body ? String(init.body) : undefined });
  if (path === "oauth/access_token") return json({ access_token: "USER_TOKEN" });
  if (path === "me/permissions") return json({ data: [{ permission: "pages_read_user_content", status: "granted" }] });
  if (path === "me/accounts")
    return json({ data: [{ id: "111", name: "Acme Lucknow", access_token: "PAGE_TOKEN", instagram_business_account: { id: "ig-222", username: "acme.lko", name: "Acme" } }] });
  if (path === "111/posts")
    return json({
      data: [
        {
          id: "111_1",
          message: "New batch for IELTS starts Monday",
          permalink_url: "https://facebook.com/111/posts/1",
          created_time: "2026-11-20T10:00:00+0000",
          shares: { count: 1 },
          comments: { summary: { total_count: postCounts.comments } },
          reactions: { summary: { total_count: postCounts.reactions } },
        },
      ],
    });
  if (path === "111_1/comments") return json({ data: fbComments });
  if (path === "111_1/reactions") return json({ data: reactions });
  if (path === "111_1/sharedposts") return json({ data: [{ id: "999_5", created_time: "2026-11-21T08:00:00+0000", from: { id: "u3", name: "Neha Singh" } }] });
  if (path === "111/subscribed_apps") return json({ success: true });
  if (path === "ig-222/media")
    return json({ data: [{ id: "m1", caption: "Visa success!", permalink: "https://instagram.com/p/m1", media_type: "IMAGE", media_url: "https://cdn/m1.jpg", timestamp: "2026-11-22T09:00:00+0000", like_count: 40, comments_count: 1 }] });
  if (path === "m1/comments") return json({ data: [{ id: "igc1", text: "Fees kitni hai?", timestamp: "2026-11-22T10:00:00+0000", username: "ravi.k", from: { id: "igu1", username: "ravi.k" } }] });
  if (path === "c1/comments" && init?.method === "POST") return json({ id: "c1_reply" });
  return json({ error: { message: `unexpected ${path}` } }, 500);
}) as typeof fetch;

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

/** Connects the fake Page + Instagram account for this user (Facebook login round trip). */
async function connect(session: Record<string, string>) {
  const start = await t.app.inject({ method: "POST", url: "/api/social/connect/meta", headers: session });
  const state = new URL(start.json().url).searchParams.get("state")!;
  await t.app.inject({ method: "GET", url: `/api/oauth/callback/meta?code=OK&state=${state}` });
  const items = (await t.app.inject({ method: "GET", url: "/api/engagement/accounts", headers: session })).json().items as { id: string; platform: string }[];
  return { page: items.find((a) => a.platform === "facebook")!.id, ig: items.find((a) => a.platform === "instagram")!.id };
}

const sign = (body: string) => `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;

beforeAll(async () => {
  t = await createTestApp(
    {
      loginRateLimitPerMinute: 1000,
      publicBaseUrl: "https://leads.example.com",
      social: { meta: { appId: "1234", appSecret: "app-secret", graphVersion: "v26.0", scopes: ["pages_show_list"] }, linkedin: null, redirectBaseUrl: "http://localhost:3000" },
    },
    { socialFetch: fakeFetch },
  );
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  superAuth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  calls.length = 0;
  postCounts = { comments: 3, reactions: 2 };
  reactions = [
    { id: "u1", name: "Amit Kumar", type: "LIKE" },
    { id: "u2", name: "Pooja Verma", type: "LOVE" },
  ];
  fbComments = [
    { id: "c1", message: "What is the price for the full course?", created_time: "2026-11-20T11:00:00+0000", from: { id: "u1", name: "Amit Kumar" } },
    { id: "c2", message: "Great!", created_time: "2026-11-20T12:00:00+0000", from: { id: "u2", name: "Pooja Verma" } },
    { id: "c3", message: "Thanks Pooja", created_time: "2026-11-20T13:00:00+0000", parent: { id: "c2" }, from: { id: "111", name: "Acme Lucknow" } },
  ];
});

describe("lead signal", () => {
  it("spots buying questions in English and Hinglish", () => {
    expect(looksLikeLead("What is the price?")).toBe(true);
    expect(looksLikeLead("fees kitni hai")).toBe(true);
    expect(looksLikeLead("please DM details")).toBe(true);
    expect(looksLikeLead("Congratulations 🎉")).toBe(false);
  });
});

describe("social engagement", () => {
  it("saves who commented, reacted and shared, per customer, and replies to comments", async () => {
    const a = await customer("eng_a");
    const b = await customer("eng_b");
    const accA = await connect(a.session);
    const get = (url: string, s = a.session) => t.app.inject({ method: "GET", url, headers: s }).then((r) => r.json());

    // Nothing for anybody before a sync.
    expect((await get("/api/engagement/summary")).people).toBe(0);

    const sync = await t.app.inject({ method: "POST", url: `/api/engagement/accounts/${accA.page}/sync`, headers: a.session });
    expect(sync.statusCode, sync.body).toBe(200);
    // 2 comments (the Page's own reply is not a person), 2 reactions, 1 public share
    expect(sync.json()).toEqual({ posts: 1, added: 5 });
    expect(calls.some((c) => c.path === "111/subscribed_apps" && c.method === "POST")).toBe(true);
    await t.app.inject({ method: "POST", url: `/api/engagement/accounts/${accA.ig}/sync`, headers: a.session });

    const summary = await get("/api/engagement/summary");
    expect(summary).toMatchObject({ people: 4, comments: 3, reactions: 2, shares: 1, leads: 2, unreplied: 2 });

    const people = (await get("/api/engagement/people?sort=active")).items as { name: string; platform: string; comments: number; reactions: number; shares: number; leadSignal: boolean; externalId: string }[];
    const amit = people.find((p) => p.name === "Amit Kumar")!;
    expect(amit).toMatchObject({ platform: "facebook", externalId: "u1", comments: 1, reactions: 1, leadSignal: true });
    expect(people.find((p) => p.name === "Neha Singh")).toMatchObject({ shares: 1 });
    expect(people.find((p) => p.name === "ravi.k")).toMatchObject({ platform: "instagram", leadSignal: true });

    // The Page's own reply marks Pooja's comment as answered.
    const activity = (await get("/api/engagement/activity?kind=comment")).items as { id: string; text: string; repliedAt: string | null; person: { name: string }; post: { message: string } }[];
    expect(activity.find((e) => e.text === "Great!")!.repliedAt).not.toBeNull();
    const amitComment = activity.find((e) => e.person.name === "Amit Kumar")!;
    expect(amitComment.repliedAt).toBeNull();
    expect(amitComment.post.message).toContain("IELTS");

    // Reply from the admin panel
    const reply = await t.app.inject({ method: "POST", url: `/api/engagement/comments/${amitComment.id}/reply`, headers: a.session, payload: { text: "Sent you the details in Messenger" } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(calls.find((c) => c.path === "c1/comments" && c.method === "POST")?.body).toContain("Sent you the details");
    expect((await get("/api/engagement/summary")).unreplied).toBe(1);

    // Customer B sees none of it, and cannot open A's rows.
    expect((await get("/api/engagement/summary", b.session)).people).toBe(0);
    expect((await t.app.inject({ method: "POST", url: `/api/engagement/comments/${amitComment.id}/reply`, headers: b.session, payload: { text: "x" } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "POST", url: `/api/engagement/accounts/${accA.page}/sync`, headers: b.session })).statusCode).toBe(404);

    // Instagram people go to Contacts.
    const ravi = (await get("/api/engagement/people?platform=instagram")).items[0] as { id: string };
    const added = await t.app.inject({ method: "POST", url: `/api/engagement/people/${ravi.id}/contact`, headers: a.session });
    expect(added.json().person).toMatchObject({ status: "lead" });
    expect(await t.db.outreachContact.findFirst({ where: { ownerId: a.id, instagramUrl: "https://www.instagram.com/ravi.k/" } })).not.toBeNull();

    // CSV export
    const csv = await t.app.inject({ method: "GET", url: "/api/engagement/people/export.csv", headers: a.session });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("Amit Kumar");
    expect(csv.body.split("\r\n").filter(Boolean)).toHaveLength(5);
  });

  it("takes taken-back reactions away and reads a post again on a signed webhook", async () => {
    const c = await customer("eng_c");
    const acc = await connect(c.session);
    await t.app.inject({ method: "POST", url: `/api/engagement/accounts/${acc.page}/sync`, headers: c.session });

    // Webhooks: verification and signature
    const setup = (await t.app.inject({ method: "GET", url: "/api/engagement/setup", headers: superAuth })).json();
    expect(setup.callbackUrl).toBe("https://leads.example.com/api/webhooks/meta/social");
    expect((await t.app.inject({ method: "GET", url: "/api/engagement/setup", headers: c.session })).statusCode).toBe(403);
    const verify = await t.app.inject({ method: "GET", url: `/api/webhooks/meta/social?hub.mode=subscribe&hub.verify_token=${setup.verifyToken}&hub.challenge=42` });
    expect(verify.body).toBe("42");
    expect((await t.app.inject({ method: "GET", url: "/api/webhooks/meta/social?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42" })).statusCode).toBe(403);

    // A new comment arrives; Pooja takes her reaction back.
    fbComments.push({ id: "c4", message: "Is there a weekend batch available?", created_time: "2026-11-23T09:00:00+0000", from: { id: "u5", name: "Karan Mehta" } });
    reactions = reactions.slice(0, 1);
    const body = JSON.stringify({ object: "page", entry: [{ id: "111", changes: [{ field: "feed", value: { item: "comment", verb: "add", post_id: "111_1", comment_id: "c4", from: { id: "u5" } } }] }] });
    const bad = await t.app.inject({ method: "POST", url: "/api/webhooks/meta/social", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" }, payload: body });
    expect(bad.statusCode).toBe(401);
    const ok = await t.app.inject({ method: "POST", url: "/api/webhooks/meta/social", headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) }, payload: body });
    expect(ok.statusCode).toBe(200);
    await t.app.engagement.flushPending();

    const get = (url: string) => t.app.inject({ method: "GET", url, headers: c.session }).then((r) => r.json());
    const people = (await get("/api/engagement/people")).items as { name: string; reactions: number; leadSignal: boolean }[];
    expect(people.find((p) => p.name === "Karan Mehta")).toMatchObject({ leadSignal: true });
    expect(people.find((p) => p.name === "Pooja Verma")).toMatchObject({ reactions: 0 });

    // A removed comment (webhook) leaves the list.
    const removal = JSON.stringify({ object: "page", entry: [{ id: "111", changes: [{ field: "feed", value: { item: "comment", verb: "remove", post_id: "111_1", comment_id: "c4" } }] }] });
    await t.app.inject({ method: "POST", url: "/api/webhooks/meta/social", headers: { "content-type": "application/json", "x-hub-signature-256": sign(removal) }, payload: removal });
    const karan = ((await get("/api/engagement/people")).items as { name: string; comments: number }[]).find((p) => p.name === "Karan Mehta")!;
    expect(karan.comments).toBe(0);

    // Unchanged counts: the next sync does not read the post again.
    calls.length = 0;
    postCounts = { comments: 3, reactions: 2 };
    await t.db.socialPost.updateMany({ data: { commentCount: 3, reactionCount: 2 } });
    await t.app.inject({ method: "POST", url: `/api/engagement/accounts/${acc.page}/sync`, headers: c.session });
    expect(calls.some((x) => x.path === "111_1/comments")).toBe(false);
  });
});
