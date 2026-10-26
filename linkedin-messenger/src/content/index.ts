import type { ContentEvent, ContentRequest } from "../messages";
import { sendFromProfile, type SendOutcome } from "./messenger";

// Runs in LinkedIn tabs. Does nothing until the background asks it to send one message
// (only in the tab the extension opened for that profile).

let active: { messageId: string; controller: AbortController } | null = null;

function report(messageId: string, outcome: SendOutcome) {
  const event: ContentEvent = { type: "LM_RESULT", messageId, outcome };
  chrome.runtime.sendMessage(event).catch(() => {});
}

chrome.runtime.onMessage.addListener((message: ContentRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  switch (message.type) {
    case "LM_PING":
      sendResponse({ ok: true });
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
      sendResponse({ ok: true }); // accepted; the result follows as LM_RESULT
      sendFromProfile(document, () => location.href, message.job, undefined, controller.signal)
        .catch((err: unknown): SendOutcome => ({ status: "failed", reason: err instanceof Error ? err.message : String(err) }))
        .then((outcome) => {
          active = null;
          report(message.messageId, outcome);
        });
      return;
    }
  }
});
