import {
  buildSearchQuery,
  checkAiAction,
  parseKeywords,
  startsNewJob,
  type AiAction,
  type CollectorCommand,
  type CollectorSettings,
} from "@platform/shared";
import { loadAuthState } from "../storage/auth";
import { IdbOutboxStore, type OutboxPayload } from "../storage/outbox";
import {
  addProcessedKey,
  clearOtherProcessedKeys,
  clearPageState,
  loadCollectorState,
  loadPageState,
  loadProcessedKeys,
  loadSeenIndex,
  nextQueued,
  saveCollectorState,
  savePageState,
  saveSeenIndex,
  withLog,
  type CollectorState,
  type SearchQueue,
} from "../storage/state";
import { buildMapsSearchUrl, MAPS_HOSTS, type MapsPageState } from "../utils/maps";
import type { ContentCommand, ContentEvent, ExtensionMessage, MessageResponse } from "../utils/messages";
import { apiRequest, type ApiResult } from "./apiClient";
import { checkBackend, login, logout } from "./backendSession";
import {
  applyCommand,
  applyFinished,
  applyItemError,
  applyListing,
  applyStartNext,
  applySyncEvent,
  applyWatchdog,
  backendStatusFor,
  isCurrentRun,
} from "./jobController";
import { checkLocalDuplicate } from "./localDedupe";
import { SyncEngine, type SyncEvent } from "./sync";

/** Fixed pause between listings (polite pacing; not randomized). */
const COLLECT_DELAY_MS = 1500;
const WATCHDOG_ALARM = "collector-watchdog";
const FLUSH_ALARM = "outbox-flush";
const SEARCH_LOAD_TIMEOUT_MS = 20_000;
/** An AI step can take a while (the backend calls the AI provider). */
const AI_STEP_TIMEOUT_MS = 45_000;

// Clicking the toolbar icon opens the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearPageState(tabId).catch(console.error);
});

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

async function loadPage(tabId: number | null): Promise<MapsPageState | null> {
  return tabId === null ? null : loadPageState(tabId);
}

// ---- State updates (one at a time, so rapid clicks / events cannot interleave writes) ----
// Never await a backend call or outbox flush inside updateState.

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function updateState(update: (s: CollectorState) => CollectorState | null | Promise<CollectorState | null>) {
  return serialized(async () => {
    const state = await loadCollectorState();
    const next = await update(state);
    if (next && next !== state) await saveCollectorState(next);
    return next ?? state;
  });
}

// ---- Backend ----

async function api<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<ApiResult<T>> {
  const auth = await loadAuthState();
  if (!auth.token) return { ok: false, error: { kind: "unauthorized", message: "Not logged in" } };
  return apiRequest<T>({ baseUrl: auth.backendUrl, token: auth.token }, path, { method, body });
}

// ---- Outbox: everything for the backend goes through here, in order ----

const outbox = new IdbOutboxStore();

async function onSyncEvent(event: SyncEvent) {
  const pending = await outbox.count();
  await updateState((s) => applySyncEvent(s, event, pending));
}

const sync = new SyncEngine(outbox, (method, path, body) => api(method, path, body), onSyncEvent);

function flushSoon() {
  sync
    .flush()
    .then(async (summary) => {
      if (summary.remaining > 0) await chrome.alarms.create(FLUSH_ALARM, { delayInMinutes: 0.5 });
      else await chrome.alarms.clear(FLUSH_ALARM);
    })
    .catch(console.error);
}

async function enqueue(payload: OutboxPayload) {
  await outbox.add(payload, Date.now());
  const pending = await outbox.count();
  await updateState((s) => ({ ...s, sync: { ...s.sync, pending } }));
  flushSoon();
}

function statusUpdate(jobId: string | null, status: Extract<OutboxPayload, { kind: "status" }>["status"], reason: string | null) {
  return jobId ? enqueue({ kind: "status", jobId, status, reason }) : Promise.resolve();
}

// ---- Content script runner ----

async function sendToTab(tabId: number, command: ContentCommand): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, command);
    return true;
  } catch {
    return false;
  }
}

/** Starts (or resumes) the content-script runner for the current job. */
async function startRunner(): Promise<void> {
  const state = await loadCollectorState();
  if (!state.runId || state.tabId === null || !state.jobSettings) return;
  const ok = await sendToTab(state.tabId, {
    type: "RUN_JOB",
    runId: state.runId,
    searchKeyword: state.jobSettings.keyword.trim(),
    location: state.jobSettings.location.trim() || null,
    fields: state.jobSettings.fields,
    maxRecords: state.jobSettings.maxRecords,
    processedKeys: await loadProcessedKeys(state.runId),
    delayMs: COLLECT_DELAY_MS,
    aiAssist: !!state.jobSettings.aiAssist,
  });
  if (ok) {
    await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
    return;
  }
  await updateState((s) =>
    withLog({ ...s, status: "paused" }, "error", "Could not reach the Maps tab. Reload the Google Maps tab, then press RESUME"),
  );
  await statusUpdate(state.backendJobId, "paused", "maps_tab_unreachable");
}

