// Email finder for Contact Finder, with the user's own Hunter API key.
//
// Spending rules (from the 360 Contact Intelligence spec v1.1, "zero-cost gateway"):
//   - no key, a disabled key, an unknown plan or unknown credits → no request;
//   - before every paid request the balance is read (free), and the request is sent only if
//     credits left − credits held for unfinished lookups − a 10 % safety margin covers the most
//     it can cost; that amount is held in the ledger first, then settled with what Hunter counted;
//   - never over quota: Hunter's "out of credits" pauses lookups until its reset date;
//   - a lookup that timed out keeps its credits held (it may have been counted);
//   - 401 (bad key) disables the key until it is saved again; 451 (privacy) is never retried;
//   - the same question within 30 days is answered from the ledger, without a request.
// One lookup at a time per user, so two at once cannot both take the last credit.

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/errors.js";
import { ownerScope } from "../../database/ownerScope.js";
import { Errors } from "../../utils/errors.js";
import type { SecretBox } from "../../utils/secretBox.js";
import { HunterError, type FoundEmail, type HunterBalance, type HunterClient, type VerifiedEmail } from "./hunter.js";

export const CACHE_DAYS = 30;
export const SAFETY_MARGIN = 0.1;
export const MAX_DOMAIN_EMAILS = 5;
const HELD_STATUSES = ["reserved", "unknown"];
const DAY = 24 * 60 * 60 * 1000;

export type LookupKind = "email_finder" | "email_verifier" | "domain_search";

export interface LookupOutcome<T> {
  /** found / not_found: answered (credits counted only when found); cached: from an earlier lookup */
  status: "found" | "not_found" | "cached";
  result: T | null;
  creditsLeft: number | null;
}

const ownerKey = () => ownerScope.getStore()?.userId ?? "default";
const keyHint = (key: string) => `…${key.slice(-4)}`;

