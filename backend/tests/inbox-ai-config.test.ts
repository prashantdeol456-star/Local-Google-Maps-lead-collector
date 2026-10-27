import type { GoogleGenAI } from "@google/genai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GeminiReplyWriter } from "../src/services/inbox/geminiWriter.js";
import { ReplyWriterError, type ReplyContext } from "../src/services/inbox/replyWriter.js";
import { createTestApp } from "./helpers.js";

// Keys and the model are entered in the admin panel: stored encrypted, never shown again,
// used at once (no restart). No real AI call is made here.

const telegramCalls: string[] = [];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  telegramCalls.push(url);
  if (url.includes("/botBADTOKEN") || url.includes("111111:")) return new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 });
  return new Response(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: "Shop", username: "acme_shop_bot" } }), { status: 200 });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const call = (method: "GET" | "PUT" | "POST", url: string, payload?: unknown, headers: Record<string, string> = { cookie }) =>
  t.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

const TG = "987654321:AAHabcdefghijklmnopqrstuvwxyz0123456";

beforeAll(async () => {
  t = await createTestApp({}, { inboxFetch: fakeFetch });
  const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: t.credentials.email, password: t.credentials.password } });
  cookie = String(login.headers["set-cookie"]).split(";")[0]!;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.aiAssistantSettings.deleteMany();
  telegramCalls.length = 0;
});

