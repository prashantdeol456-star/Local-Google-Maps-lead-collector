// Snov.io as the second email finder, with the user's own Snov.io API credentials. Used when
// Hunter cannot answer (no Hunter key, key switched off, or Hunter credits used up), and only for
// a person's name + company website.
//
// Same "zero-cost gateway" rules as Hunter and Apollo:
//   - no credentials, switched off, or unknown credits → no request;
//   - the balance is read first (free); a search is sent only if credits left − credits held for
//     unfinished searches − a 10 % safety margin (of the most credits seen) covers it;
//   - 1 credit is held first, then settled with the number of emails Snov returned;
//   - a search that did not finish keeps its credit held; a refused login switches the key off;
//   - the same question within 30 days is answered from the ledger.

import type { PrismaClient } from "../../generated/prisma/client.js";
import { ownerScope } from "../../database/ownerScope.js";
import { Errors } from "../../utils/errors.js";
import type { SecretBox } from "../../utils/secretBox.js";
import { CACHE_DAYS, SAFETY_MARGIN, type LookupOutcome } from "./enrichmentService.js";
import type { FoundEmail } from "./hunter.js";
import { SnovError, type SnovBalance, type SnovClient } from "./snov.js";

const PROVIDER = "snov";
const DAY = 24 * 60 * 60 * 1000;
const ownerKey = () => ownerScope.getStore()?.userId ?? "default";

