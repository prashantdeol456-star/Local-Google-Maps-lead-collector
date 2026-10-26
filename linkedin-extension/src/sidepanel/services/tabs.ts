import { normalizeLinkedInProfileUrl } from "@platform/shared";
import { useEffect, useState } from "react";
import type { ContentRequest, MessageResponse } from "../../messages";

export type TabKind = "profile" | "linkedin" | "other";

export interface ActiveTab {
  id: number;
  url: string | null;
  kind: TabKind;
  profileUrl: string | null;
}

export async function getActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  // tab.url is only visible for sites in host_permissions (linkedin.com); undefined elsewhere.
  const url = tab.url ?? null;
  const profileUrl = normalizeLinkedInProfileUrl(url);
  const onLinkedIn = !!url && /^https:\/\/www\.linkedin\.com\//.test(url);
  return { id: tab.id, url, kind: profileUrl ? "profile" : onLinkedIn ? "linkedin" : "other", profileUrl };
}

/** Asks the content script in the LinkedIn tab to read the page. */
export async function askTab<T>(tabId: number, request: ContentRequest): Promise<MessageResponse<T>> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, request)) as MessageResponse<T> | undefined;
    return res ?? { ok: false, error: "The page did not answer. Reload the LinkedIn tab and try again." };
  } catch {
    // Tabs opened before the extension was installed or reloaded have no content script yet.
    if (await injectContentScript(tabId)) {
      try {
        const res = (await chrome.tabs.sendMessage(tabId, request)) as MessageResponse<T> | undefined;
        if (res) return res;
      } catch {
        // fall through
      }
    }
    return { ok: false, error: "Cannot read this tab. Reload the LinkedIn page (the helper starts when the page loads)." };
  }
}

/** Adds the manifest's content script to an already open LinkedIn tab. */
async function injectContentScript(tabId: number): Promise<boolean> {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
  if (!files.length) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    return true;
  } catch {
    return false; // not a linkedin.com page, or the page is still loading
  }
}

/** True for a LinkedIn people-search results page. */
export function isPeopleSearchUrl(url: string | null | undefined): boolean {
  return !!url && /^https:\/\/www\.linkedin\.com\/search\/results\/people\//.test(url);
}

export { peopleSearchUrl } from "./searchFilters";

/** A profile with its Contact info dialog open. */
export function contactInfoUrl(profileUrl: string): string {
  return `${profileUrl.replace(/\/+$/, "")}/overlay/contact-info/`;
}

/** True when the tab shows a profile's Contact info dialog URL. */
export function isContactInfoUrl(url: string | null | undefined): boolean {
  return !!url && /^https:\/\/www\.linkedin\.com\/in\/[^/]+\/overlay\/contact-info/.test(url);
}

/** Opens a page in the current tab. Only called from a click in the side panel. */
export async function openInTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
}

const POLL_MS = 1500;

/** The active tab, polled because the user switches tabs and navigates freely. */
export function useActiveTab(): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const t = await getActiveTab().catch(() => null);
      if (!cancelled) setTab((prev) => (prev && t && prev.id === t.id && prev.url === t.url ? prev : t));
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return tab;
}
