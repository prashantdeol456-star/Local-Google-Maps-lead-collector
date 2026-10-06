import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../src/database/repositories/index.js";
import { WEBHOOK_MAX_ATTEMPTS, WebhookWorker } from "../src/jobs/webhookWorker.js";
import { SecretBox } from "../src/utils/secretBox.js";
import { createTestApp } from "./helpers.js";

const SESSION_SECRET = "test-secret-test-secret-test-secret-123"; // same as helpers.ts

/** Stand-in for an n8n Webhook node: records requests, answers with `status`. */
let received: { headers: IncomingHttpHeaders; body: string }[] = [];
let status = 200;
let receiver: Server;
let hookUrl: string;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: { cookie: string };
let bearer: { authorization: string };

const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>, headers: Record<string, string> = cookie) =>
  t.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

async function waitFor<T>(check: () => Promise<T | null | undefined | false>, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function endpoint(events: string[] = ["lead.created"], extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/integrations/webhooks", { name: "n8n leads", url: hookUrl, events, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { endpoint: { id: string; secret: string }; secret: string };
}

const pending = () => t.db.webhookDelivery.findMany({ orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(status, status === 302 ? { location: "http://example.com/" } : {}).end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  hookUrl = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/webhook/leads`;

  t = await createTestApp();
  const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: t.credentials.email, password: t.credentials.password } });
  cookie = { cookie: String(login.headers["set-cookie"]).split(";")[0]! };
  const tok = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  bearer = { authorization: `Bearer ${tok.json().token}` };
});
afterAll(async () => {
  await t.close();
  await new Promise((r) => receiver.close(r));
});
beforeEach(async () => {
  await t.db.webhookDelivery.deleteMany();
  await t.db.webhookEndpoint.deleteMany();
  await t.db.suppression.deleteMany();
  await t.db.jobItem.deleteMany();
  await t.db.lead.deleteMany();
  received = [];
  status = 200;
});

describe("integration tokens (for n8n's HTTP Request node)", () => {
  it("a read-only token can GET data but not change anything, and cannot reach token or webhook settings", async () => {
    expect((await call("POST", "/api/auth/tokens", { name: "n8n" }, bearer)).statusCode).toBe(403); // tokens cannot mint tokens
    const created = await call("POST", "/api/auth/tokens", { name: "n8n (read)", scope: "read", expiresInDays: 30 });
    expect(created.statusCode).toBe(201);
    const read = { authorization: `Bearer ${created.json().token}` };
    expect(created.json().info).toMatchObject({ name: "n8n (read)", scope: "read" });

    expect((await call("GET", "/api/leads", undefined, read)).statusCode).toBe(200);
    expect((await call("GET", "/api/export/csv", undefined, read)).statusCode).toBe(200);
    const write = await call("POST", "/api/leads", { lead: { name: "X" } }, read);
    expect(write.statusCode).toBe(403);
    expect(write.json().error.message).toContain("read-only");
    expect((await call("GET", "/api/auth/tokens", undefined, read)).statusCode).toBe(403);
    expect((await call("GET", "/api/integrations/webhooks", undefined, read)).statusCode).toBe(403);

    const list = (await call("GET", "/api/auth/tokens")).json().tokens as { name: string; scope: string }[];
    expect(list.find((x) => x.name === "n8n (read)")?.scope).toBe("read");
  });

  it("webhook settings are admin-panel only (not for bearer tokens)", async () => {
    expect((await call("GET", "/api/integrations/webhooks", undefined, bearer)).statusCode).toBe(403);
    expect((await call("GET", "/api/integrations/webhooks")).statusCode).toBe(200);
  });
});

describe("webhook endpoints", () => {
  it("validates the URL and events; shows the secret once and stores it encrypted", async () => {
    for (const url of ["not a url", "ftp://x.example/hook", "https://user:pass@x.example/hook"]) {
      expect((await call("POST", "/api/integrations/webhooks", { name: "x", url, events: ["lead.created"] })).statusCode).toBe(400);
    }
    expect((await call("POST", "/api/integrations/webhooks", { name: "x", url: hookUrl, events: [] })).statusCode).toBe(400);
    expect((await call("POST", "/api/integrations/webhooks", { name: "x", url: hookUrl, events: ["lead.deleted"] })).statusCode).toBe(400);

    const { endpoint: e, secret } = await endpoint();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    expect(e.secret).toBe(`whsec_••••${secret.slice(-4)}`);
    const row = await t.db.webhookEndpoint.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.secretEnc).not.toContain(secret.slice(6));
    expect(JSON.stringify((await call("GET", "/api/integrations/webhooks")).json())).not.toContain(secret);
  });

  it("sends a new lead, signed, with only the public lead fields; duplicates are not sent again", async () => {
    const { secret } = await endpoint();
    await call("POST", "/api/leads", { lead: { name: "ERA University", phone: "089579 26677", city: "Lucknow" } }, bearer);
    await call("POST", "/api/leads", { lead: { name: "ERA University", phone: "+91 89579 26677", city: "Lucknow" } }, bearer); // duplicate
    await waitFor(async () => (await pending()).length > 0);
    await t.app.webhookWorker.tick();

    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    expect(headers).toMatchObject({ "content-type": "application/json", "x-lead-platform-event": "lead.created", "x-lead-platform-token": secret });
    const ts = headers["x-lead-platform-timestamp"] as string;
    const expected = `v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
    expect(headers["x-lead-platform-signature"]).toBe(expected);

    const event = JSON.parse(body);
    expect(event).toMatchObject({ type: "lead.created", data: { lead: { name: "ERA University", phone: "089579 26677", city: "Lucknow" } } });
    expect(event.id).toBe(headers["x-lead-platform-event-id"]);
    expect(Object.keys(event.data.lead)).not.toEqual(expect.arrayContaining(["dedupeKey"]));
    expect(body).not.toMatch(/dedupeKey|normalizedPhone/);

    expect((await pending()).map((d) => d.status)).toEqual(["delivered"]);
  });

  it("retries failures 1, 5, 15, 60 minutes apart, then marks them failed; a manual retry sends again", async () => {
    const { endpoint: e } = await endpoint(["optout.recorded"]);
    let now = new Date("2026-10-06T10:00:00Z");
    const worker = new WebhookWorker(createRepositories(t.db), new SecretBox(SESSION_SECRET, "webhook-secrets"), { now: () => now });
    await call("POST", "/api/opt-outs", { channel: "email", addresses: "info@abc.in", reason: "Client list" });
    await waitFor(async () => (await pending()).length > 0);
    await t.db.webhookDelivery.updateMany({ data: { nextAttemptAt: now } });

    status = 500;
    for (const gapMin of [1, 5, 15, 60]) {
      await worker.tick();
      const d = (await pending())[0]!;
      expect(d).toMatchObject({ status: "pending", responseStatus: 500, lastError: "HTTP 500" });
      expect(d.nextAttemptAt.getTime() - now.getTime()).toBe(gapMin * 60_000);
      now = d.nextAttemptAt;
    }
    await worker.tick();
    const failed = (await pending())[0]!;
    expect(failed).toMatchObject({ status: "failed", attempts: WEBHOOK_MAX_ATTEMPTS });
    expect(JSON.parse(failed.payload).data.optOut).toMatchObject({ channel: "email", address: "info@abc.in", source: "import" });

    status = 200;
    const retry = await call("POST", `/api/integrations/deliveries/${failed.id}/retry`);
    expect(retry.json().result).toEqual({ ok: true, status: 200 });
    const log = (await call("GET", `/api/integrations/webhooks/${e.id}/deliveries?status=delivered`)).json();
    expect(log.total).toBe(1);
  });

  it("test button sends a ping now; redirects are not followed; a disabled webhook gets nothing", async () => {
    const { endpoint: e } = await endpoint(["lead.created", "collection.finished"]);
    const ping = (await call("POST", `/api/integrations/webhooks/${e.id}/test`)).json();
    expect(ping.result).toEqual({ ok: true, status: 200 });
    expect(JSON.parse(received[0]!.body)).toMatchObject({ type: "ping" });

    status = 302;
    expect((await call("POST", `/api/integrations/webhooks/${e.id}/test`)).json().result).toMatchObject({ ok: false, error: expect.stringContaining("redirects are not followed") });

    await call("PATCH", `/api/integrations/webhooks/${e.id}`, { enabled: false });
    await call("POST", "/api/leads", { lead: { name: "Quiet University" } }, bearer);
    await new Promise((r) => setTimeout(r, 100));
    expect((await pending()).filter((d) => d.event === "lead.created")).toHaveLength(0);
  });

  it("sends finished collections and received replies, and keeps working after the secret is rotated", async () => {
    const { endpoint: e, secret: first } = await endpoint(["collection.finished", "reply.received"]);
    const job = (await call("POST", "/api/jobs", { searchKeyword: "University" }, bearer)).json().job;
    await call("PATCH", `/api/jobs/${job.id}`, { status: "running" }, bearer);
    await call("PATCH", `/api/jobs/${job.id}`, { status: "completed" }, bearer);

    const lead = await t.db.lead.create({ data: { name: "Ravi College", normalizedName: "ravi college", dedupeKey: "k:r" } });
    const msg = await t.db.whatsAppEvent.create({
      data: { type: "received", leadId: lead.id, phone: "+919876543210", provider: "meta", text: "Please call me", metadata: JSON.stringify({ profileName: "Ravi", messageType: "text" }), occurredAt: new Date() },
    });
    t.app.events.publish({ type: "reply.received", channel: "whatsapp", eventId: msg.id });

    const { secret: second } = (await call("POST", `/api/integrations/webhooks/${e.id}/rotate-secret`)).json();
    expect(second).not.toBe(first);
    await waitFor(async () => (await pending()).length === 2);
    await t.app.webhookWorker.tick();

    const byType = Object.fromEntries(received.map((r) => [JSON.parse(r.body).type, r]));
    expect(JSON.parse(byType["collection.finished"].body).data.job).toMatchObject({ id: job.id, status: "completed", searchKeyword: "University" });
    expect(JSON.parse(byType["reply.received"].body).data).toEqual({
      reply: expect.objectContaining({ channel: "whatsapp", from: "+919876543210", profileName: "Ravi", text: "Please call me" }),
      lead: { id: lead.id, name: "Ravi College" },
    });
    for (const r of received) {
      const ts = r.headers["x-lead-platform-timestamp"] as string;
      expect(r.headers["x-lead-platform-signature"]).toBe(`v1=${createHmac("sha256", second).update(`${ts}.${r.body}`).digest("hex")}`);
    }
  });

  it("reports a secret that cannot be read (SESSION_SECRET changed) instead of sending unsigned", async () => {
    await endpoint(["optout.recorded"]);
    await call("POST", "/api/opt-outs", { channel: "email", addresses: "a@b.in", reason: "x list" });
    await waitFor(async () => (await pending()).length > 0);
    const other = new WebhookWorker(createRepositories(t.db), new SecretBox("another-session-secret-another-one-12", "webhook-secrets"));
    await other.tick();
    expect((await pending())[0]!.lastError).toContain("Rotate the secret");
    expect(received).toHaveLength(0);
  });
});

describe("docs/n8n.md", () => {
  it("the signature check shown in the guide accepts our deliveries and rejects tampered, foreign or old ones", async () => {
    const { readFileSync } = await import("node:fs");
    const { signPayload } = await import("../src/jobs/webhookWorker.js");
    const doc = readFileSync(new URL("../../docs/n8n.md", import.meta.url), "utf8");
    const code = doc.match(/```js\n([\s\S]*?)```/)![1]!;
    const { isGenuine } = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as {
      isGenuine: (secret: string, headers: Record<string, string>, raw: string) => boolean;
    };

    const secret = "whsec_test";
    const body = JSON.stringify({ id: "ping:1", type: "ping" });
    const sign = (ts: number) => ({ "x-lead-platform-timestamp": String(ts), "x-lead-platform-signature": signPayload(secret, ts, body) });
    const now = Math.floor(Date.now() / 1000);
    expect(isGenuine(secret, sign(now), body)).toBe(true);
    expect(isGenuine(secret, sign(now), `${body} `)).toBe(false);
    expect(isGenuine("whsec_other", sign(now), body)).toBe(false);
    expect(isGenuine(secret, sign(now - 600), body)).toBe(false);
  });
});
