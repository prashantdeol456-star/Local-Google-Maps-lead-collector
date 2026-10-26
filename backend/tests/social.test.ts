import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseSocialConfig } from "../src/providers/social/config.js";
import { createTestApp } from "./helpers.js";

// Fake Facebook Graph API and LinkedIn: answers by URL, records every request.
const calls: { url: URL; init?: RequestInit }[] = [];
let pagesResponse: unknown;
let linkedinUserStatus = 200;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  calls.push({ url, init });
  if (url.hostname === "graph.facebook.com") {
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    if (path === "oauth/access_token") {
      if (url.searchParams.get("code") === "bad") return json({ error: { message: "Invalid verification code format." } }, 400);
      return json({ access_token: url.searchParams.get("grant_type") === "fb_exchange_token" ? "LONG_USER" : "SHORT_USER", expires_in: 3600 });
    }
    if (path === "me/permissions") return json({ data: [{ permission: "pages_show_list", status: "granted" }, { permission: "instagram_basic", status: "granted" }, { permission: "pages_messaging", status: "declined" }] });
    if (path === "me/accounts") return json(pagesResponse);
    if (path === "111") return json({ id: "111", name: "Acme Lucknow (renamed)", picture: { data: { url: "https://cdn.example/p.png" } } });
    if (path === "999") return json({ error: { message: "Error validating access token: The session has been invalidated", code: 190 } }, 400);
  }
  if (url.href === "https://www.linkedin.com/oauth/v2/accessToken") return json({ access_token: "LI_TOKEN", expires_in: 5_184_000, scope: "openid,profile,email,w_member_social" });
  if (url.href === "https://api.linkedin.com/v2/userinfo") {
    return linkedinUserStatus === 200 ? json({ sub: "li-abc", name: "Prashant Deol", email: "me@example.com", picture: "https://media.example/me.jpg" }) : json({ message: "Invalid access token" }, 401);
  }
  return json({ error: { message: `unexpected ${url.href}` } }, 500);
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;

const call = (method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string> = { cookie }) => t.app.inject({ method, url, headers });

/** The error shown on the admin page after the redirect. */
const errorOf = (res: { headers: Record<string, unknown> }) => new URL(String(res.headers.location), "http://x").searchParams.get("error") ?? "";

async function connect(provider: "meta" | "linkedin") {
  const res = await call("POST", `/api/social/connect/${provider}`);
  expect(res.statusCode, res.body).toBe(200);
  return new URL(res.json().url);
}

beforeAll(async () => {
  t = await createTestApp(
    {
      social: {
        meta: { appId: "1234", appSecret: "app-secret", graphVersion: "v26.0", scopes: ["pages_show_list", "instagram_basic"] },
        linkedin: { clientId: "li-client", clientSecret: "li-secret", scopes: ["openid", "profile", "email", "w_member_social"] },
        redirectBaseUrl: "http://localhost:3000",
      },
    },
    { socialFetch: fakeFetch },
  );
  const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: t.credentials.email, password: t.credentials.password } });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  calls.length = 0;
  linkedinUserStatus = 200;
  pagesResponse = {
    data: [
      {
        id: "111",
        name: "Acme Lucknow",
        access_token: "PAGE_TOKEN_111",
        picture: { data: { url: "https://cdn.example/a.png" } },
        instagram_business_account: { id: "ig-222", username: "acme.lko", name: "Acme", profile_picture_url: "https://cdn.example/ig.png" },
      },
      { id: "333", name: "Side Page", access_token: "PAGE_TOKEN_333" },
    ],
  };
  await t.db.socialAccount.deleteMany();
});

describe("social settings", () => {
  it("needs app id and secret together and builds redirect URIs from the base URL", () => {
    expect(() => parseSocialConfig({ META_APP_ID: "123" }, "http://localhost:3000")).toThrow(/both META_APP_ID and META_APP_SECRET/);
    const c = parseSocialConfig({ LINKEDIN_CLIENT_ID: "x", LINKEDIN_CLIENT_SECRET: "y", SOCIAL_REDIRECT_BASE_URL: "https://leads.example.com/" }, "http://localhost:3000");
    expect(c).toMatchObject({ meta: null, linkedin: { clientId: "x", scopes: ["openid", "profile", "email", "w_member_social"] }, redirectBaseUrl: "https://leads.example.com" });
  });
});

