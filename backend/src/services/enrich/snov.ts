// Snov.io REST API (https://snov.io/api, checked 2026-11-26). Only builds requests and reads
// answers; the spending rules are in SnovService. The client secret and tokens are never logged.
//
//   Token     POST /v1/oauth/access_token (grant_type=client_credentials, client_id, client_secret)
//             → access_token, valid for expires_in seconds (3600).
//   Balance   GET  /v1/get-balance → data.balance (credits left), data.limit_resets_in (days). Free.
//   Finder    POST /v2/emails-by-domain-by-name/start {rows:[{first_name,last_name,domain}]} → task_hash,
//             then GET /v2/emails-by-domain-by-name/result?task_hash=… until status is "completed".
//             1 credit for each email returned with a valid or unknown status.
// Free Snov.io plans get API access only after asking Snov (test access); paid plans have it.

export const SNOV_BASE = "https://api.snov.io";

export class SnovError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when Snov could not be reached / did not answer in time; 402 = not enough credits */
    readonly status: number,
  ) {
    super(message);
  }
}

export interface SnovBalance {
  balance: number;
  resetsInDays: number | null;
}

export interface SnovEmail {
  email: string;
  /** valid | unknown */
  status: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SnovClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly opts: { pollMs?: number; maxPolls?: number } = {},
  ) {}

  private async call<T>(url: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(25_000) });
    } catch {
      throw new SnovError("Snov.io did not answer in time", 0);
    }
    const body = (await res.json().catch(() => null)) as (T & { message?: string; error?: string; error_description?: string }) | null;
    if (!res.ok || !body) {
      const detail = body?.error_description ?? body?.message ?? body?.error ?? `HTTP ${res.status}`;
      throw new SnovError(`Snov.io: ${detail}`, res.status);
    }
    return body;
  }

  async token(clientId: string, clientSecret: string): Promise<{ token: string; expiresIn: number }> {
    const body = await this.call<{ access_token?: string; expires_in?: number }>(`${SNOV_BASE}/v1/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
    });
    if (!body.access_token) throw new SnovError("Snov.io did not give an access token", 401);
    return { token: body.access_token, expiresIn: body.expires_in ?? 3600 };
  }

  async balance(token: string): Promise<SnovBalance> {
    const body = await this.call<{ success?: boolean; data?: { balance?: string | number; limit_resets_in?: number } }>(`${SNOV_BASE}/v1/get-balance`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const balance = Number(body.data?.balance);
    if (!Number.isFinite(balance)) throw new SnovError("Snov.io did not say how many credits are left", 200);
    return { balance, resetsInDays: typeof body.data?.limit_resets_in === "number" ? body.data.limit_resets_in : null };
  }

  /** A person's emails from their name and company domain (1 credit per email returned). */
  async findEmail(token: string, q: { firstName: string; lastName: string; domain: string }): Promise<SnovEmail[]> {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
    const start = await this.call<{ data?: { task_hash?: string } }>(`${SNOV_BASE}/v2/emails-by-domain-by-name/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rows: [{ first_name: q.firstName, last_name: q.lastName, domain: q.domain }] }),
    });
    const hash = start.data?.task_hash;
    if (!hash) throw new SnovError("Snov.io did not start the search", 500);
    const polls = this.opts.maxPolls ?? 12;
    for (let i = 0; i < polls; i++) {
      const res = await this.call<{ status?: string; data?: { result?: { email?: string; smtp_status?: string }[] }[] }>(
        `${SNOV_BASE}/v2/emails-by-domain-by-name/result?task_hash=${encodeURIComponent(hash)}`,
        { headers },
      );
      if (res.status === "not_enough_credits") throw new SnovError("Snov.io: not enough credits", 402);
      if (res.status === "completed") {
        return (res.data ?? [])
          .flatMap((p) => p.result ?? [])
          .filter((e): e is { email: string; smtp_status?: string } => typeof e.email === "string" && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e.email))
          .map((e) => ({ email: e.email.toLowerCase(), status: e.smtp_status ?? "unknown" }));
      }
      await wait(this.opts.pollMs ?? 1500);
    }
    // Still running: Snov may count it later, so the caller keeps the credit held.
    throw new SnovError("Snov.io is still searching: try again in a minute", 0);
  }
}
