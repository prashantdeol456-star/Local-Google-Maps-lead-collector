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
  | { type: "CF_SEND"; ids: string[]; listName: string | null };

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
