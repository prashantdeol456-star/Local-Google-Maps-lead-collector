// Hunter API v2 (https://hunter.io/api-documentation/v2, checked 2026-11-26): account balance,
// Email Finder, Email Verifier, Domain Search. Only builds requests and reads answers; the
// spending rules are in EnrichmentService. The key goes in a header and is never logged.

export const HUNTER_BASE = "https://api.hunter.io/v2";

export class HunterError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when Hunter could not be reached / did not answer in time */
    readonly status: number,
  ) {
    super(message);
  }
}

export interface HunterBalance {
  planName: string | null;
  resetDate: Date | null;
  /** Credits in this period (searches and verifications share them on current plans) */
  used: number;
  available: number;
  overQuota: boolean;
  /** Cost of one search / one verification in credits */
  searchCost: number;
  verifyCost: number;
}

export interface FoundEmail {
  email: string;
  /** Hunter's confidence 0–100 */
  score: number | null;
  /** valid | accept_all | unknown | invalid … (Hunter's last check) */
  verification: string | null;
  position: string | null;
  sources: number;
}

export interface VerifiedEmail {
  email: string;
  /** valid | invalid | accept_all | webmail | disposable | unknown */
  status: string;
  score: number | null;
}

export interface Answer<T> {
  data: T | null;
  /** From the X-Credits-Used header, when Hunter sends it */
  creditsUsed: number | null;
}

type Bucket = { used?: number; available?: number; remaining?: number; over_quota?: number; credit_cost?: number };

export class HunterClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async get<T>(key: string, path: string, params: Record<string, string>): Promise<{ body: T; creditsUsed: number | null }> {
    const url = new URL(`${HUNTER_BASE}/${path}`);
    url.search = new URLSearchParams(params).toString();
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { "X-API-KEY": key, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
    } catch {
      throw new HunterError("Hunter did not answer in time", 0);
    }
    const body = (await res.json().catch(() => null)) as (T & { errors?: { details?: string; id?: string }[] }) | null;
    if (!res.ok || !body) {
      const detail = body?.errors?.[0]?.details ?? `HTTP ${res.status}`;
      throw new HunterError(`Hunter: ${detail}`, res.status);
    }
    const used = Number(res.headers.get("x-credits-used"));
    return { body, creditsUsed: Number.isFinite(used) && res.headers.has("x-credits-used") ? used : null };
  }

  /** Plan and credits; this call itself is free. */
  async balance(key: string): Promise<HunterBalance> {
    const { body } = await this.get<{ data?: { plan_name?: string; reset_date?: string; requests?: { credits?: Bucket; searches?: Bucket; verifications?: Bucket } } }>(key, "account", {});
    const req = body.data?.requests;
    const credits = req?.credits ?? req?.searches;
    if (!credits || typeof credits.available !== "number" || typeof credits.used !== "number") {
      throw new HunterError("Hunter did not say how many credits are left", 200);
    }
    return {
      planName: body.data?.plan_name ?? null,
      resetDate: body.data?.reset_date ? new Date(body.data.reset_date) : null,
      used: credits.used,
      available: credits.available,
      overQuota: (credits.over_quota ?? 0) > 0,
      searchCost: req?.searches?.credit_cost ?? 1,
      verifyCost: req?.verifications?.credit_cost ?? 0.5,
    };
  }

  async findEmail(key: string, q: { fullName: string; domain?: string | null; company?: string | null; linkedinHandle?: string | null }): Promise<Answer<FoundEmail>> {
    const params: Record<string, string> = { full_name: q.fullName };
    if (q.domain) params.domain = q.domain;
    else if (q.company) params.company = q.company;
    if (q.linkedinHandle) params.linkedin_handle = q.linkedinHandle;
    const { body, creditsUsed } = await this.get<{ data?: { email?: string | null; score?: number; position?: string | null; verification?: { status?: string | null }; sources?: unknown[] } }>(key, "email-finder", params);
    const d = body.data;
    return {
      creditsUsed,
      data: d?.email ? { email: d.email.toLowerCase(), score: d.score ?? null, verification: d.verification?.status ?? null, position: d.position ?? null, sources: d.sources?.length ?? 0 } : null,
    };
  }

  async verify(key: string, email: string): Promise<Answer<VerifiedEmail>> {
    const { body, creditsUsed } = await this.get<{ data?: { email?: string; status?: string; score?: number } }>(key, "email-verifier", { email });
    const d = body.data;
    return { creditsUsed, data: d?.status ? { email: (d.email ?? email).toLowerCase(), status: d.status, score: d.score ?? null } : null };
  }

  async domainEmails(key: string, domain: string, limit: number): Promise<Answer<FoundEmail[]>> {
    const { body, creditsUsed } = await this.get<{ data?: { emails?: { value?: string; confidence?: number; position?: string | null; verification?: { status?: string | null }; sources?: unknown[] }[] } }>(
      key,
      "domain-search",
      { domain, limit: String(limit) },
    );
    const emails = (body.data?.emails ?? [])
      .filter((e) => e.value)
      .map((e) => ({ email: e.value!.toLowerCase(), score: e.confidence ?? null, verification: e.verification?.status ?? null, position: e.position ?? null, sources: e.sources?.length ?? 0 }));
    return { creditsUsed, data: emails };
  }
}
