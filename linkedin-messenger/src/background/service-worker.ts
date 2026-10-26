import { loadAuthState } from "../storage/auth";
import type { CampaignOverview, ContentEvent, ContentRequest, InboxDraft, MessageResponse, NextResponse, PanelRequest } from "../messages";
import { apiRequest } from "./apiClient";
import { checkBackend, login, logout } from "./backendSession";
import { EMPTY_RUNNER, Runner, type ApiResult, type StoredRunner } from "./runner";

// Holds the backend token and runs the queue while the user has pressed Start in the side
// panel. A Chrome alarm wakes it every 30 seconds; the backend decides whether a message is due.

const ALARM = "lm-tick";
const RUNNER_KEY = "runner";

async function backend<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<ApiResult<T>> {
  const auth = await loadAuthState();
  if (!auth.token) return { ok: false, error: "Not logged in", unauthorized: true };
  const res = await apiRequest<T>({ baseUrl: auth.backendUrl, token: auth.token, timeoutMs: 15_000 }, path, { method, body });
  if (res.ok) return { ok: true, data: res.data };
  return { ok: false, error: res.error.status === 409 ? `409 ${res.error.message}` : res.error.message, unauthorized: res.error.kind === "unauthorized" };
}

function waitLoaded(tabId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    // A closed tab never loads. (An already "complete" tab may still be the previous page,
    // so only the update event after navigating counts.)
    chrome.tabs.get(tabId).catch(() => done(false));
  });
}

const runner = new Runner({
  api: {
    next: () => backend<NextResponse>("/api/linkedin-outreach/next", "POST", {}),
    report: (id, status, error) => backend(`/api/linkedin-outreach/messages/${encodeURIComponent(id)}/result`, "POST", { status, error }),
  },
  tabs: {
    async open(url, active, reuseTabId) {
      if (reuseTabId !== null) {
        try {
          const tab = await chrome.tabs.update(reuseTabId, { url, ...(active ? { active: true } : {}) });
          if (tab?.id !== undefined) {
            if (active && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
            return tab.id;
          }
        } catch {
          /* the tab was closed: open a new one */
        }
      }
      const tab = await chrome.tabs.create({ url, active });
      return tab.id!;
    },
    waitLoaded,
    async exists(tabId) {
      try {
        await chrome.tabs.get(tabId);
        return true;
      } catch {
        return false;
      }
    },
    async send(tabId, request: ContentRequest) {
      try {
        const res = (await chrome.tabs.sendMessage(tabId, request)) as { ok?: boolean } | undefined;
        return !!res?.ok;
      } catch {
        return false;
      }
    },
  },
  store: {
    async load() {
      const stored = (await chrome.storage.local.get(RUNNER_KEY))[RUNNER_KEY] as Partial<StoredRunner> | undefined;
      return { ...EMPTY_RUNNER, ...stored, log: stored?.log ?? [], pendingReports: stored?.pendingReports ?? [] };
    },
    save: (state) => chrome.storage.local.set({ [RUNNER_KEY]: state }),
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

function ensureAlarm() {
  chrome.alarms.get(ALARM).then((a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  ensureAlarm();
});
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runner.tick();
});

/** Side panel requests (only from this extension's pages). */
async function handlePanel(message: PanelRequest): Promise<MessageResponse<unknown>> {
  switch (message.type) {
    case "GET_BACKEND_STATUS":
      return { ok: true, data: await checkBackend() };
    case "LOGIN":
      return { ok: true, data: await login(message.backendUrl, message.email, message.password) };
    case "LOGOUT":
      await runner.stop();
      return { ok: true, data: await logout() };
    case "GET_RUNNER": {
      const { workTabId: _w, pendingReports: _p, ...state } = await runner.state();
      return { ok: true, data: state };
    }
    case "START":
      ensureAlarm();
      await runner.start();
      return { ok: true, data: null };
    case "STOP":
      await runner.stop();
      return { ok: true, data: null };
    case "SKIP_CURRENT":
      await runner.skipCurrent();
      return { ok: true, data: null };
    case "GET_OVERVIEW": {
      const res = await backend<{ campaigns: CampaignOverview[] }>("/api/linkedin-outreach/overview", "GET");
      return res.ok ? { ok: true, data: res.data.campaigns } : { ok: false, error: res.error };
    }
    case "INBOX_SYNC": {
      const res = await backend<{ drafts: InboxDraft[] }>("/api/inbox/linkedin/sync", "POST", {
        threads: message.threads.map((t) => ({ threadId: t.threadId, participantName: t.participantName, profileUrl: t.profileUrl, messages: t.messages })),
      });
      return res.ok ? { ok: true, data: res.data.drafts } : { ok: false, error: res.error };
    }
    case "INBOX_DRAFTS": {
      const q = message.threadId ? `?threadId=${encodeURIComponent(message.threadId)}` : "";
      const res = await backend<{ drafts: InboxDraft[] }>(`/api/inbox/linkedin/drafts${q}`, "GET");
      return res.ok ? { ok: true, data: res.data.drafts } : { ok: false, error: res.error };
    }
    case "INBOX_RESULT": {
      const res = await backend(`/api/inbox/linkedin/drafts/${encodeURIComponent(message.draftId)}/result`, "POST", { status: message.status, text: message.text });
      return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
    }
    default:
      return { ok: false, error: "Unknown request" };
  }
}

chrome.runtime.onMessage.addListener((message: PanelRequest | ContentEvent, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  // Results come from the content script in the LinkedIn tab.
  if (message.type === "LI_REPLY_RESULT") return; // for the side panel
  if (message.type === "LM_RESULT") {
    if (!sender.tab || !sender.url?.startsWith("https://www.linkedin.com/")) return;
    void runner.onResult(message.messageId, message.outcome).then(() => runner.tick());
    sendResponse({ ok: true });
    return;
  }
  // Everything else only from the side panel, never from a web page or content script.
  if (sender.tab) {
    sendResponse({ ok: false, error: "Not allowed" });
    return;
  }
  handlePanel(message)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // async response
});
