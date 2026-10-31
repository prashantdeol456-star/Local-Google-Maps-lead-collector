import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("extension downloads", () => {
  it("lists built extensions and serves their zip to logged-in admins only", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mlc-ext-"));
    writeFileSync(path.join(dir, "linkedin-helper.zip"), "PK-zip-bytes");
    writeFileSync(
      path.join(dir, "index.json"),
      JSON.stringify([{ id: "linkedin-helper", name: "LinkedIn Helper", version: "0.1.0", description: "d", file: "linkedin-helper.zip", size: 12, builtAt: "2026-10-31T00:00:00Z" }]),
    );
    const t = await createTestApp({ extensionsDir: dir });
    try {
      expect((await t.app.inject({ method: "GET", url: "/api/extensions" })).statusCode).toBe(401);
      expect((await t.app.inject({ method: "GET", url: "/api/extensions/linkedin-helper/download" })).statusCode).toBe(401);

      const login = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
      const headers = { authorization: `Bearer ${login.json().token}` };

      const list = await t.app.inject({ method: "GET", url: "/api/extensions", headers });
      expect(list.json().items.map((e: { id: string }) => e.id)).toEqual(["linkedin-helper"]);

      const file = await t.app.inject({ method: "GET", url: "/api/extensions/linkedin-helper/download", headers });
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-type"]).toBe("application/zip");
      expect(file.headers["content-disposition"]).toBe('attachment; filename="linkedin-helper-0.1.0.zip"');
      expect(file.body).toBe("PK-zip-bytes");

      expect((await t.app.inject({ method: "GET", url: "/api/extensions/meta-helper/download", headers })).statusCode).toBe(404);
    } finally {
      await t.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty list when nothing is built", async () => {
    const t = await createTestApp();
    try {
      const login = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
      const res = await t.app.inject({ method: "GET", url: "/api/extensions", headers: { authorization: `Bearer ${login.json().token}` } });
      expect(res.json()).toEqual({ items: [] });
    } finally {
      await t.close();
    }
  });
});
