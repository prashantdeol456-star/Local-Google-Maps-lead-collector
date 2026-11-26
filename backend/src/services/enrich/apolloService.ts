// Apollo people search with the user's own Apollo.io key (Email finder → Apollo people search).
//
// Searching is free. Getting a person's full name and work email costs 1 Apollo credit, so it goes
// through the same "zero-cost gateway" rules as Hunter:
//   - no key, a switched-off key or unknown credits → no paid request;
//   - credits are read first (free), and a reveal is sent only if credits left − credits held for
//     unfinished reveals − a 10 % safety margin covers it; 1 credit is held first, then settled
//     (1 when Apollo returned the person, 0 when not);
//   - a reveal that timed out keeps its credit held; 401 switches the key off until saved again;
//   - a person revealed in the last 30 days is answered from the ledger, without a request;
//   - personal emails and phone numbers are never asked for.
// One batch at a time per user, so two at once cannot both take the last credit.

import type { PrismaClient } from "../../generated/prisma/client.js";
import { ownerScope } from "../../database/ownerScope.js";
import { Errors } from "../../utils/errors.js";
import type { SecretBox } from "../../utils/secretBox.js";
import { ApolloError, type ApolloClient, type ApolloCredits, type ApolloFilters, type RevealedPerson } from "./apollo.js";
import { CACHE_DAYS, SAFETY_MARGIN } from "./enrichmentService.js";

export const PER_PAGE = 25;
export const MAX_REVEAL = 25;
const MAX_PAGE = 500;
const DAY = 24 * 60 * 60 * 1000;
const PROVIDER = "apollo";
const KIND = "apollo_reveal";

const ownerKey = () => ownerScope.getStore()?.userId ?? "default";
const queryKey = (id: string) => `apollo:${id}`;

export interface RevealOutcome {
  id: string;
  /** found: name (and maybe email) returned; not_found: Apollo had nothing (no credit); cached: revealed before; blocked: not enough credits; failed */
  status: "found" | "not_found" | "cached" | "blocked" | "failed";
  person: RevealedPerson | null;
  error?: string;
}