/** One AI step for the content script: asked from the backend (the AI key never reaches the extension). */
async function aiAssist(event: Extract<ContentEvent, { type: "JOB_AI_ASSIST" }>, tabId: number): Promise<MessageResponse<AiAction>> {
  const state = await loadCollectorState();
  if (!isCurrentRun(state, event.runId) || state.tabId !== tabId || !state.jobSettings) return { ok: false, error: "Not the current run" };
  if (!state.jobSettings.aiAssist) return { ok: false, error: "AI assist is off for this job" };
  if (!state.backendJobId) return { ok: false, error: "AI assist needs the backend connection" };

  const auth = await loadAuthState();
  if (!auth.token) return { ok: false, error: "Not logged in to the backend" };
  const query = buildSearchQuery(state.jobSettings.keyword, state.jobSettings.location);
  const res = await apiRequest<{ action: AiAction; stepsLeft: number }>(
    { baseUrl: auth.backendUrl, token: auth.token, timeoutMs: AI_STEP_TIMEOUT_MS },
    "/api/ai/next-action",
    { method: "POST", body: { jobId: state.backendJobId, query, snapshot: event.snapshot, history: event.history } },
  );
  if (!res.ok) {
    await updateState((s) => withLog(s, "warning", `AI assist: ${res.error.message}`));
    return { ok: false, error: res.error.message };
  }
  const checked = checkAiAction(res.data.action, event.snapshot);
  if (!checked.ok) return { ok: false, error: `AI answer rejected: ${checked.error}` };
  const a = checked.action;
  const label = a.action === "click" ? event.snapshot.candidates.find((c) => c.i === a.target)?.label : null;
  await updateState((s) =>
    withLog(s, "info", `AI step: ${a.action}${label ? ` "${label}"` : ""}${a.note ? ` (${a.note})` : ""}. ${res.data.stepsLeft} left for this job`),
  );
  return { ok: true, data: a };
}

/** AI assist asked to open the job's search again: done here, always the job's own Maps search URL. */
async function reopenSearch(): Promise<void> {
  const state = await loadCollectorState();
  if (state.status !== "running" || state.tabId === null || !state.jobSettings) return;
  const query = buildSearchQuery(state.jobSettings.keyword, state.jobSettings.location);
  const since = Date.now();
  await chrome.tabs.update(state.tabId, { url: buildMapsSearchUrl(query) });
  if (await waitForSearchPage(state.tabId, query, since)) {
    await startRunner();
    return;
  }
  await updateState((s) => withLog({ ...s, status: "paused" }, "error", `The search "${query}" did not load in Maps. Check the tab, then press RESUME`));
  await statusUpdate(state.backendJobId, "paused", "search_did_not_load");
}

async function handleContentEvent(event: ContentEvent, tabId: number): Promise<MessageResponse<unknown>> {
  if (event.type === "PAGE_STATE") {
    await savePageState(tabId, event.page);
    return { ok: true, data: undefined };
  }
  if (event.type === "JOB_AI_ASSIST") return aiAssist(event, tabId);

  let toSend: OutboxPayload | null = null;
  let backendStatus: { status: "completed" | "paused"; reason: string } | null = null;

  const state = await updateState(async (s) => {
    // Ignore events from an older run or from a different tab.
    if (!isCurrentRun(s, event.runId) || s.tabId !== tabId) return null;
    switch (event.type) {
      case "JOB_PROCESSED":
        await addProcessedKey(event.runId, event.clientKey);
        return null;
      case "JOB_LISTING": {
        const { duplicateOf, index } = await checkLocalDuplicate(await loadSeenIndex(event.runId), event.listing);
        await saveSeenIndex(event.runId, index);
        if (s.backendJobId) {
          const { clientKey, ...lead } = event.listing;
          toSend = { kind: "lead", jobId: s.backendJobId, clientKey, lead };
        }
        return applyListing(s, event.listing, Date.now(), duplicateOf);
      }
      case "JOB_ITEM_ERROR":
        if (s.backendJobId) {
          toSend = { kind: "error", jobId: s.backendJobId, clientKey: event.clientKey, name: event.name, message: event.message };
        }
        return applyItemError(s, event.name, event.message);
      case "JOB_HEARTBEAT":
        return { ...s, lastHeartbeatAt: Date.now() };
      case "JOB_FINISHED":
        backendStatus = backendStatusFor(event.outcome);
        return applyFinished(s, event.outcome);
    }
  });

  if (toSend) await enqueue(toSend);
  const bs = backendStatus as { status: "completed" | "paused"; reason: string } | null;
  if (bs) await statusUpdate(state.backendJobId, bs.status, bs.reason);
  if (event.type === "JOB_FINISHED" && event.outcome.reason === "ai_search" && state.runId === event.runId) {
    if (state.status === "running") reopenSearch().catch(console.error);
    else await statusUpdate(state.backendJobId, "paused", "ai_search_limit");
  }
  return { ok: true, data: undefined };
}

