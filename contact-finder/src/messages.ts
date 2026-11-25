import type { Contact, Sighting } from "./core/contacts";
import type { PageReading } from "./content/index";
import type { Settings } from "./storage/contacts";

// Messages between the side panel and the background service worker.

export type PanelRequest =
  | { type: "CF_STATUS" }
  | { type: "CF_LOGIN"; backendUrl: string; email: string; password: string }
  | { type: "CF_LOGOUT" }
  | { type: "CF_TAB" }
  | { type: "CF_SAVE"; sighting: Sighting }
  | { type: "CF_CRAWL" }
  | { type: "CF_LIST" }
  | { type: "CF_DELETE"; ids: string[] | "all" }
  | { type: "CF_SETTINGS" }
  | { type: "CF_SET_SETTINGS"; patch: Partial<Settings> }
  | { type: "CF_SEND"; ids: string[]; listName: string | null }
  | { type: "CF_ENRICH_STATUS" }
  | { type: "CF_FIND_EMAIL"; sighting: Sighting; domain: string | null }
  | { type: "CF_DOMAIN_EMAILS"; sighting: Sighting; domain: string }
  | { type: "CF_VERIFY"; sighting: Sighting; email: string };

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export interface TabInfo {
  tabId: number | null;
  url: string | null;
  /** The page could not be read (chrome:// page, no access yet…) */
  readable: boolean;
  /** Site access is needed to read this tab: the panel offers to allow it */
  needsAccess: string | null;
  reading: PageReading | null;
  /** Saved contact for this page, if any */
  saved: Contact | null;
}

export interface SendResult {
  sent: number;
  created: number;
  updated: number;
}

/** The platform's Email finder status (GET /api/enrich/status), as far as the panel needs it. */
export interface EnrichStatus {
  configured: boolean;
  status: "ok" | "disabled" | "error" | null;
  statusReason: string | null;
  credits: { used: number; available: number; left: number; held: number } | null;
  exhaustedUntil: string | null;
}

export interface EnrichResult {
  status: "found" | "not_found" | "cached";
  emails: string[];
  creditsLeft: number | null;
}