const csvCell = (v: string | null | undefined) => {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export class ApolloService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: PrismaClient,
    private readonly apollo: ApolloClient,
    private readonly box: SecretBox,
    private readonly opts: { now?: () => Date; importContacts?: (fileName: string, data: Buffer, listName: string) => Promise<object> } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const key = ownerKey();
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.locks.set(key, tail);
    void tail.then(() => this.locks.get(key) === tail && this.locks.delete(key));
    return run;
  }

  // ---- The key ----

  async status() {
    const acc = await this.db.apolloAccount.findUnique({ where: { id: ownerKey() } });
    const held = await this.heldUnits();
    return {
      configured: !!acc,
      keyHint: acc?.keyHint ?? null,
      status: acc?.status ?? null,
      statusReason: acc?.statusReason ?? null,
      credits: acc && acc.creditsLimit !== null ? { limit: acc.creditsLimit, used: acc.creditsUsed ?? 0, left: Math.max(0, acc.creditsLimit - (acc.creditsUsed ?? 0)), held } : null,
      cycleEnd: acc?.cycleEnd ?? null,
      checkedAt: acc?.checkedAt ?? null,
    };
  }

  async setKey(key: string | null) {
    const id = ownerKey();
    if (key === null) {
      await this.db.apolloAccount.deleteMany({ where: { id } });
      return this.status();
    }
    const trimmed = key.trim();
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(trimmed)) throw Errors.badRequest("That does not look like an Apollo API key (Apollo → Settings → Integrations → API → API keys)");
    let credits: ApolloCredits;
    try {
      credits = await this.apollo.credits(trimmed);
    } catch (err) {
      throw this.userError(err);
    }
    const data = { keyEnc: this.box.seal(trimmed), keyHint: `…${trimmed.slice(-4)}`, status: "ok", statusReason: null, ...this.creditFields(credits) };
    await this.db.apolloAccount.upsert({ where: { id }, create: { id, ...data }, update: data });
    return this.status();
  }

  private creditFields(c: ApolloCredits) {
    return { creditsLimit: c.limit, creditsUsed: c.used, cycleEnd: c.cycleEnd, checkedAt: this.now() };
  }

  async refresh() {
    await this.serial(async () => {
      const acc = await this.account();
      await this.readCredits(acc.id, this.box.open(acc.keyEnc));
    });
    return this.status();
  }

  private async account() {
    const acc = await this.db.apolloAccount.findUnique({ where: { id: ownerKey() } });
    if (!acc) throw Errors.badRequest("Add your Apollo API key first (Email finder → Apollo people search)");
    if (acc.status === "disabled") throw Errors.conflict("APOLLO_DISABLED", `Apollo key switched off: ${acc.statusReason ?? "save it again to use it"}`);
    return acc;
  }

  private async readCredits(id: string, key: string): Promise<ApolloCredits> {
    try {
      const c = await this.apollo.credits(key);
      await this.db.apolloAccount.update({ where: { id }, data: { ...this.creditFields(c), status: "ok", statusReason: null } });
      return c;
    } catch (err) {
      await this.failed(id, err);
      throw this.userError(err);
    }
  }

  private async heldUnits(): Promise<number> {
    const since = new Date(this.now().getTime() - 31 * DAY);
    const rows = await this.db.enrichLookup.findMany({ where: { provider: PROVIDER, status: { in: ["reserved", "unknown"] }, createdAt: { gte: since } }, select: { reservedUnits: true } });
    return rows.reduce((a, r) => a + r.reservedUnits, 0);
  }

  private async failed(id: string, err: unknown) {
    if (err instanceof ApolloError && err.status === 401) {
      await this.db.apolloAccount.update({ where: { id }, data: { status: "disabled", statusReason: "Apollo rejected the key (401). Save a working key again." } });
    }
  }

  private userError(err: unknown) {
    if (!(err instanceof ApolloError)) return err;
    if (err.status === 401) return Errors.badRequest("Apollo does not accept this key: copy it again from Apollo → Settings → Integrations → API");
    if (err.status === 403)
      return Errors.badRequest(
        "Apollo refused: the key must allow People API Search, People Enrichment and View Credit Usage Stats (or be a master key), and free Apollo accounts must be registered with a work email",
      );
    if (err.status === 429) return Errors.conflict("APOLLO_RATE_LIMIT", "Apollo asks to slow down: try again in a minute");
    if (err.status === 422) return Errors.badRequest(err.message);
    return Errors.badRequest(err.message);
  }

  // ---- Search (free) ----

  async search(filters: ApolloFilters, page: number) {
    const has = (a?: string[]) => (a ?? []).some((v) => v.trim());
    if (!has(filters.titles) && !has(filters.seniorities) && !has(filters.personLocations) && !has(filters.organizationLocations) && !has(filters.domains) && !filters.keywords?.trim()) {
      throw Errors.badRequest("Add at least one filter: job title, location, company website or keywords");
    }
    const p = Math.min(Math.max(1, page), MAX_PAGE);
    const acc = await this.account();
    let res;
    try {
      res = await this.apollo.search(this.box.open(acc.keyEnc), filters, p, PER_PAGE);
    } catch (err) {
      await this.failed(acc.id, err);
      throw this.userError(err);
    }
    const revealed = await this.revealedMap(res.people.map((x) => x.id));
    return {
      total: res.total,
      page: p,
      pageSize: PER_PAGE,
      pages: Math.min(MAX_PAGE, Math.ceil(res.total / PER_PAGE)),
      people: res.people.map((x) => ({ ...x, revealed: revealed.get(x.id) ?? null })),
    };
  }

  /** People revealed before (in this user's ledger), by Apollo id. */
  private async revealedMap(ids: string[]) {
    const map = new Map<string, RevealedPerson | false>();
    if (!ids.length) return map;
    const rows = await this.db.enrichLookup.findMany({
      where: { provider: PROVIDER, queryKey: { in: ids.map(queryKey) }, status: { in: ["done", "not_found"] } },
      orderBy: { createdAt: "asc" },
    });
    for (const r of rows) map.set(r.queryKey.slice("apollo:".length), r.result ? (JSON.parse(r.result) as RevealedPerson) : false);
    return map;
  }

  // ---- Reveal (1 credit each) ----

  reveal(idsInput: string[]) {
    const ids = [...new Set(idsInput.map((s) => s.trim()).filter((s) => /^[A-Za-z0-9]{6,40}$/.test(s)))].slice(0, MAX_REVEAL);
    if (!ids.length) throw Errors.badRequest("Choose the people to get emails for");
    return this.serial(async () => {
      const out: RevealOutcome[] = [];
      const since = new Date(this.now().getTime() - CACHE_DAYS * DAY);
      const cached = await this.db.enrichLookup.findMany({ where: { provider: PROVIDER, queryKey: { in: ids.map(queryKey) }, status: { in: ["done", "not_found"] }, createdAt: { gte: since } } });
      const todo: string[] = [];
      for (const id of ids) {
        const c = cached.find((r) => r.queryKey === queryKey(id));
        if (c) out.push({ id, status: "cached", person: c.result ? (JSON.parse(c.result) as RevealedPerson) : null });
        else todo.push(id);
      }
      if (!todo.length) return { items: out, creditsLeft: null as number | null };

      const acc = await this.account();
      const key = this.box.open(acc.keyEnc);
      const credits = await this.readCredits(acc.id, key);
      const margin = Math.ceil(credits.limit * SAFETY_MARGIN);
      let free = credits.left - (await this.heldUnits()) - margin;
      let used = 0;
      let stop: string | null = null;
      for (const id of todo) {
        if (stop) {
          out.push({ id, status: "failed", person: null, error: stop });
          continue;
        }
        if (free < 1) {
          out.push({ id, status: "blocked", person: null, error: `Not enough Apollo credits (${credits.left - used} left, ${margin} kept as a safety margin)` });
          continue;
        }
        const row = await this.db.enrichLookup.create({ data: { provider: PROVIDER, kind: KIND, queryKey: queryKey(id), reservedUnits: 1, status: "reserved" } });
        free -= 1;
        try {
          const person = await this.apollo.reveal(key, id);
          const cost = person ? 1 : 0;
          used += cost;
          free += 1 - cost;
          await this.db.enrichLookup.update({ where: { id: row.id }, data: { status: person ? "done" : "not_found", usedUnits: cost, result: person ? JSON.stringify(person) : null, settledAt: this.now() } });
          out.push({ id, status: person ? "found" : "not_found", person });
        } catch (err) {
          const unknown = err instanceof ApolloError && (err.status === 0 || err.status >= 500);
          const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
          await this.db.enrichLookup.update({
            where: { id: row.id },
            data: unknown ? { status: "unknown", error: message } : { status: "failed", usedUnits: 0, error: message, settledAt: this.now() },
          });
          if (!unknown) free += 1;
          await this.failed(acc.id, err);
          const e = this.userError(err);
          const msg = e instanceof Error ? e.message : message;
          out.push({ id, status: "failed", person: null, error: msg });
          // A bad key, missing permission or rate limit stops the rest of the batch.
          if (err instanceof ApolloError && [401, 403, 429].includes(err.status)) stop = msg;
        }
      }
      await this.db.apolloAccount.update({ where: { id: acc.id }, data: { creditsUsed: credits.used + used } });
      const order = new Map(ids.map((id, i) => [id, i]));
      out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      return { items: out, creditsLeft: Math.max(0, credits.left - used) };
    });
  }

  /** Revealed people (with a name) into Contacts. */
  async toContacts(ids: string[], listName: string | null) {
    if (!this.opts.importContacts) throw Errors.badRequest("Contacts are not available");
    const people = [...(await this.revealedMap(ids.slice(0, 500))).values()].filter((p): p is RevealedPerson => !!p);
    if (!people.length) throw Errors.badRequest("Get the emails first: only revealed people can be added");
    let csv = "Name,LinkedIn URL,Contact Number,Email,Designation,Company\n";
    for (const p of people) csv += [p.name, p.linkedinUrl, null, p.email, p.title, p.company].map(csvCell).join(",") + "\n";
    const name = listName?.trim() || "Apollo";
    const result = await this.opts.importContacts(`${name}.csv`, Buffer.from(csv, "utf8"), name);
    return { sent: people.length, ...result };
  }
}
