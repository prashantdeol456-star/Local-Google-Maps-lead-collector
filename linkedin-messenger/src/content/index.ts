import type { ContentEvent, ContentRequest } from "../messages";
import { listUnreadThreads, readOpenThread, typeReplyAndWait, type ReplyOutcome } from "./inbox";
import { DEFAULT_TIMING, sendFromProfile, type SendOutcome } from "./messenger";

// Runs in LinkedIn tabs. Does nothing until the background asks it to send one message
// (only in the tab the extension opened for that profile).

let active: { messageId: string; controller: AbortController } | null = null;
let activeReply: { draftId: string; controller: AbortController } | null = null;

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
    case "LI_INBOX_SCAN":
      sendResponse({ ok: true, data: listUnreadThreads(document) });
      return;
    case "LI_READ_THREAD":
      sendResponse({ ok: true, data: readOpenThread(document, location.href) });
      return;
    case "LI_ABORT_REPLY":
      if (activeReply?.draftId === message.draftId) activeReply.controller.abort();
      sendResponse({ ok: !!activeReply });
      return;
    case "LI_TYPE_REPLY": {
      if (activeReply || active) {
        sendResponse({ ok: activeReply?.draftId === message.draftId });
        return;
      }
      const controller = new AbortController();
      activeReply = { draftId: message.draftId, controller };
      sendResponse({ ok: true }); // the result follows as LI_REPLY_RESULT
      typeReplyAndWait(document, message.text, message.participantName, DEFAULT_TIMING, controller.signal)
        .catch((err: unknown): ReplyOutcome => ({ status: "skipped", reason: err instanceof Error ? err.message : String(err) }))
        .then((outcome) => {
          activeReply = null;
          const event: ContentEvent = { type: "LI_REPLY_RESULT", draftId: message.draftId, outcome };
          chrome.runtime.sendMessage(event).catch(() => {});
        });
      return;
    }
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
