import { readProfile, readProfileLinks } from "./parse";
import { loadProfileSections } from "./sections";
import type { ContentRequest } from "../messages";

// Answers the side panel's "read this page" requests. Reads the DOM only when asked; never
// clicks or navigates. To read Experience/Education it scrolls the open profile once.

chrome.runtime.onMessage.addListener((message: ContentRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  switch (message.type) {
    case "LI_READ_PROFILE": {
      const key = location.pathname.replace(/\/overlay\/.*$/, "");
      loadProfileSections(document, key)
        .catch(() => {})
        .then(() => sendResponse({ ok: true, data: readProfile(document, location.href) }));
      return true; // async response
    }
    case "LI_READ_LINKS":
      sendResponse({ ok: true, data: readProfileLinks(document) });
      break;
  }
});
