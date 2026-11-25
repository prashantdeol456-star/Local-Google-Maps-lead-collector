import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// YouTube in Social Engagement: Google login for the channel, videos, comments with who wrote
// them, public subscribers, the channel's own replies, and replying from the panel.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const calls: { path: string; params: URLSearchParams; body?: string; auth?: string | null }[] = [];
let refreshes = 0;

const CH = "UC_CHANNEL";
const fake = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const auth = new Headers(init?.headers).get("authorization");
  calls.push({ path: url.pathname, params: url.searchParams, body: init?.body ? String(init.body) : undefined, auth });
  if (url.href === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(String(init?.body));
    if (form.get("grant_type") === "refresh_token") {
      refreshes++;
      return json({ access_token: `ACCESS_${refreshes}`, expires_in: 3600 });
    }
    return json({ access_token: "ACCESS_0", refresh_token: "REFRESH_TOKEN", expires_in: 3600, scope: "https://www.googleapis.com/auth/youtube.force-ssl" });
  }
  if (url.hostname === "www.googleapis.com") {
    const p = url.pathname.replace("/youtube/v3/", "");
    if (p === "channels" && url.searchParams.get("mine")) return json({ items: [{ id: CH, snippet: { title: "Pathway Overseas", customUrl: "@pathway", thumbnails: { default: { url: "https://yt3.ggpht.com/a.jpg" } } } }] });
    if (p === "channels") return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_UPLOADS" } } }] });
    if (p === "playlistItems") return json({ items: [{ contentDetails: { videoId: "vid1" } }] });
    if (p === "videos") return json({ items: [{ id: "vid1", snippet: { title: "Canada study visa 2027", publishedAt: "2026-11-20T10:00:00Z" }, statistics: { likeCount: "120", commentCount: "3" } }] });
    if (p === "commentThreads") {
      expect(url.searchParams.get("allThreadsRelatedToChannelId")).toBe(CH);
      return json({
        items: [
          {
            id: "th1",
            snippet: {
              videoId: "vid1",
              topLevelComment: { id: "c1", snippet: { authorDisplayName: "@ravi.k", authorChannelId: { value: "UC_RAVI" }, authorChannelUrl: "http://www.youtube.com/@ravi.k", textOriginal: "What are the fees?", publishedAt: "2026-11-21T09:00:00Z" } },
            },
            replies: { comments: [{ id: "c1.r1", snippet: { authorDisplayName: "Pathway Overseas", authorChannelId: { value: CH }, textOriginal: "Check your inbox", publishedAt: "2026-11-21T10:00:00Z" } }] },
          },
          { id: "th2", snippet: { videoId: "vid1", topLevelComment: { id: "c2", snippet: { authorDisplayName: "Meena Rao", authorChannelId: { value: "UC_MEENA" }, textOriginal: "Very helpful", publishedAt: "2026-11-22T09:00:00Z" } } } },
        ],
      });
    }
    if (p === "subscriptions") return json({ items: [{ snippet: { publishedAt: "2026-11-23T08:00:00Z" }, subscriberSnippet: { channelId: "UC_MEENA", title: "Meena Rao" } }] });
    if (p === "comments" && init?.method === "POST") return json({ id: "reply-1" });
  }
  return json({ error: { message: `unexpected ${url.href}` } }, 500);
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;

beforeAll(async () => {
  t = await createTestApp(
    { social: { meta: null, linkedin: null, google: { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "g-secret", scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"] }, redirectBaseUrl: "http://localhost:3000" } },
    { socialFetch: fake },
  );
  const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: t.credentials.email, password: t.credentials.password } });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await t.close();
});

describe("YouTube engagement", () => {
  it("connects a channel with Google, reads comments and subscribers, and replies", async () => {
    const start = await t.app.inject({ method: "POST", url: "/api/social/connect/google", headers: { cookie } });
    const url = new URL(start.json().url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect([url.searchParams.get("access_type"), url.searchParams.get("prompt"), url.searchParams.get("scope")]).toEqual(["offline", "consent", "https://www.googleapis.com/auth/youtube.force-ssl"]);
    const back = await t.app.inject({ method: "GET", url: `/api/oauth/callback/google?code=OK&state=${url.searchParams.get("state")}` });
    expect(back.headers.location).toBe("/admin/social?connected=1&provider=google");
    const row = await t.db.socialAccount.findFirstOrThrow({ where: { platform: "youtube_channel" } });
    expect(row).toMatchObject({ externalId: CH, name: "Pathway Overseas", username: "@pathway" });
    expect(row.tokenEnc).not.toContain("REFRESH_TOKEN");

    const accounts = (await t.app.inject({ method: "GET", url: "/api/engagement/accounts", headers: { cookie } })).json().items;
    expect(accounts).toEqual([expect.objectContaining({ platform: "youtube", name: "Pathway Overseas" })]);

    const sync = await t.app.inject({ method: "POST", url: `/api/engagement/accounts/${row.id}/sync`, headers: { cookie } });
    expect(sync.statusCode, sync.body).toBe(200);
    expect(sync.json()).toEqual({ posts: 1, added: 3 }); // 2 comments + 1 subscriber (the channel's own reply is not a person)
    expect(calls.filter((c) => c.path.startsWith("/youtube/")).every((c) => c.auth === "Bearer ACCESS_0")).toBe(true);

    const get = (u: string) => t.app.inject({ method: "GET", url: u, headers: { cookie } }).then((r) => r.json());
    expect(await get("/api/engagement/summary")).toMatchObject({ people: 2, comments: 2, subscribers: 1, leads: 1, unreplied: 1 });
    const people = (await get("/api/engagement/people?platform=youtube")).items as { name: string; profileUrl: string; leadSignal: boolean; subscribedAt: string | null; comments: number }[];
    expect(people.find((p) => p.name === "ravi.k")).toMatchObject({ leadSignal: true, profileUrl: "http://www.youtube.com/@ravi.k", subscribedAt: null });
    expect(people.find((p) => p.name === "Meena Rao")).toMatchObject({ comments: 1, subscribedAt: "2026-11-23T08:00:00.000Z" });

    const posts = (await get("/api/engagement/posts?platform=youtube")).items as { message: string; reactionCount: number; permalink: string }[];
    expect(posts).toEqual([expect.objectContaining({ message: "Canada study visa 2027", reactionCount: 120, permalink: "https://www.youtube.com/watch?v=vid1" })]); // no "subscribers" pseudo post

    const activity = (await get("/api/engagement/activity?kind=comment")).items as { id: string; text: string; repliedAt: string | null }[];
    expect(activity.find((e) => e.text === "What are the fees?")!.repliedAt).not.toBeNull();
    const meena = activity.find((e) => e.text === "Very helpful")!;
    const reply = await t.app.inject({ method: "POST", url: `/api/engagement/comments/${meena.id}/reply`, headers: { cookie }, payload: { text: "Thank you!" } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(JSON.parse(calls.find((c) => c.path === "/youtube/v3/comments")!.body!)).toEqual({ snippet: { parentId: "c2", textOriginal: "Thank you!" } });
    expect((await t.app.inject({ method: "POST", url: `/api/engagement/comments/${meena.id}/private-reply`, headers: { cookie }, payload: { text: "Hi" } })).statusCode).toBe(400);

    // A new access token is made from the refresh token when "Check" runs.
    const check = await t.app.inject({ method: "POST", url: `/api/social/accounts/${row.id}/check`, headers: { cookie } });
    expect(check.json().account).toMatchObject({ status: "connected" });
    expect(refreshes).toBe(1);
  });
});