export class SnovService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly tokens = new Map<string, { token: string; until: number }>();

  constructor(
    private readonly db: PrismaClient,
    private readonly snov: SnovClient,
    private readonly box: SecretBox,
    private readonly opts: { now?: () => Date } = {},
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

  async status() {
    const acc = await this.db.snovAccount.findUnique({ where: { id: ownerKey() } });
    return {
      configured: !!acc,
      keyHint: acc?.keyHint ?? null,
      status: acc?.status ?? null,
      statusReason: acc?.statusReason ?? null,
      credits: acc && acc.credits !== null ? { left: acc.credits, held: await this.heldUnits(), margin: this.margin(acc.creditsPeak ?? acc.credits) } : null,
      resetDate: acc?.resetDate ?? null,
      checkedAt: acc?.checkedAt ?? null,
    };
  }

  private margin(peak: number) {
    return Math.max(1, Math.ceil(peak * SAFETY_MARGIN));
  }

  /** Saves (or removes, with null) the user's Snov.io API credentials after checking them. */
  async setKey(input: { clientId: string; clientSecret: string } | null) {
    const id = ownerKey();
    this.tokens.delete(id);
    if (input === null) {
      await this.db.snovAccount.deleteMany({ where: { id } });
      return this.status();
    }
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientId) || !/^[A-Za-z0-9_-]{8,100}$/.test(clientSecret)) {
      throw Errors.badRequest("Paste the User ID and Secret from Snov.io → Settings → API");
    }
    let balance: SnovBalance;
    try {
      const { token, expiresIn } = await this.snov.token(clientId, clientSecret);
      this.tokens.set(id, { token, until: Date.now() + (expiresIn - 60) * 1000 });
      balance = await this.snov.balance(token);
    } catch (err) {
      throw this.userError(err);
    }
    const data = {
      keyEnc: this.box.seal(JSON.stringify({ clientId, clientSecret })),
      keyHint: `…${clientId.slice(-4)}`,
      status: "ok",
      statusReason: null,
      ...this.balanceFields(balance, null),
    };
    await this.db.snovAccount.upsert({ where: { id }, create: { id, ...data }, update: data });
    return this.status();
  }

  private balanceFields(b: SnovBalance, peak: number | null) {
    const reset = b.resetsInDays !== null ? new Date(this.now().getTime() + b.resetsInDays * DAY) : null;
    return { credits: b.balance, creditsPeak: Math.max(peak ?? 0, b.balance), resetDate: reset, checkedAt: this.now() };
  }

  async refresh() {
    await this.serial(async () => {
      const acc = await this.account();
      await this.readBalance(acc);
    });
    return this.status();
  }

  /** Can Snov be asked now? (configured and not switched off) */
  async usable(): Promise<boolean> {
    const acc = await this.db.snovAccount.findUnique({ where: { id: ownerKey() } });
    return !!acc && acc.status !== "disabled";
  }

  private async account() {
    const acc = await this.db.snovAccount.findUnique({ where: { id: ownerKey() } });
    if (!acc) throw Errors.badRequest("Add your Snov.io API credentials first (Email finder page)");
    if (acc.status === "disabled") throw Errors.conflict("SNOV_DISABLED", `Snov.io key switched off: ${acc.statusReason ?? "save it again to use it"}`);
    return acc;
  }

  private async token(acc: { id: string; keyEnc: string }): Promise<string> {
    const cached = this.tokens.get(acc.id);
    if (cached && cached.until > Date.now()) return cached.token;
    const { clientId, clientSecret } = JSON.parse(this.box.open(acc.keyEnc)) as { clientId: string; clientSecret: string };
    const { token, expiresIn } = await this.snov.token(clientId, clientSecret);
    this.tokens.set(acc.id, { token, until: Date.now() + (expiresIn - 60) * 1000 });
    return token;
  }

  private async readBalance(acc: { id: string; keyEnc: string; creditsPeak: number | null }): Promise<SnovBalance> {
    try {
      const b = await this.snov.balance(await this.token(acc));
      await this.db.snovAccount.update({ where: { id: acc.id }, data: { ...this.balanceFields(b, acc.creditsPeak), status: "ok", statusReason: null } });
      return b;
    } catch (err) {
      await this.failed(acc.id, err);
      throw this.userError(err);
    }
  }

  private async heldUnits(): Promise<number> {
    const since = new Date(this.now().getTime() - 31 * DAY);
    const rows = await this.db.enrichLookup.findMany({ where: { provider: PROVIDER, status: { in: ["reserved", "unknown"] }, createdAt: { gte: since } }, select: { reservedUnits: true } });
    return rows.reduce((a, r) => a + r.reservedUnits, 0);
  }

  private async failed(id: string, err: unknown) {
    if (err instanceof SnovError && (err.status === 401 || err.status === 403)) {
      this.tokens.delete(id);
      await this.db.snovAccount.update({ where: { id }, data: { status: "disabled", statusReason: "Snov.io refused the API credentials (or API access is not on for this plan). Save them again." } });
    }
  }

  private userError(err: unknown) {
    if (!(err instanceof SnovError)) return err;
    if (err.status === 401 || err.status === 403 || err.status === 400)
      return Errors.badRequest("Snov.io refused these API credentials. Check User ID and Secret (Settings → API); free Snov.io plans need API access asked from Snov first.");
    if (err.status === 402) return Errors.conflict("NO_CREDITS", "Your Snov.io credits are used up until they renew");
    if (err.status === 429) return Errors.conflict("SNOV_RATE_LIMIT", "Snov.io asks to slow down: try again in a minute");
    return Errors.badRequest(err.message);
  }

  /** A person's work email from their full name and company website (fallback for Hunter). */
  findEmail(fullNameInput: string, domain: string): Promise<LookupOutcome<FoundEmail>> {
    const fullName = fullNameInput.replace(/\s+/g, " ").trim();
    const parts = fullName.split(" ");
    if (parts.length < 2) throw Errors.badRequest("Give the person's first and last name");
    const queryKey = `snov:${fullName.toLowerCase()}|${domain}`;
    return this.serial(async () => {
      const cached = await this.db.enrichLookup.findFirst({
        where: { provider: PROVIDER, queryKey, status: { in: ["done", "not_found"] }, createdAt: { gte: new Date(this.now().getTime() - CACHE_DAYS * DAY) } },
        orderBy: { createdAt: "desc" },
      });
      if (cached) return { status: "cached", result: cached.result ? (JSON.parse(cached.result) as FoundEmail) : null, creditsLeft: null };

      const acc = await this.account();
      const balance = await this.readBalance(acc);
      const margin = this.margin(Math.max(acc.creditsPeak ?? 0, balance.balance));
      const left = balance.balance - (await this.heldUnits()) - margin;
      if (left < 1) {
        await this.db.enrichLookup.create({ data: { provider: PROVIDER, kind: "email_finder", queryKey, reservedUnits: 0, status: "blocked", error: `Not enough Snov.io credits (${balance.balance} left, ${margin} kept as a safety margin)`, settledAt: this.now() } });
        throw Errors.conflict("NO_CREDITS", `Not enough Snov.io credits left (${balance.balance} left, ${margin} kept as a safety margin)`);
      }
      const row = await this.db.enrichLookup.create({ data: { provider: PROVIDER, kind: "email_finder", queryKey, reservedUnits: 1, status: "reserved" } });
      try {
        const emails = await this.snov.findEmail(await this.token(acc), { firstName: parts[0]!, lastName: parts.slice(1).join(" "), domain });
        const best = emails.find((e) => e.status === "valid") ?? emails[0] ?? null;
        const result: FoundEmail | null = best ? { email: best.email, score: best.status === "valid" ? 90 : 50, verification: best.status, position: null, sources: emails.length } : null;
        const used = emails.length;
        await this.db.enrichLookup.update({ where: { id: row.id }, data: { status: result ? "done" : "not_found", usedUnits: used, result: result ? JSON.stringify(result) : null, settledAt: this.now() } });
        await this.db.snovAccount.update({ where: { id: acc.id }, data: { credits: Math.max(0, balance.balance - used) } });
        return { status: result ? "found" : "not_found", result, creditsLeft: Math.max(0, balance.balance - used) };
      } catch (err) {
        const unknown = err instanceof SnovError && (err.status === 0 || err.status >= 500);
        const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
        await this.db.enrichLookup.update({
          where: { id: row.id },
          data: unknown ? { status: "unknown", error: message } : { status: "failed", usedUnits: 0, error: message, settledAt: this.now() },
        });
        await this.failed(acc.id, err);
        throw this.userError(err);
      }
    });
  }
}
