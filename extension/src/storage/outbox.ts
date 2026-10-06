// Durable queue of things to send to the backend, in order. Survives backend downtime,
// service-worker restarts and browser crashes (IndexedDB). Every item is idempotent on
// the backend (jobId + clientKey, or a status change), so re-sending is always safe.

import type { ExtractedListing } from "../content/maps/types";

export type LeadPayload = Omit<ExtractedListing, "clientKey">;

export type OutboxPayload =
  | { kind: "lead"; jobId: string; clientKey: string; lead: LeadPayload }
  | { kind: "error"; jobId: string; clientKey: string; name: string; message: string }
  | { kind: "status"; jobId: string; status: "running" | "paused" | "completed" | "stopped" | "failed"; reason: string | null };

export type OutboxItem = OutboxPayload & {
  id: number;
  attempts: number;
  /** Not sent before this time (ms). Backoff after failures. */
  nextAttemptAt: number;
  createdAt: number;
};

export interface OutboxStore {
  add(payload: OutboxPayload, now: number): Promise<number>;
  /** Oldest first. */
  peek(limit: number): Promise<OutboxItem[]>;
  remove(id: number): Promise<void>;
  update(id: number, patch: Pick<OutboxItem, "attempts" | "nextAttemptAt">): Promise<void>;
  count(): Promise<number>;
}

/** In-memory store (tests). */
export class MemoryOutboxStore implements OutboxStore {
  private items: OutboxItem[] = [];
  private nextId = 1;

  async add(payload: OutboxPayload, now: number) {
    const id = this.nextId++;
    this.items.push({ ...payload, id, attempts: 0, nextAttemptAt: now, createdAt: now } as OutboxItem);
    return id;
  }
  async peek(limit: number) {
    return this.items.slice(0, limit).map((i) => ({ ...i }));
  }
  async remove(id: number) {
    this.items = this.items.filter((i) => i.id !== id);
  }
  async update(id: number, patch: Pick<OutboxItem, "attempts" | "nextAttemptAt">) {
    const item = this.items.find((i) => i.id === id);
    if (item) Object.assign(item, patch);
  }
  async count() {
    return this.items.length;
  }
}

const DB_NAME = "maps-collector";
const STORE = "outbox";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB store (extension). Auto-increment ids keep insertion order. */
export class IdbOutboxStore implements OutboxStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode) {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async add(payload: OutboxPayload, now: number) {
    const key = await request((await this.store("readwrite")).add({ ...payload, attempts: 0, nextAttemptAt: now, createdAt: now }));
    return key as number;
  }

  async peek(limit: number) {
    return request((await this.store("readonly")).getAll(undefined, limit)) as Promise<OutboxItem[]>;
  }

  async remove(id: number) {
    await request((await this.store("readwrite")).delete(id));
  }

  async update(id: number, patch: Pick<OutboxItem, "attempts" | "nextAttemptAt">) {
    const store = await this.store("readwrite");
    const item = (await request(store.get(id))) as OutboxItem | undefined;
    if (item) await request(store.put({ ...item, ...patch }));
  }

  async count() {
    return request((await this.store("readonly")).count());
  }
}
