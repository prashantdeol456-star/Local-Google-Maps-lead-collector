import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return header!.split(";")[0];
}

describe("health", () => {
  it("is public and reports database ok", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", database: "ok" });
  });
});

describe("initial admin", () => {
  it("is created once and not duplicated on restart", async () => {
    expect(await t.app.authService.ensureInitialAdmin(t.credentials)).toBe("exists");
    expect(await t.db.adminUser.count()).toBe(1);
  });

  it("stores a bcrypt hash, never the plain password", async () => {
    const user = await t.db.adminUser.findFirstOrThrow();
    expect(user.passwordHash).not.toContain(t.credentials.password);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});

describe("auth", () => {
  it("rejects protected routes without login", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a forged cookie", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: "mlc_session=forged" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects missing fields", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a wrong password with a generic message", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: t.credentials.email, password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs in, reads /me, logs out, and the session stops working", async () => {
    const login = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "  ADMIN@test.local ", password: t.credentials.password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().admin.email).toBe(t.credentials.email);
    const setCookie = login.headers["set-cookie"];
    expect(String(setCookie)).toMatch(/HttpOnly/i);
    expect(String(setCookie)).toMatch(/SameSite=Strict/i);
    const cookie = sessionCookie(setCookie);

    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().admin.email).toBe(t.credentials.email);

    const logout = await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(200);

    const after = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("rejects an expired session", async () => {
    const login = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: t.credentials.email, password: t.credentials.password },
    });
    const cookie = sessionCookie(login.headers["set-cookie"]);
    await t.db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("rate-limits repeated login attempts", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await t.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nobody@test.local", password: "x" },
      });
      codes.push(res.statusCode);
    }
    expect(codes).toContain(429);
  });
});