describe("connected social accounts", () => {
  it("lists providers with the redirect URIs to register", async () => {
    const res = await call("GET", "/api/social/providers");
    expect(res.json()).toEqual({
      meta: { configured: true, redirectUri: "http://localhost:3000/api/oauth/callback/meta", scopes: ["pages_show_list", "instagram_basic"], graphVersion: "v26.0" },
      linkedin: { configured: true, redirectUri: "http://localhost:3000/api/oauth/callback/linkedin", scopes: ["openid", "profile", "email", "w_member_social"] },
    });
  });

  it("connect needs the admin panel session (not an API token)", async () => {
    const token = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
    const res = await call("POST", "/api/social/connect/meta", { authorization: `Bearer ${token.json().token}` });
    expect(res.statusCode).toBe(403);
  });

  it("Facebook login connects every Page and its linked Instagram account, with tokens encrypted", async () => {
    const url = await connect("meta");
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("1234");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/oauth/callback/meta");
    expect(url.searchParams.get("scope")).toBe("pages_show_list,instagram_basic");
    const state = url.searchParams.get("state")!;

    // Facebook redirects the browser back; no session cookie needed (state proves it).
    const back = await t.app.inject({ method: "GET", url: `/api/oauth/callback/meta?code=OK&state=${state}` });
    expect(back.statusCode).toBe(303);
    expect(back.headers.location).toBe("/admin/social?connected=3&provider=meta");

    // The code exchange used the app secret on the server side only.
    expect(calls.find((c) => c.url.pathname.endsWith("oauth/access_token") && c.url.searchParams.get("code") === "OK")?.url.searchParams.get("client_secret")).toBe("app-secret");

    const { items } = (await call("GET", "/api/social/accounts")).json();
    expect(items.map((a: { platform: string; name: string }) => `${a.platform}:${a.name}`).sort()).toEqual(["facebook_page:Acme Lucknow", "facebook_page:Side Page", "instagram:Acme"]);
    const ig = items.find((a: { platform: string }) => a.platform === "instagram");
    expect(ig).toMatchObject({ username: "acme.lko", linkedPageId: "111", status: "connected", tokenExpiresAt: null, scopes: ["pages_show_list", "instagram_basic"] });
    // Tokens never reach the admin panel, and are not stored in plain text.
    expect(JSON.stringify(items)).not.toContain("PAGE_TOKEN");
    const rows = await t.db.socialAccount.findMany();
    expect(rows.every((r) => r.tokenEnc.startsWith("v1.") && !r.tokenEnc.includes("PAGE_TOKEN"))).toBe(true);

    // The state is single use.
    const again = await t.app.inject({ method: "GET", url: `/api/oauth/callback/meta?code=OK&state=${state}` });
    expect(again.headers.location).toContain("error=");
  });

  it("reports cancelled logins, unknown states and Facebook errors on the admin page", async () => {
    const cancelled = await t.app.inject({ method: "GET", url: `/api/oauth/callback/meta?error=access_denied&error_reason=user_denied&state=${(await connect("meta")).searchParams.get("state")}` });
    expect(errorOf(cancelled)).toContain("The login was cancelled.");

    const forged = await t.app.inject({ method: "GET", url: "/api/oauth/callback/meta?code=OK&state=forged" });
    expect(errorOf(forged)).toContain("invalid or expired");

    const bad = await t.app.inject({ method: "GET", url: `/api/oauth/callback/meta?code=bad&state=${(await connect("meta")).searchParams.get("state")}` });
    expect(errorOf(bad)).toContain("Facebook: Invalid verification code format.");

    pagesResponse = { data: [] };
    const none = await t.app.inject({ method: "GET", url: `/api/oauth/callback/meta?code=OK&state=${(await connect("meta")).searchParams.get("state")}` });
    expect(errorOf(none)).toContain("No Facebook Pages came back");
    expect(await t.db.socialAccount.count()).toBe(0);
  });

  it("LinkedIn login connects the profile with its expiry; check and disconnect", async () => {
    const url = await connect("linkedin");
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(url.searchParams.get("scope")).toBe("openid profile email w_member_social");
    const back = await t.app.inject({ method: "GET", url: `/api/oauth/callback/linkedin?code=LI_CODE&state=${url.searchParams.get("state")}` });
    expect(back.headers.location).toBe("/admin/social?connected=1&provider=linkedin");

    const tokenCall = calls.find((c) => c.url.href === "https://www.linkedin.com/oauth/v2/accessToken")!;
    expect(String(tokenCall.init?.body)).toContain("client_secret=li-secret");

    const [li] = (await call("GET", "/api/social/accounts")).json().items;
    expect(li).toMatchObject({ platform: "linkedin", externalId: "li-abc", name: "Prashant Deol", username: "me@example.com", status: "connected" });
    const days = (new Date(li.tokenExpiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59);

    linkedinUserStatus = 401;
    const checked = (await call("POST", `/api/social/accounts/${li.id}/check`)).json().account;
    expect(checked).toMatchObject({ status: "error", lastError: "LinkedIn: Invalid access token" });

    expect((await call("DELETE", `/api/social/accounts/${li.id}`)).statusCode).toBe(200);
    expect((await call("GET", "/api/social/accounts")).json().items).toEqual([]);
  });

  it("check refreshes a Page's details or marks an invalid token", async () => {
    await t.app.inject({ method: "GET", url: `/api/oauth/callback/meta?code=OK&state=${(await connect("meta")).searchParams.get("state")}` });
    const page = (await t.db.socialAccount.findFirst({ where: { externalId: "111" } }))!;
    const ok = (await call("POST", `/api/social/accounts/${page.id}/check`)).json().account;
    expect(ok).toMatchObject({ status: "connected", name: "Acme Lucknow (renamed)", pictureUrl: "https://cdn.example/p.png" });

    await t.db.socialAccount.update({ where: { id: page.id }, data: { externalId: "999" } });
    const broken = (await call("POST", `/api/social/accounts/${page.id}/check`)).json().account;
    expect(broken).toMatchObject({ status: "error", lastError: expect.stringContaining("session has been invalidated") });
  });
});
