// Apollo.io REST API (https://docs.apollo.io, checked 2026-11-26). Only builds requests and reads
// answers; the spending rules are in ApolloService. The key goes in a header and is never logged.
//
//   People API Search  POST /api/v1/mixed_people/api_search  0 credits; no emails or phones,
//                      last names hidden ("Ve***a"); 100 per page, up to 500 pages.
//   People Enrichment  POST /api/v1/people/match?id=…        1 credit when a person/email is
//                      returned (work email only; personal emails and phones are never asked for).
//   Credit usage       POST /api/v1/usage_stats/credit_usage_stats  0 credits; lead_credit pays
//                      for email reveals.
// Apollo API keys are limited to the endpoints ticked when the key is made: these three are needed.

export const APOLLO_BASE = "https://api.apollo.io/api/v1";

export class ApolloError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when Apollo could not be reached / did not answer in time */
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ApolloCredits {
  limit: number;
  used: number;
  left: number;
  cycleEnd: Date | null;
}

export interface ApolloFilters {
  titles?: string[];
  seniorities?: string[];
  personLocations?: string[];
  organizationLocations?: string[];
  domains?: string[];
  keywords?: string | null;
  employeeRanges?: string[];
}

export interface ApolloPerson {
  id: string;
  firstName: string;
  /** Hidden by Apollo until the person is revealed, e.g. "Ve***a" */
  lastName: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  hasEmail: boolean;
  hasLocation: boolean;
}

export interface RevealedPerson {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  domain: string | null;
  email: string | null;
  /** verified | likely to engage | unverified | unavailable … */
  emailStatus: string | null;
  linkedinUrl: string | null;
  city: string | null;
  country: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const domainOf = (o: Record<string, unknown> | undefined) => str(o?.primary_domain) ?? (str(o?.website_url)?.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/.*$/, "") || null);

export class ApolloClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async post<T>(key: string, path: string, params: [string, string][] = []): Promise<T> {
    const url = new URL(`${APOLLO_BASE}/${path}`);
    for (const [k, v] of params) url.searchParams.append(k, v);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json", Accept: "application/json", "Cache-Control": "no-cache" }, body: "{}", signal: AbortSignal.timeout(25_000) });
    } catch {
      throw new ApolloError("Apollo did not answer in time", 0);
    }
    const body = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
    if (!res.ok || !body) {
      const detail = body?.error ?? body?.message ?? `HTTP ${res.status}`;
      throw new ApolloError(`Apollo: ${detail}`, res.status);
    }
    return body;
  }

  /** Email credits in this billing cycle; this call itself is free. */
  async credits(key: string): Promise<ApolloCredits> {
    const body = await this.post<{ credit_usage_stats?: Record<string, { limit?: number; consumed?: number; left_over?: number }>; current_credit_cycle?: { end_date?: string | null } }>(key, "usage_stats/credit_usage_stats");
    const lead = body.credit_usage_stats?.lead_credit;
    if (!lead || typeof lead.limit !== "number") throw new ApolloError("Apollo did not say how many credits are left", 200);
    const used = lead.consumed ?? 0;
    return { limit: lead.limit, used, left: lead.left_over ?? Math.max(0, lead.limit - used), cycleEnd: body.current_credit_cycle?.end_date ? new Date(body.current_credit_cycle.end_date) : null };
  }

  /** People matching the filters (free; no emails). */
  async search(key: string, f: ApolloFilters, page: number, perPage: number): Promise<{ total: number; people: ApolloPerson[] }> {
    const params: [string, string][] = [];
    const list = (name: string, values?: string[]) => values?.forEach((v) => v.trim() && params.push([`${name}[]`, v.trim()]));
    list("person_titles", f.titles);
    list("person_seniorities", f.seniorities);
    list("person_locations", f.personLocations);
    list("organization_locations", f.organizationLocations);
    list("q_organization_domains_list", f.domains);
    list("organization_num_employees_ranges", f.employeeRanges);
    if (f.keywords?.trim()) params.push(["q_keywords", f.keywords.trim()]);
    params.push(["page", String(page)], ["per_page", String(perPage)]);
    const body = await this.post<{ total_entries?: number; people?: Record<string, unknown>[] }>(key, "mixed_people/api_search", params);
    const people = (body.people ?? [])
      .map((p): ApolloPerson | null => {
        const id = str(p.id);
        const firstName = str(p.first_name);
        if (!id || !firstName) return null;
        const org = p.organization as Record<string, unknown> | undefined;
        return {
          id,
          firstName,
          lastName: str(p.last_name_obfuscated) ?? str(p.last_name),
          title: str(p.title),
          company: str(org?.name),
          domain: domainOf(org),
          hasEmail: p.has_email === true,
          hasLocation: p.has_city === true || p.has_country === true,
        };
      })
      .filter((p): p is ApolloPerson => !!p);
    return { total: body.total_entries ?? people.length, people };
  }

  /** One person's full name and work email (1 credit when Apollo returns them). */
  async reveal(key: string, id: string): Promise<RevealedPerson | null> {
    const body = await this.post<{ person?: Record<string, unknown> | null }>(key, "people/match", [
      ["id", id],
      ["reveal_personal_emails", "false"],
      ["reveal_phone_number", "false"],
    ]);
    const p = body.person;
    if (!p || p.match_confidence === "none") return null;
    const org = p.organization as Record<string, unknown> | undefined;
    const email = str(p.email)?.toLowerCase() ?? null;
    return {
      id,
      name: str(p.name) ?? [str(p.first_name), str(p.last_name)].filter(Boolean).join(" "),
      title: str(p.title),
      company: str(org?.name),
      domain: domainOf(org),
      email: email && !/^email_not_unlocked@/.test(email) && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) ? email : null,
      emailStatus: str(p.email_status),
      linkedinUrl: str(p.linkedin_url),
      city: str(p.city),
      country: str(p.country),
    };
  }
}
