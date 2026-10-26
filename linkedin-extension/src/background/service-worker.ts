import type { LinkedInLeadInput } from "@platform/shared";
import { loadAuthState } from "../storage/auth";
import type { MessageResponse, PanelRequest } from "../messages";
import { apiRequest } from "./apiClient";
import { checkBackend, login, logout } from "./backendSession";

// Holds the backend token and forwards the side panel's requests. Nothing runs on its own:
// every request starts with a click in the side panel.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// Keyboard shortcut: the side panel does the work (it holds the form), so just tell it.
chrome.commands.onCommand.addListener((command) => {
  if (command === "save-and-next") chrome.runtime.sendMessage({ type: "SHORTCUT_SAVE_AND_NEXT" }).catch(() => {});
});

async function authed<T>(path: string, body: unknown): Promise<MessageResponse<T>> {
  const auth = await loadAuthState();
  if (!auth.token) return { ok: false, error: "Not logged in" };
  const res = await apiRequest<T>({ baseUrl: auth.backendUrl, token: auth.token }, path, { method: "POST", body });
  return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error.message };
}

async function handle(message: PanelRequest, sender: chrome.runtime.MessageSender): Promise<MessageResponse<unknown>> {
  // Only extension pages (the side panel) may use the backend, never a web page or content script.
  if (sender.tab || sender.id !== chrome.runtime.id) return { ok: false, error: "Not allowed" };
  switch (message.type) {
    case "GET_BACKEND_STATUS":
      return { ok: true, data: await checkBackend() };
    case "LOGIN":
      return { ok: true, data: await login(message.backendUrl, message.email, message.password) };
    case "LOGOUT":
      return { ok: true, data: await logout() };
    case "SAVE_PROFILE":
      return authed<{ result: "new" | "updated"; lead: { id: string } & LinkedInLeadInput }>("/api/linkedin/leads", { lead: message.lead });
    case "CHECK_SAVED":
      return authed<{ saved: Record<string, string> }>("/api/linkedin/leads/check", { profileUrls: message.profileUrls });
    default:
      return { ok: false, error: "Unknown request" };
  }
}

chrome.runtime.onMessage.addListener((message: PanelRequest, sender, sendResponse) => {
  handle(message, sender)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // async response
});
