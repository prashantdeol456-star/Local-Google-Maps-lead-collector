// End-to-end: the extension's real sync code (outbox + SyncEngine + apiRequest over HTTP)
// against a real backend server. Covers "backend down → records kept → backend up → all saved once".
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiRequest } from "../../extension/src/background/apiClient";
import { SyncEngine, type SyncEvent } from "../../extension/src/background/sync";
import { IdbOutboxStore, type OutboxPayload } from "../../extension/src/storage/outbox";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let baseUrl: string;
let token: string;

beforeAll(async () => {
  t = await createTestApp();
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const address = t.app.server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/token",
    payload: { email: t.credentials.email, password: t.credentials.password },
  });
  token = res.json().token;
});
afterAll(async () => {
  await t.close();
});

const lead = (jobId: string, clientKey: string, name: string, extra: Record<string, unknown> = {}): OutboxPayload => ({
  kind: "lead",
  jobId,
  clientKey,
  lead: {
    name, category: "University", phone: null, email: null, website: null, address: null, city: "Lucknow",
    state: "Uttar Pradesh", country: "India", postalCode: null, latitude: null, longitude: null, rating: 4.1,
    reviewCount: 10, mapsUrl: null, placeId: null, searchKeyword: "University", source: "google_maps", ...extra,
  },
});

describe("extension sync ↔ backend", () => {
  it("keeps records while the backend is down and saves each exactly once when it is back", async () => {
    const job = (await t.app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { authorization: `Bearer ${token}` },
      payload: { searchKeyword: "University", location: "Lucknow" },
    })).json().job;
    await t.app.inject({ method: "PATCH", url: `/api/jobs/${job.id}`, headers: { authorization: `Bearer ${token}` }, payload: { status: "running" } });

    let backendUp = false;
    let now = 0;
    const events: SyncEvent[] = [];
    const store = new IdbOutboxStore(new IDBFactory());
    const engine = new SyncEngine(
      store,
      (method, path, body) =>
        // While "down", requests go to a closed port, exactly like a stopped local backend.
        apiRequest({ baseUrl: backendUp ? baseUrl : "http://127.0.0.1:9", token, timeoutMs: 3000 }, path, { method, body }),
      (e) => void events.push(e),
      () => now,
    );

    await store.add(lead(job.id, "0x1:0x1", "ERA University", { placeId: "ChIJera", phone: "08957926677" }), 0);
    await store.add(lead(job.id, "0x2:0x2", "Era Univ (dup by phone)", { phone: "+91 89579 26677" }), 0);
    await store.add(lead(job.id, "0x3:0x3", "Amity University Lucknow", { website: "https://www.amity.edu/lucknow/" }), 0);
    await store.add({ kind: "error", jobId: job.id, clientKey: "0x4:0x4", name: "Slow Place", message: "Details did not load in time" }, 0);
    await store.add({ kind: "status", jobId: job.id, status: "completed", reason: "end_of_list" }, 0);

    // Backend down: nothing lost, nothing sent.
    expect(await engine.flush()).toMatchObject({ sent: 0, remaining: 5, stoppedBy: "offline" });
    expect(events.at(-1)).toMatchObject({ type: "offline", error: { kind: "unreachable" } });
    expect(await t.db.lead.count()).toBe(0);

    // Backend back: everything arrives, in order.
    backendUp = true;
    now += 60_000;
    expect(await engine.flush()).toMatchObject({ sent: 5, dropped: 0, remaining: 0, stoppedBy: "done" });

    const saved = await t.db.collectionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved).toMatchObject({ status: "completed", statusReason: "end_of_list", totalFound: 4, newRecords: 2, duplicateRecords: 1, errorRecords: 1 });
    expect(await t.db.lead.count()).toBe(2);

    // The extension retries the same items (e.g. it crashed before removing them): no double counting.
    await store.add(lead(job.id, "0x1:0x1", "ERA University", { placeId: "ChIJera" }), now);
    await store.add({ kind: "error", jobId: job.id, clientKey: "0x4:0x4", name: "Slow Place", message: "again" }, now);
    expect(await engine.flush()).toMatchObject({ sent: 2, remaining: 0 });
    expect(await t.db.collectionJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      totalFound: 4, newRecords: 2, duplicateRecords: 1, errorRecords: 1,
    });

    const leadEvents = events.filter((e) => e.type === "lead");
    expect(leadEvents.map((e) => (e.type === "lead" ? [e.result, e.replayed] : null))).toEqual([
      ["new", false],
      ["duplicate", false],
      ["new", false],
      ["new", true],
    ]);
  });

  it("stops on an invalid token and keeps the records", async () => {
    const store = new IdbOutboxStore(new IDBFactory());
    const engine = new SyncEngine(store, (method, path, body) => apiRequest({ baseUrl, token: "mlp_revoked" }, path, { method, body }), () => {});
    await store.add(lead("whatever", "k", "X"), 0);
    expect(await engine.flush()).toMatchObject({ stoppedBy: "unauthorized", remaining: 1 });
  });
});