// ---- Commands ----

/** Creates the backend job(s) for a new search and marks the first one running. */
async function createBackendJob(
  settings: CollectorSettings,
  keywords: string[],
): Promise<{ ok: true; jobId: string; queue: SearchQueue | null } | { ok: false; error: string }> {
  const location = settings.location.trim() || null;
  let jobId: string;
  let searchQueue: SearchQueue | null = null;

  if (keywords.length > 1) {
    const res = await api<{ queueId: string; jobs: { id: string; searchKeyword: string }[] }>("POST", "/api/jobs/queue", {
      keywords,
      location,
      maxRecords: settings.maxRecords,
    });
    if (!res.ok) return { ok: false, error: `Could not create the job on the backend: ${res.error.message}` };
    searchQueue = { queueId: res.data.queueId, jobs: res.data.jobs.map((j) => ({ id: j.id, keyword: j.searchKeyword })), index: 0 };
    jobId = searchQueue.jobs[0]!.id;
  } else {
    const res = await api<{ job: { id: string } }>("POST", "/api/jobs", {
      searchKeyword: keywords[0],
      location,
      maxRecords: settings.maxRecords,
    });
    if (!res.ok) return { ok: false, error: `Could not create the job on the backend: ${res.error.message}` };
    jobId = res.data.job.id;
  }

  const run = await markRunning(jobId);
  return run.ok ? { ok: true, jobId, queue: searchQueue } : run;
}

async function markRunning(jobId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await api("PATCH", `/api/jobs/${encodeURIComponent(jobId)}`, { status: "running" });
  return res.ok ? { ok: true } : { ok: false, error: res.error.message };
}

async function startNewJob(settings: CollectorSettings): Promise<MessageResponse<unknown>> {
  const keywords = parseKeywords(settings.keyword);
  const tabId = await getActiveTabId();
  const current = await loadCollectorState();
  const dry = applyCommand(current, "start", settings, await loadPage(tabId), Date.now(), tabId, keywords[0]);
  if (!dry.ok) return dry;

  // Searches left over from a previous queue are cancelled, then pending updates are sent first
  // so the backend sees the previous job's final status before this one starts.
  if (current.queue) {
    for (const job of current.queue.jobs.slice(current.queue.index + 1)) await statusUpdate(job.id, "stopped", "queue_replaced");
  }
  await sync.flush();

  const created = await createBackendJob(settings, keywords);
  if (!created.ok) return created;

  await clearOtherProcessedKeys(dry.state.runId);
  let state = await updateState(() => ({ ...dry.state, backendJobId: created.jobId, queue: created.queue }));
  if (settings.aiAssist) {
    const ai = await api<{ enabled: boolean; model: string | null }>("GET", "/api/ai/status");
    state = await updateState((s) =>
      ai.ok && ai.data.enabled
        ? withLog(s, "info", `AI assist on (${ai.data.model}): used only if the results list cannot be found`)
        : withLog(s, "warning", "AI assist is not set up on the backend (AI_PROVIDER), so it will not be used"),
    );
  }
  await startRunner();
  return { ok: true, data: state };
}

