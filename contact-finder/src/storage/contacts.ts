// Saved contacts and settings in chrome.storage.local (only this extension can read it; nothing
// leaves the browser until "Send to Lead Platform"). Writes go one after another, so two pages
// found at the same moment cannot overwrite each other.

import { mergeSighting, trimContacts, type Contact, type Sighting } from "../core/contacts";

const CONTACTS_KEY = "cf-contacts";
const SETTINGS_KEY = "cf-settings";

export interface Settings {
  /** Save what a page shows by itself (otherwise only with the Save button) */
  autoSave: boolean;
  /** Read every website you open (needs "all sites" access), not only LinkedIn */
  allSites: boolean;
  /** When a website shows no email, read up to 4 of its Contact/About pages */
  contactPages: boolean;
  /** Sites never read (domains) */
  skipSites: string[];
}

export const DEFAULT_SETTINGS: Settings = { autoSave: true, allSites: false, contactPages: true, skipSites: [] };

export async function loadSettings(): Promise<Settings> {
  const got = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(got ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function loadContacts(): Promise<Record<string, Contact>> {
  return ((await chrome.storage.local.get(CONTACTS_KEY))[CONTACTS_KEY] as Record<string, Contact> | undefined) ?? {};
}

export function saveSighting(s: Sighting): Promise<Contact> {
  return serial(async () => {
    const all = await loadContacts();
    const merged = mergeSighting(all[s.id], s);
    all[s.id] = merged;
    await chrome.storage.local.set({ [CONTACTS_KEY]: trimContacts(all) });
    return merged;
  });
}

export function deleteContacts(ids: string[] | "all"): Promise<number> {
  return serial(async () => {
    if (ids === "all") {
      const n = Object.keys(await loadContacts()).length;
      await chrome.storage.local.set({ [CONTACTS_KEY]: {} });
      return n;
    }
    const all = await loadContacts();
    let n = 0;
    for (const id of ids) {
      if (!(id in all)) continue;
      delete all[id];
      n++;
    }
    await chrome.storage.local.set({ [CONTACTS_KEY]: all });
    return n;
  });
}

export function markSent(ids: string[], at = Date.now()): Promise<void> {
  return serial(async () => {
    const all = await loadContacts();
    for (const id of ids) if (all[id]) all[id] = { ...all[id]!, sentAt: at };
    await chrome.storage.local.set({ [CONTACTS_KEY]: all });
  });
}
