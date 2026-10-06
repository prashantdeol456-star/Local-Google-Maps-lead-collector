import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { ApiResult } from "../src/background/apiClient";
import { backoffMs, MAX_BACKOFF_MS, SyncEngine, type Send, type SyncEvent } from "../src/background/sync";
import { IdbOutboxStore, MemoryOutboxStore, type OutboxPayload, type OutboxStore } from "../src/storage/outbox";

const lead = (name: string, clientKey = name): OutboxPayload => ({
  kind: "lead",
  jobId: "job1",
  clientKey,
  lead: {
    name, category: null, phone: null, email: null, website: null, address: null, city: null, state: null,
    country: null, postalCode: null, latitude: null, longitude: null, rating: null, reviewCount: null,
    mapsUrl: null, placeId: null, searchKeyword: "University", source: "google_maps",
  },
});

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, data });
const offline: ApiResult<unknown> = { ok: false, error: { kind: "unreachable", message: "Backend is not reachable" } };
const job = (n: Partial<{ newRecords: number; duplicateRecords: number; errorRecords: number }> = {}) => ({
  id: "job1", totalFound: 1, newRecords: 0, duplicateRecords: 0, errorRecords: 0, ...n,
});

function setup(responder: (method: string, path: string, body: any) => ApiResult<unknown>, store: OutboxStore = new MemoryOutboxStore()) {
  let now = 1_000;
  const calls: { method: string; path: string; body: any }[] = [];
  const events: SyncEvent[] = [];
  const send: Send = async (method, path, body) => {
    calls.push({ method, path, body });
    return responder(method, path, body);
  };
  const engine = new SyncEngine(store, send, (e) => void events.push(e), () => now);
  return { engine, store, calls, events, advance: (ms: number) => (now += ms), now: () => now };
}

describe("SyncEngine", () => {
  it("sends items in order and removes them", async () => {
    const t = setup(() => ok({ result: "new", matchedBy: null, replayed: false, job: job({ newRecords: 1 }) }));
    await t.store.add(lead("A"), 0);
    await t.store.add({ kind: "error", jobId: "job1", clientKey: "x", name: "B", message: "timeout" }, 0);
    await t.store.add({ kind: "status", jobId: "job1", status: "completed", reason: "end_of_list" }, 0);

    expect(await t.engine.flush()).toEqual({ sent: 3, dropped: 0, remaining: 0, stoppedBy: "done" });
    expect(t.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/leads",
      "POST /api/jobs/job1/items/error",
      "PATCH /api/jobs/job1",
    ]);
    expect(t.calls[0]!.body).toMatchObject({ jobId: "job1", clientKey: "A", lead: { name: "A" } });
    expect(t.calls[2]!.body).toEqual({ status: "completed", statusReason: "end_of_list" });
    expect(t.events[0]).toMatchObject({ type: "lead", result: "new", name: "A", job: { newRecords: 1 } });
    expect(await t.store.count()).toBe(0);
  });

  it("keeps everything when the backend is down, backs off, and keeps order", async () => {
    let online = false;
    const t = setup(() => (online ? ok({ result: "new", job: job() }) : offline));
    await t.store.add(lead("A"), 0);
    await t.store.add(lead("B"), 0);
    await t.store.add({ kind: "status", jobId: "job1", status: "completed", reason: null }, 0);

    expect(await t.engine.flush()).toMatchObject({ sent: 0, remaining: 3, stoppedBy: "offline" });
    expect(t.calls).toHaveLength(1); // stopped at the first failure; B and the status wait behind A
    expect(t.events).toEqual([{ type: "offline", error: { kind: "unreachable", message: "Backend is not reachable" } }]);

    expect(await t.engine.flush()).toMatchObject({ sent: 0, stoppedBy: "backoff" }); // not due yet
    expect(t.calls).toHaveLength(1);

    online = true;
    t.advance(backoffMs(1));
    expect(await t.engine.flush()).toMatchObject({ sent: 3, remaining: 0, stoppedBy: "done" });
    expect(t.calls.slice(1).map((c) => c.body.clientKey ?? c.body.status)).toEqual(["A", "B", "completed"]);
  });

  it("drops an item the backend permanently rejects, and continues", async () => {
    const t = setup((_m, _p, body) =>
      body.clientKey === "bad"
        ? { ok: false, error: { kind: "http", status: 400, code: "BAD_REQUEST", message: "lead.rating: Too big" } }
        : ok({ result: "new", job: job() }),
    );
    await t.store.add(lead("Bad", "bad"), 0);
    await t.store.add(lead("Good"), 0);
    expect(await t.engine.flush()).toMatchObject({ sent: 1, dropped: 1, remaining: 0 });
    expect(t.events[0]).toMatchObject({ type: "dropped", error: { status: 400 } });
  });

  it("retries 5xx and 429 but stops (keeping items) on 401", async () => {
    for (const status of [500, 503, 429]) {
      const t = setup(() => ({ ok: false, error: { kind: "http", status, message: `HTTP ${status}` } }));
      await t.store.add(lead("A"), 0);
      expect((await t.engine.flush()).stoppedBy, String(status)).toBe("offline");
      expect(await t.store.count()).toBe(1);
    }
    const t = setup(() => ({ ok: false, error: { kind: "unauthorized", status: 401, message: "Login required" } }));
    await t.store.add(lead("A"), 0);
    expect(await t.engine.flush()).toMatchObject({ stoppedBy: "unauthorized", remaining: 1 });
    expect(t.events).toEqual([{ type: "unauthorized" }]);
  });

  it("concurrent flush calls share one run (no double sends)", async () => {
    const t = setup(() => ok({ result: "new", job: job() }));
    for (const n of ["A", "B", "C"]) await t.store.add(lead(n), 0);
    await Promise.all([t.engine.flush(), t.engine.flush(), t.engine.flush()]);
    expect(t.calls).toHaveLength(3);
  });

  it("backoff grows and is capped", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(20)).toBe(MAX_BACKOFF_MS);
  });
});

describe("IdbOutboxStore", () => {
  it("persists items in insertion order across store instances (like a service-worker restart)", async () => {
    const factory = new IDBFactory();
    const a = new IdbOutboxStore(factory);
    const id1 = await a.add(lead("A"), 10);
    await a.add(lead("B"), 20);
    await a.update(id1, { attempts: 2, nextAttemptAt: 99 });

    const b = new IdbOutboxStore(factory); // fresh instance, same database
    const items = await b.peek(10);
    expect(items.map((i) => (i.kind === "lead" ? i.lead.name : i.kind))).toEqual(["A", "B"]);
    expect(items[0]).toMatchObject({ attempts: 2, nextAttemptAt: 99, createdAt: 10 });
    expect(await b.count()).toBe(2);

    await b.remove(id1);
    expect((await b.peek(10)).map((i) => i.id)).not.toContain(id1);
  });

  it("works end-to-end with the sync engine", async () => {
    const store = new IdbOutboxStore(new IDBFactory());
    const t = setup(() => ok({ result: "duplicate", matchedBy: "phone", replayed: false, job: job({ duplicateRecords: 1 }) }), store);
    await store.add(lead("A"), 0);
    expect(await t.engine.flush()).toMatchObject({ sent: 1, remaining: 0 });
    expect(t.events[0]).toMatchObject({ type: "lead", result: "duplicate", matchedBy: "phone" });
  });
});