async function waitForSearchPage(tabId: number, query: string, since: number): Promise<MapsPageState | null> {
  const end = Date.now() + SEARCH_LOAD_TIMEOUT_MS;
  while (Date.now() < end) {
    const page = await loadPageState(tabId);
    if (page && page.updatedAt >= since && page.isSearch && page.query?.toLowerCase() === query.toLowerCase()) return page;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function startNextInQueue(): Promise<MessageResponse<unknown>> {
  const current = await loadCollectorState();
  const next = nextQueued(current);
  if (!next || !current.jobSettings) return { ok: false, error: "No more searches in the queue" };
  const tabId = await getActiveTabId();
  if (tabId === null || !(await loadPage(tabId))?.isMaps) return { ok: false, error: "Open Google Maps in the active tab first" };

  const query = buildSearchQuery(next.keyword, current.jobSettings.location);
  const since = Date.now();
  await chrome.tabs.update(tabId, { url: buildMapsSearchUrl(query) });
  const page = await waitForSearchPage(tabId, query, since);
  if (!page) return { ok: false, error: `The search "${query}" did not load in Maps. Try again` };

  const dry = applyStartNext(await loadCollectorState(), page, Date.now(), tabId);
  if (!dry.ok) return dry;
  await sync.flush();
  const run = await markRunning(next.id);
  if (!run.ok) return { ok: false, error: `Backend: ${run.error}` };

  await clearOtherProcessedKeys(dry.state.runId);
  const state = await updateState(() => dry.state);
  await startRunner();
  return { ok: true, data: state };
}

async function handleCommand(command: CollectorCommand, settings: CollectorSettings): Promise<MessageResponse<unknown>> {
  const current = await loadCollectorState();
  if (command === "start" && startsNewJob(current.status)) return startNewJob(settings);

  let error: string | null = null;
  const state = await updateState(async (s) => {
    const tabId = await getActiveTabId();
    const result = applyCommand(s, command, settings, await loadPage(tabId), Date.now(), tabId);
    if (!result.ok) {
      error = result.error;
      return null;
    }
    return result.state;
  });
  if (error) return { ok: false, error };

  if (command === "start") {
    await statusUpdate(state.backendJobId, "running", null); // resume
    await startRunner();
  } else {
    if (current.tabId !== null && current.runId) {
      await sendToTab(current.tabId, { type: "CONTROL", runId: current.runId, control: command });
    }
    await statusUpdate(state.backendJobId, command === "pause" ? "paused" : "stopped", "user");
  }
  return { ok: true, data: state };
}

// ---- Message routing ----

async function handle(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<MessageResponse<unknown>> {
  // Messages from content scripts (inside web pages) are limited to page/job reports.
  // Everything else must come from an extension page such as the side panel.
  if (sender.tab) {
    if (sender.tab.id === undefined) return { ok: false, error: "No sender tab" };
    if (message.type === "PAGE_STATE" || message.type.startsWith("JOB_")) {
      return handleContentEvent(message as ContentEvent, sender.tab.id);
    }
    return { ok: false, error: "Not allowed from a web page" };
  }

  switch (message.type) {
    case "GET_BACKEND_STATUS":
      return { ok: true, data: await checkBackend() };

    case "LOGIN": {
      const status = await login(message.backendUrl, message.email, message.password);
      flushSoon(); // send anything that waited while logged out
      return { ok: true, data: status };
    }

    case "LOGOUT":
      return { ok: true, data: await logout() };

    case "GET_ACTIVE_PAGE":
      return { ok: true, data: await loadPage(await getActiveTabId()) };

    case "OPEN_SEARCH": {
      const query = message.query.trim();
      if (!query) return { ok: false, error: "Enter a search keyword first" };
      const url = buildMapsSearchUrl(query);
      const tabId = await getActiveTabId();
      const page = await loadPage(tabId);
      // Reuse the active tab only when it is already Google Maps.
      if (tabId !== null && page?.isMaps) await chrome.tabs.update(tabId, { url });
      else await chrome.tabs.create({ url });
      return { ok: true, data: undefined };
    }

    case "COMMAND":
      return handleCommand(message.command, message.settings);

    case "START_NEXT":
      return startNextInQueue();

    case "RETRY_SYNC":
      flushSoon();
      return { ok: true, data: undefined };

    default:
      return { ok: false, error: "Unknown message" };
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handle(message, sender)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // keep the channel open for the async response
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    flushSoon();
    return;
  }
  if (alarm.name !== WATCHDOG_ALARM) return;
  // If the Maps tab goes silent while running (navigated to a CAPTCHA page, closed, crashed),
  // pause the job instead of showing "running" forever.
  let pausedJobId: string | null = null;
  updateState(async (state) => {
    if (state.status !== "running") {
      await chrome.alarms.clear(WATCHDOG_ALARM);
      return null;
    }
    const next = applyWatchdog(state);
    if (next) pausedJobId = state.backendJobId;
    return next;
  })
    .then(() => (pausedJobId ? statusUpdate(pausedJobId, "paused", "lost_contact_with_maps_tab") : undefined))
    .catch(console.error);
});

// Whenever the service worker starts (browser start, wake-up): send anything left in the outbox.
outbox
  .count()
  .then((pending) => updateState((s) => ({ ...s, sync: { ...s.sync, pending } })))
  .then(flushSoon)
  .catch(console.error);

console.info(`[maps-collector] service worker ready (hosts: ${MAPS_HOSTS.join(", ")})`);
