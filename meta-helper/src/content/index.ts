import type { CollectResult, ContentEvent, ContentRequest } from "../messages";
import { readSearchResults as readFacebook, searchKind } from "./facebook";
import { DEFAULT_TIMING, readProfile, readSearchResults as readInstagram, sendFromProfile, typeSearch, type SendOutcome } from "./instagram";

// Runs in Instagram and Facebook tabs. Does nothing until the side panel asks it to read the
// open page, or the background asks it to send one Instagram message.

let active: { messageId: string; controller: AbortController } | null = null;

function collect(): CollectResult {
  const url = location.href;
  if (location.hostname.endsWith("facebook.com")) {
    return searchKind(url) ? { page: "facebook_search", leads: readFacebook(document, url) } : { page: "other", leads: [] };
  }
  if (location.hostname.endsWith("instagram.com")) {
    const results = readInstagram(document);
    // On a profile page the header describes that profile; the search panel may be open too.
    const profile = /^\/[A-Za-z0-9._]+\/?$/.test(location.pathname) ? readProfile(document, url) : null;
    if (profile && results.length === 0) return { page: "instagram_profile", leads: [profile] };
    return { page: "instagram_search", leads: profile ? [profile, ...results.filter((r) => r.url !== profile.url)] : results };
  }
  return { page: "other", leads: [] };
}

chrome.runtime.onMessage.addListener((message: ContentRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  switch (message.type) {
    case "LM_PING":
      sendResponse({ ok: true });
      return;
    case "MH_COLLECT":
      sendResponse({ ok: true, data: collect() });
      return;
    case "MH_IG_SEARCH":
      sendResponse({ ok: typeSearch(document, message.keyword) });
      return;
    case "LM_ABORT":
      if (active?.messageId === message.messageId) active.controller.abort();
      sendResponse({ ok: !!active });
      return;
    case "LM_SEND": {
      if (active) {
        sendResponse({ ok: active.messageId === message.messageId });
        return;
      }
      const controller = new AbortController();
      active = { messageId: message.messageId, controller };
      sendResponse({ ok: true }); // the result follows as LM_RESULT
      sendFromProfile(document, () => location.href, message.job, DEFAULT_TIMING, controller.signal)
        .catch((err: unknown): SendOutcome => ({ status: "failed", reason: err instanceof Error ? err.message : String(err) }))
        .then((outcome) => {
          active = null;
          const event: ContentEvent = { type: "LM_RESULT", messageId: message.messageId, outcome };
          chrome.runtime.sendMessage(event).catch(() => {});
        });
      return;
    }
  }
});