describe("AI provider, model and keys from the admin panel", () => {
  it("starts unconfigured with Claude Opus 5.5 as the default and lists models for both providers", async () => {
    const cfg = (await call("GET", "/api/inbox/ai-config")).json();
    expect(cfg).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", effort: "medium", ready: false, keys: { anthropicKey: { set: false }, geminiKey: { set: false }, telegramToken: { set: false } } });
    expect(cfg.models.anthropic.map((m: { id: string }) => m.id)).toContain("claude-sonnet-5-5");
    expect(cfg.models.gemini.map((m: { id: string }) => m.id)).toEqual(["gemini-3.8-flash", "gemini-4-argon", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  });

  it("stores keys encrypted, shows only the last 4 characters, and can remove them", async () => {
    const saved = (await call("PUT", "/api/inbox/secrets/anthropicKey", { value: "  sk-ant-api03-SECRETVALUE1234  " })).json();
    expect(saved).toMatchObject({ ready: true, keys: { anthropicKey: { set: true, source: "admin", hint: "…1234" } } });
    const row = (await t.db.aiAssistantSettings.findFirst())!;
    expect(row.anthropicKeyEnc).toMatch(/^v1\./);
    expect(row.anthropicKeyEnc).not.toContain("SECRETVALUE");

    // Nothing the browser can read contains the key.
    for (const url of ["/api/inbox/ai-config", "/api/inbox/settings", "/api/inbox/status"]) {
      expect((await call("GET", url)).body).not.toContain("SECRETVALUE");
      expect((await call("GET", url)).body).not.toContain(row.anthropicKeyEnc!);
    }

    const removed = (await call("PUT", "/api/inbox/secrets/anthropicKey", { value: null })).json();
    expect(removed).toMatchObject({ ready: false, keys: { anthropicKey: { set: false } } });
  });

  it("rejects keys that look wrong, and only from an admin session", async () => {
    expect((await call("PUT", "/api/inbox/secrets/anthropicKey", { value: "AIzaWrongProvider" })).json().error.message).toMatch(/sk-ant-/);
    expect((await call("PUT", "/api/inbox/secrets/telegramToken", { value: "not-a-token" })).json().error.message).toMatch(/BotFather/);
    const token = (await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } })).json().token;
    const res = await call("PUT", "/api/inbox/secrets/geminiKey", { value: "AIzaSomething" }, { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(403);
  });

  it("switches to Gemini (model resets to Gemini's default) and saves model and effort", async () => {
    await call("PUT", "/api/inbox/ai-config", { model: "claude-haiku-5-5" });
    const gem = (await call("PUT", "/api/inbox/ai-config", { provider: "gemini" })).json();
    expect(gem).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash", ready: false });
    await call("PUT", "/api/inbox/secrets/geminiKey", { value: "AIzaSyExampleGeminiKey9876" });
    const done = (await call("PUT", "/api/inbox/ai-config", { model: "gemini-4-argon", effort: "high" })).json();
    expect(done).toMatchObject({ provider: "gemini", model: "gemini-4-argon", effort: "high", ready: true, keys: { geminiKey: { hint: "…9876" } } });
    expect((await call("GET", "/api/inbox/status")).json().ai).toEqual({ configured: true, model: "gemini-4-argon" });
    expect((await call("PUT", "/api/inbox/ai-config", { model: "bad model!" })).statusCode).toBe(400);
  });

  it("Telegram token from the admin panel: test button and live use", async () => {
    await call("PUT", "/api/inbox/secrets/telegramToken", { value: TG });
    expect((await call("POST", "/api/inbox/test/telegram")).json()).toEqual({ ok: true, detail: "Connected to @acme_shop_bot" });
    expect(telegramCalls.at(-1)).toContain(`/bot${TG}/getMe`);
    expect((await call("GET", "/api/inbox/status")).json().telegram).toEqual({ configured: true });

    await call("PUT", "/api/inbox/secrets/telegramToken", { value: "111111:AAHabcdefghijklmnopqrstuvwxyz0123456" });
    expect((await call("POST", "/api/inbox/test/telegram")).json()).toMatchObject({ ok: false, detail: expect.stringMatching(/rejected the bot token/) });
    expect((await call("POST", "/api/inbox/test/ai")).json()).toEqual({ ok: false, detail: "No Claude API key yet" });
  });
});

describe("Gemini reply writer", () => {
  const ctx: ReplyContext = {
    platform: "telegram",
    participantName: "Rohan",
    participantUsername: null,
    messages: [{ direction: "in", text: "Aap kab tak open ho?", sentAt: new Date() }],
    business: { profile: "Acme Bakery, 10am-7pm", faqs: "", style: "", neverSay: "" },
    timeZone: "Asia/Kolkata",
  };

  function fake(response: unknown) {
    const seen: unknown[] = [];
    const client = { models: { generateContent: async (req: unknown) => (seen.push(req), response) } } as unknown as GoogleGenAI;
    return { client, seen };
  }

  it("sends the shared prompt with a JSON schema and the chosen thinking level, and parses the answer", async () => {
    const answer = { intent: "question", summary: "Asks timings", language: "Hinglish", should_reply: true, reply: " 10 se 7 baje tak! ", confidence: 1.4, needs_human: false, reason: "" };
    const { client, seen } = fake({ text: JSON.stringify(answer), candidates: [{ finishReason: "STOP" }] });
    const writer = new GeminiReplyWriter({ apiKey: "x", model: "gemini-3.8-flash", effort: "low", client });
    const out = await writer.write(ctx);
    expect(out).toMatchObject({ reply: "10 se 7 baje tak!", confidence: 1, intent: "question" });
    const req = seen[0] as { model: string; contents: string; config: { systemInstruction: string; responseMimeType: string; responseJsonSchema: { properties: object; $schema?: string }; thinkingConfig: { thinkingLevel: string } } };
    expect(req.model).toBe("gemini-3.8-flash");
    expect(req.contents).toContain("Rohan: Aap kab tak open ho?");
    expect(req.config.systemInstruction).toContain("Acme Bakery");
    expect(req.config.responseMimeType).toBe("application/json");
    expect(Object.keys(req.config.responseJsonSchema.properties)).toEqual(expect.arrayContaining(["reply", "confidence", "needs_human"]));
    expect(req.config.responseJsonSchema.$schema).toBeUndefined();
    expect(req.config.thinkingConfig.thinkingLevel).toBe("LOW");
  });

  it("reports blocked or malformed answers as reply-writer errors", async () => {
    const blocked = new GeminiReplyWriter({ apiKey: "x", model: "gemini-3.8-flash", effort: "medium", client: fake({ text: "", candidates: [{ finishReason: "SAFETY" }] }).client });
    await expect(blocked.write(ctx)).rejects.toThrow(/declined/);
    const junk = new GeminiReplyWriter({ apiKey: "x", model: "gemini-3.8-flash", effort: "medium", client: fake({ text: "not json", candidates: [{ finishReason: "STOP" }] }).client });
    await expect(junk.write(ctx)).rejects.toBeInstanceOf(ReplyWriterError);
  });
});
