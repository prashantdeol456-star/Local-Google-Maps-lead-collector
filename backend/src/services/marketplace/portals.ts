// The B2B portals' enquiry APIs: each user's own seller account, read with the key the portal
// gives its paying members. Only the user's own buyer enquiries are read; portal directories are
// never scraped (their terms forbid it, and IndiaMART blocks automated agents).
//
//   IndiaMART  Lead Manager → Import/Export Leads → Pull API key.
//              GET https://mapi.indiamart.com/wservce/crm/crmListing/v2/?glusr_crm_key=…&start_time=…&end_time=…
//              Times "DD-Mon-YYYYHH:MM:SS" (IST), at most 7 days per call, at most one call every 5 minutes.
//   TradeIndia Dashboard → Inquiries & Contacts → My Inquiry API (User ID, Profile ID, Key).
//              GET https://www.tradeindia.com/utils/my_inquiry.html?userid=…&profile_id=…&key=…&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
//   Other      The full enquiry API link from the portal's member panel (ExportersIndia, …): its
//              JSON answer is read by recognising the usual field names.

export type PortalKind = "indiamart" | "tradeindia" | "custom";

export interface PortalLead {
  externalId: string;
  name: string;
  mobile: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  product: string | null;
  subject: string | null;
  message: string | null;
  queryType: string | null;
  receivedAt: Date;
}