/** "https://www.Acme.co.in/about" → "acme.co.in" */
export function cleanDomain(input: string | null | undefined): string | null {
  const raw = input?.trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/(^|\.)(linkedin\.com|facebook\.com|instagram\.com|google\.com|gmail\.com|yahoo\.com|outlook\.com|hotmail\.com)$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** "https://www.linkedin.com/in/asha-verma-12/" → "asha-verma-12" */
export function linkedinHandle(url: string | null | undefined): string | null {
  const m = url ? /linkedin\.com\/in\/([^/?#]+)/i.exec(url) : null;
  return m ? decodeURIComponent(m[1]!).toLowerCase() : null;
}

export class EnrichmentService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: PrismaClient,
    private readonly hunter: HunterClient,
    private readonly box: SecretBox,
    private readonly opts: {
      now?: () => Date;
      /** Second provider (Snov.io) for name + website, used when Hunter cannot answer; null when it is not set up. */
      fallback?: { usable: () => Promise<boolean>; findEmail: (fullName: string, domain: string) => Promise<LookupOutcome<FoundEmail>> };
    } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /** One lookup at a time per user. */
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
    const acc = await this.db.hunterAccount.findUnique({ where: { id: ownerKey() } });
    const since = new Date(this.now().getTime() - 31 * DAY);
    const [recent, held] = await Promise.all([
      this.db.enrichLookup.findMany({ where: { provider: "hunter", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 20 }),
      this.heldUnits(),
    ]);
    return {
      configured: !!acc,
      keyHint: acc?.keyHint ?? null,
      status: acc?.status ?? null,
      statusReason: acc?.statusReason ?? null,
      planName: acc?.planName ?? null,
      credits: acc && acc.creditsAvailable !== null ? { used: acc.creditsUsed ?? 0, available: acc.creditsAvailable, left: Math.max(0, acc.creditsAvailable - (acc.creditsUsed ?? 0)), held } : null,
      resetDate: acc?.resetDate ?? null,
      exhaustedUntil: acc?.exhaustedUntil && acc.exhaustedUntil > this.now() ? acc.exhaustedUntil : null,
      checkedAt: acc?.checkedAt ?? null,
      recent: recent.map((r) => ({ id: r.id, kind: r.kind, query: r.queryKey.replace(/^[a-z]+:/, ""), status: r.status, reservedUnits: r.reservedUnits, usedUnits: r.usedUnits, error: r.error, createdAt: r.createdAt })),
    };
  }

  /** Saves (or removes, with null) the user's Hunter key after checking it with Hunter. */
  async setKey(key: string | null) {
    const id = ownerKey();
    if (key === null) {
      await this.db.hunterAccount.deleteMany({ where: { id } });
      return this.status();
    }
    const trimmed = key.trim();
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(trimmed)) throw Errors.badRequest("That does not look like a Hunter API key (Hunter → API → API keys)");
    let balance: HunterBalance;
    try {
      balance = await this.hunter.balance(trimmed);
    } catch (err) {
      throw Errors.badRequest(err instanceof HunterError && err.status === 401 ? "Hunter does not accept this key" : err instanceof Error ? err.message : String(err));
    }
    const data = {
      keyEnc: this.box.seal(trimmed),
      keyHint: keyHint(trimmed),
      status: "ok",
      statusReason: null,
      ...this.balanceFields(balance),
    };
    await this.db.hunterAccount.upsert({ where: { id }, create: { id, ...data }, update: data });
    return this.status();
  }

  private balanceFields(b: HunterBalance) {
    return {
      planName: b.planName,
      creditsUsed: b.used,
      creditsAvailable: b.available,
      resetDate: b.resetDate,
      exhaustedUntil: b.overQuota || b.used >= b.available ? (b.resetDate ?? new Date(this.now().getTime() + DAY)) : null,
      checkedAt: this.now(),
    };
  }

  async refresh() {
    await this.serial(async () => {
      const acc = await this.account();
      await this.readBalance(acc.id, this.box.open(acc.keyEnc));
    });
    return this.status();
  }

  private async account() {
    const acc = await this.db.hunterAccount.findUnique({ where: { id: ownerKey() } });
    if (!acc) throw Errors.badRequest("Add your Hunter API key first (Email finder page in the admin panel)");
    if (acc.status === "disabled") throw Errors.conflict("HUNTER_DISABLED", `Hunter key switched off: ${acc.statusReason ?? "save it again to use it"}`);
    return acc;
  }

  private async readBalance(id: string, key: string): Promise<HunterBalance> {
    try {
      const b = await this.hunter.balance(key);
      await this.db.hunterAccount.update({ where: { id }, data: { ...this.balanceFields(b), status: "ok", statusReason: null } });
      return b;
    } catch (err) {
      await this.failed(id, err);
      throw this.userError(err);
    }
  }

  /** Credits held for lookups that are not settled yet (sent, answer unknown). */
  private async heldUnits(): Promise<number> {
    const since = new Date(this.now().getTime() - 31 * DAY);
    const rows = await this.db.enrichLookup.findMany({ where: { provider: "hunter", status: { in: HELD_STATUSES }, createdAt: { gte: since } }, select: { reservedUnits: true } });
    return rows.reduce((a, r) => a + r.reservedUnits, 0);
  }

  private async failed(id: string, err: unknown) {
    if (!(err instanceof HunterError)) return;
    if (err.status === 401) await this.db.hunterAccount.update({ where: { id }, data: { status: "disabled", statusReason: "Hunter rejected the key (401). Save a working key again." } });
    else if (err.status === 402) await this.db.hunterAccount.update({ where: { id }, data: { status: "disabled", statusReason: "Hunter asked for payment (402). Lookups stopped; nothing paid is ever used." } });
    else if (err.status === 429) {
      const acc = await this.db.hunterAccount.findUnique({ where: { id } });
      await this.db.hunterAccount.update({ where: { id }, data: { exhaustedUntil: acc?.resetDate && acc.resetDate > this.now() ? acc.resetDate : new Date(this.now().getTime() + DAY) } });
    }
  }

  private userError(err: unknown) {
    if (!(err instanceof HunterError)) return err;
    if (err.status === 429) return Errors.conflict("NO_CREDITS", "Your Hunter credits are used up until they renew");
    if (err.status === 401) return Errors.conflict("HUNTER_DISABLED", "Hunter rejected the key: save it again on the Email finder page");
    if (err.status === 451) return Errors.badRequest("Hunter cannot give details for this person (privacy request)");
    return Errors.badRequest(err.message);
  }

  // ---- Lookups ----

  /**
   * The gateway: cached answer, or balance check → hold the most it can cost → request → settle.
   * `cost(balance)` is the most one request can cost; `counted(answer)` what it cost when Hunter
   * sends no X-Credits-Used header.
   */
  private lookup<T>(kind: LookupKind, queryKey: string, cost: (b: HunterBalance) => number, call: (key: string) => Promise<{ data: T | null; creditsUsed: number | null }>, counted: (data: T | null, b: HunterBalance) => number): Promise<LookupOutcome<T>> {
    return this.serial(async () => {
      const cached = await this.db.enrichLookup.findFirst({
        where: { queryKey, status: { in: ["done", "not_found"] }, createdAt: { gte: new Date(this.now().getTime() - CACHE_DAYS * DAY) } },
        orderBy: { createdAt: "desc" },
      });
      if (cached) return { status: "cached", result: cached.result ? (JSON.parse(cached.result) as T) : null, creditsLeft: null };

      const acc = await this.account();
      if (acc.exhaustedUntil && acc.exhaustedUntil > this.now()) throw Errors.conflict("NO_CREDITS", `Your Hunter credits are used up until ${acc.exhaustedUntil.toISOString().slice(0, 10)}`);
      const key = this.box.open(acc.keyEnc);
      const balance = await this.readBalance(acc.id, key);
      const worst = cost(balance);
      const held = await this.heldUnits();
      const margin = Math.ceil(balance.available * SAFETY_MARGIN);
      const left = balance.available - balance.used - held - margin;
      if (balance.overQuota || left < worst) {
        await this.db.enrichLookup.create({ data: { kind, queryKey, reservedUnits: 0, status: "blocked", error: `Not enough credits (${Math.max(0, left)} free after a ${margin}-credit safety margin, needs up to ${worst})`, settledAt: this.now() } });
        throw Errors.conflict("NO_CREDITS", `Not enough Hunter credits left (needs up to ${worst}; ${Math.max(0, balance.available - balance.used)} left, ${margin} kept as a safety margin)`);
      }

      const row = await this.db.enrichLookup.create({ data: { kind, queryKey, reservedUnits: worst, status: "reserved" } });
      try {
        const answer = await call(key);
        const used = answer.creditsUsed ?? counted(answer.data, balance);
        const found = Array.isArray(answer.data) ? answer.data.length > 0 : !!answer.data;
        await this.db.enrichLookup.update({
          where: { id: row.id },
          data: { status: found ? "done" : "not_found", usedUnits: used, result: answer.data ? JSON.stringify(answer.data) : null, settledAt: this.now() },
        });
        const creditsLeft = Math.max(0, balance.available - balance.used - used);
        await this.db.hunterAccount.update({ where: { id: acc.id }, data: { creditsUsed: balance.used + used } });
        return { status: found ? "found" : "not_found", result: answer.data, creditsLeft };
      } catch (err) {
        // A timeout may still have been counted: keep the credits held until Hunter's numbers say otherwise.
        const unknown = err instanceof HunterError && (err.status === 0 || err.status >= 500);
        await this.db.enrichLookup.update({
          where: { id: row.id },
          data: unknown
            ? { status: "unknown", error: err instanceof Error ? err.message.slice(0, 300) : String(err) }
            : { status: "failed", usedUnits: 0, error: err instanceof Error ? err.message.slice(0, 300) : String(err), settledAt: this.now() },
        });
        await this.failed(acc.id, err);
        throw this.userError(err);
      }
    });
  }

  /** Can Hunter be asked now? (key saved, not switched off, credits not used up) */
  private async hunterUsable() {
    const acc = await this.db.hunterAccount.findUnique({ where: { id: ownerKey() } });
    return !!acc && acc.status !== "disabled" && !(acc.exhaustedUntil && acc.exhaustedUntil > this.now());
  }

  /**
   * A person's work email from their name and company (or their LinkedIn profile): Hunter, or
   * Snov.io when Hunter has no key / is switched off / has no credits left and the website is known.
   */
  async findEmail(q: { fullName: string; domain?: string | null; company?: string | null; linkedinUrl?: string | null }): Promise<LookupOutcome<FoundEmail> & { provider: "hunter" | "snov" }> {
    const fb = this.opts.fallback;
    const domain = cleanDomain(q.domain);
    const name = q.fullName.replace(/\s+/g, " ").trim();
    const viaSnov = async () => (fb && domain && name.split(" ").length >= 2 && (await fb.usable()) ? { ...(await fb.findEmail(name, domain)), provider: "snov" as const } : null);
    if (!(await this.hunterUsable())) {
      const r = await viaSnov();
      if (r) return r;
    }
    try {
      return { ...(await this.hunterFindEmail(q)), provider: "hunter" };
    } catch (err) {
      if (err instanceof AppError && (err.code === "NO_CREDITS" || err.code === "HUNTER_DISABLED")) {
        const r = await viaSnov();
        if (r) return r;
      }
      throw err;
    }
  }

  private hunterFindEmail(q: { fullName: string; domain?: string | null; company?: string | null; linkedinUrl?: string | null }) {
    const fullName = q.fullName.replace(/\s+/g, " ").trim();
    const domain = cleanDomain(q.domain);
    const company = q.company?.replace(/\s+/g, " ").trim() || null;
    const handle = linkedinHandle(q.linkedinUrl);
    if (fullName.split(" ").length < 2 && !handle) throw Errors.badRequest("Give the person's first and last name");
    if (!domain && !company && !handle) throw Errors.badRequest("Give the company's website (or name)");
    const key = `finder:${fullName.toLowerCase()}|${domain ?? company?.toLowerCase() ?? ""}|${handle ?? ""}`;
    return this.lookup<FoundEmail>(
      "email_finder",
      key,
      (b) => b.searchCost,
      (k) => this.hunter.findEmail(k, { fullName, domain, company: domain ? null : company, linkedinHandle: handle }),
      (data, b) => (data ? b.searchCost : 0),
    );
  }

  /** Is this email deliverable? */
  verifyEmail(email: string) {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) throw Errors.badRequest("Not an email address");
    return this.lookup<VerifiedEmail>(
      "email_verifier",
      `verify:${e}`,
      (b) => b.verifyCost,
      (k) => this.hunter.verify(k, e),
      (data, b) => (data && data.status !== "unknown" ? b.verifyCost : 0),
    );
  }

  /** Emails Hunter knows at a company's domain (1 credit per email found, at most `limit`). */
  domainEmails(domainInput: string, limit = MAX_DOMAIN_EMAILS) {
    const domain = cleanDomain(domainInput);
    if (!domain) throw Errors.badRequest("Give a company website, e.g. acme.in");
    const n = Math.min(Math.max(1, Math.round(limit)), MAX_DOMAIN_EMAILS);
    return this.lookup<FoundEmail[]>(
      "domain_search",
      `domain:${domain}|${n}`,
      (b) => b.searchCost * n,
      (k) => this.hunter.domainEmails(k, domain, n),
      (data, b) => (data?.length ?? 0) * b.searchCost,
    );
  }
}
