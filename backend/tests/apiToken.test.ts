import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, TEST_ALLOWED_ORIGIN } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  // Many logins in this file; the limit itself is tested in auth.test.ts.
  t = await createTestApp({ loginRateLimitPerMinute: 1000 });
});
afterAll(async () => {
  await t.close();
});

async function issueToken(name?: string) {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/token",
    payload: { email: t.credentials.email, password: t.credentials.password, ...(name ? { name } : {}) },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { token: string; tokenId: string; expiresAt: string; admin: { email: string } };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("extension API tokens", () => {
  it("issues a prefixed token and stores only its hash", async () => {
    const { token, tokenId, admin, expiresAt } = await issueToken();
    expect(token).toMatch(/^mlp_[A-Za-z0-9_-]{40,}$/);
    expect(admin.email).toBe(t.credentials.email);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const row = await t.db.apiToken.findUniqueOrThrow({ where: { id: tokenId } });
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.name).toBe("Chrome extension");
  });

  it("rejects wrong credentials and missing fields", async () => {
    const wrong = await t.app.inject({
      method: "POST",
      url: "/api/auth/token",
      payload: { email: t.credentials.email, password: "wrong" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("INVALID_CREDENTIALS");

    const missing = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: "x" } });
    expect(missing.statusCode).toBe(400);
  });

  it("authenticates /me with a bearer token", async () => {
    const { token } = await issueToken();
    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ admin: { email: t.credentials.email }, authMethod: "token" });
  });

  it("rejects unknown, malformed and non-bearer tokens", async () => {
    for (const authorization of ["Bearer mlp_doesnotexist", "Bearer not-a-token", "Basic abc", "Bearer"]) {
      const res = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization } });
      expect(res.statusCode, authorization).toBe(401);
    }
  });

  it("logout with a bearer token revokes only that token", async () => {
    const a = await issueToken("Laptop");
    const b = await issueToken("Desktop");

    const out = await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: bearer(a.token) });
    expect(out.statusCode).toBe(200);

    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(a.token) })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(b.token) })).statusCode).toBe(200);
  });

  it("rejects expired tokens", async () => {
    const { token, tokenId } = await issueToken();
    await t.db.apiToken.update({ where: { id: tokenId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(token) })).statusCode).toBe(401);
  });

  it("lists active tokens without secrets and can revoke one", async () => {
    const { token, tokenId } = await issueToken("To revoke");
    const other = await issueToken("Lister");

    const list = await t.app.inject({ method: "GET", url: "/api/auth/tokens", headers: bearer(other.token) });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("tokenHash");
    const entry = body.tokens.find((x: { id: string }) => x.id === tokenId);
    expect(entry).toMatchObject({ name: "To revoke", current: false });
    expect(entry.prefix).toBe(token.slice(0, 10));
    expect(body.tokens.find((x: { id: string }) => x.id === other.tokenId).current).toBe(true);

    const del = await t.app.inject({ method: "DELETE", url: `/api/auth/tokens/${tokenId}`, headers: bearer(other.token) });
    expect(del.statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(token) })).statusCode).toBe(401);

    const again = await t.app.inject({ method: "DELETE", url: `/api/auth/tokens/${tokenId}`, headers: bearer(other.token) });
    expect(again.statusCode).toBe(404);
  });

  it("records lastUsedAt", async () => {
    const { token, tokenId } = await issueToken();
    await t.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(token) });
    const row = await t.db.apiToken.findUniqueOrThrow({ where: { id: tokenId } });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("a bad bearer header is not rescued by a valid cookie", async () => {
    const login = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: t.credentials.email, password: t.credentials.password },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const res = await t.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie, authorization: "Bearer mlp_bogus" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("tokens that never expire", () => {
  it("API_TOKEN_TTL_DAYS=0 issues tokens without expiry", async () => {
    const t2 = await createTestApp({ apiTokenTtlMs: null });
    try {
      const res = await t2.app.inject({
        method: "POST",
        url: "/api/auth/token",
        payload: { email: t2.credentials.email, password: t2.credentials.password },
      });
      expect(res.json().expiresAt).toBeNull();
    } finally {
      await t2.close();
    }
  });
});

describe("CORS", () => {
  it("allows a configured origin, including preflight", async () => {
    const pre = await t.app.inject({
      method: "OPTIONS",
      url: "/api/auth/me",
      headers: {
        origin: TEST_ALLOWED_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(TEST_ALLOWED_ORIGIN);
    expect(String(pre.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
  });

  it("does not send CORS headers to other origins", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