export class PortalError extends Error {
  constructor(
    message: string,
    /** false: the key/settings are wrong (no use trying again until they are fixed) */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_MS = 5.5 * 60 * 60 * 1000;

/** IndiaMART's time format, in Indian time: "05-Nov-202614:30:00". */
export function indiamartTime(d: Date): string {
  const t = new Date(d.getTime() + IST_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()}${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

/** "2026-11-05 14:30:00" (IST, as the portals write it) → Date. */
export function parseIstTime(v: unknown): Date | null {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(s);
  if (!m) return null;
  const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) - IST_MS;
  return Number.isFinite(utc) ? new Date(utc) : null;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s && !/^(null|undefined|na|n\/a|-)$/i.test(s) ? s : null;
};

/** "+91-9810012345" → "+919810012345"; bare 10-digit Indian numbers get +91. */
export function cleanMobile(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return d.length >= 8 ? (s.trim().startsWith("+") ? `+${d}` : d) : null;
}

const cleanEmail = (v: unknown) => {
  const s = str(v)?.toLowerCase() ?? null;
  return s && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : null;
};

/** One enquiry from an object, by the field names portals use (also used for "Other" portals). */
export function leadFromRecord(r: Record<string, unknown>): PortalLead | null {
  const keys = Object.keys(r);
  const pick = (...patterns: RegExp[]) => {
    for (const re of patterns) {
      const k = keys.find((key) => re.test(key));
      if (k !== undefined) {
        const v = str(r[k]);
        if (v) return v;
      }
    }
    return null;
  };
  const externalId = pick(/^unique_query_id$/i, /^rfi_id$/i, /^(inquiry|enquiry|query|lead)_?id$/i, /^id$/i);
  const name = pick(/^sender_name$/i, /^(buyer|customer|contact)_?name$/i, /^name$/i);
  if (!externalId || !name) return null;
  const date = pick(/^query_time$/i, /^(generated|inquiry|enquiry|created|received)_?(date|time|on|at)?$/i, /^date$/i);
  const time = pick(/^generated_time$/i);
  return {
    externalId,
    name,
    mobile: cleanMobile(pick(/^sender_mobile$/i, /mobile/i, /^(phone|contact)_?(no|number)?$/i, /phone/i)),
    email: cleanEmail(pick(/^sender_email$/i, /e_?mail/i)),
    company: pick(/^sender_company$/i, /^sender_co$/i, /company|organi[sz]ation|firm/i),
    city: pick(/^sender_city$/i, /city/i),
    state: pick(/^sender_state$/i, /state/i),
    country: pick(/^sender_country_iso$/i, /country/i),
    product: pick(/^query_product_name$/i, /^product_?name$/i, /product/i),
    subject: pick(/^subject$/i, /^query_mcat_name$/i, /subject|title/i),
    message: pick(/^query_message$/i, /^message$/i, /message|requirement|description|details/i),
    queryType: pick(/^query_type$/i, /^inquiry_type$/i, /type/i),
    receivedAt: parseIstTime(date && time && !/\d{2}:\d{2}/.test(date) ? `${date} ${time}` : date) ?? new Date(),
  };
}

/** The list of enquiries in a JSON answer, wherever the portal put it. */
function recordsIn(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  if (body && typeof body === "object") {
    for (const k of ["RESPONSE", "data", "inquiries", "enquiries", "leads", "result", "results", "records"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return recordsIn(v);
    }
  }
  return [];
}

export interface PortalConfig {
  /** IndiaMART: CRM key. TradeIndia: key. */
  key?: string;
  userId?: string;
  profileId?: string;
  /** Other: the full API link from the member panel */
  url?: string;
}

export class PortalClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    /** Other portals' links: must be public https sites (checked before every call). */
    private readonly isPublic: (url: string) => Promise<boolean> = async () => true,
  ) {}

  private async getJson(url: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new PortalError("The portal did not answer in time", true);
    }
    const text = await res.text();
    if (res.status === 429) throw new PortalError("The portal asks to wait between checks (IndiaMART: at most once every 5 minutes)", true);
    if (res.status === 401 || res.status === 403) throw new PortalError("The portal refused the key: check it in the portal's member panel", false);
    if (!res.ok) throw new PortalError(`The portal answered HTTP ${res.status}`, res.status >= 500);
    try {
      return JSON.parse(text);
    } catch {
      throw new PortalError("The portal did not send enquiries (not JSON): check the key / link", false);
    }
  }

  /** Enquiries received between `from` and `to` (at most 7 days apart). */
  async enquiries(kind: PortalKind, config: PortalConfig, from: Date, to: Date): Promise<PortalLead[]> {
    if (kind === "indiamart") {
      if (!config.key) throw new PortalError("Add the IndiaMART CRM key", false);
      const url = new URL("https://mapi.indiamart.com/wservce/crm/crmListing/v2/");
      url.search = new URLSearchParams({ glusr_crm_key: config.key, start_time: indiamartTime(from), end_time: indiamartTime(to) }).toString();
      const body = (await this.getJson(url.href)) as { CODE?: number; STATUS?: string; MESSAGE?: string; RESPONSE?: unknown };
      // 204 = no enquiries in this time; anything else but 200 is a problem with the key or the call.
      if (body.CODE === 204) return [];
      if (body.CODE !== undefined && body.CODE !== 200) {
        const msg = body.MESSAGE ?? `code ${body.CODE}`;
        throw new PortalError(`IndiaMART: ${msg}`, body.CODE === 429 || /once in every|too many|frequent/i.test(msg));
      }
      return recordsIn(body).map(leadFromRecord).filter((l): l is PortalLead => !!l);
    }
    if (kind === "tradeindia") {
      if (!config.key || !config.userId || !config.profileId) throw new PortalError("Add the TradeIndia User ID, Profile ID and Key", false);
      const day = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
      const out: PortalLead[] = [];
      for (let page = 1; page <= 10; page++) {
        const url = new URL("https://www.tradeindia.com/utils/my_inquiry.html");
        url.search = new URLSearchParams({ userid: config.userId, profile_id: config.profileId, key: config.key, from_date: day(from), to_date: day(to), limit: "50", page_no: String(page) }).toString();
        const body = await this.getJson(url.href);
        if (body && typeof body === "object" && !Array.isArray(body) && /invalid|unauthori[sz]ed|wrong/i.test(JSON.stringify(body).slice(0, 300))) {
          throw new PortalError("TradeIndia refused the User ID / Profile ID / Key", false);
        }
        const rows = recordsIn(body);
        out.push(...rows.map(leadFromRecord).filter((l): l is PortalLead => !!l && l.receivedAt >= new Date(from.getTime() - 24 * 3600_000)));
        if (rows.length < 50) break;
      }
      return out;
    }
    if (!config.url || !/^https:\/\//i.test(config.url)) throw new PortalError("Paste the portal's https API link", false);
    if (!(await this.isPublic(config.url))) throw new PortalError("That link does not point to a public website", false);
    return recordsIn(await this.getJson(config.url)).map(leadFromRecord).filter((l): l is PortalLead => !!l);
  }
}
