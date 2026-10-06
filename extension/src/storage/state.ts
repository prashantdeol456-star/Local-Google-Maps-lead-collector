import {
  defaultCollectorSettings,
  EMPTY_COUNTERS,
  type CollectorCounters,
  type CollectorSettings,
  type CollectorStatus,
} from "@platform/shared";
import type { ExtractedListing } from "../content/maps/types";
import type { MapsPageState } from "../utils/maps";

export type LogLevel = "info" | "success" | "warning" | "error";

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  message: string;
}

export interface CollectorState {
  status: CollectorStatus;
  jobLabel: string | null;
  startedAt: number | null;
  counters: CollectorCounters;
  log: LogEntry[];
  /** Settings the current job was started with (the form is locked while it runs). */
  jobSettings: CollectorSettings | null;
  /** Identifies the current run; events from older runs are ignored. */
  runId: string | null;
  /** Tab the collector runs in. */
  tabId: number | null;
  /** Last time the content script reported it is alive (ms). */
  lastHeartbeatAt: number | null;
  /** Most recent extracted listings, newest first. */
  recent: ExtractedListing[];
  /** The backend CollectionJob this run reports to. */
  backendJobId: string | null;
  /** Multi-keyword search queue; `index` is the job currently (or last) run. */
  queue: SearchQueue | null;
  /** Outbox status: how many items still wait to reach the backend. */
  sync: SyncState;
  /** Times AI assist reopened the search in this run (limited, so it can never loop). */
  aiSearches?: number;
}

export interface SearchQueue {
  queueId: string;
  jobs: { id: string; keyword: string }[];
  index: number;
}

export interface SyncState {
  pending: number;
  /** Why the last send failed (cleared on success). */
  lastError: string | null;
}

export const MAX_LOG_ENTRIES = 200;
export const MAX_RECENT = 20;

export function initialCollectorState(): CollectorState {
  return {
    status: "idle",
    jobLabel: null,
    startedAt: null,
    counters: { ...EMPTY_COUNTERS },
    log: [],
    jobSettings: null,
    runId: null,
    tabId: null,
    lastHeartbeatAt: null,
    recent: [],
    backendJobId: null,
    queue: null,
    sync: { pending: 0, lastError: null },
  };
}

/** The queued search after the current one, if any. */
export function nextQueued(state: CollectorState): { id: string; keyword: string } | null {
  const q = state.queue;
  return q && q.index + 1 < q.jobs.length ? q.jobs[q.index + 1]! : null;
}

/** Returns a new state with the entry appended (oldest entries dropped past the cap). */
export function withLog(state: CollectorState, level: LogLevel, message: string, now = Date.now()): CollectorState {
  const lastId = state.log.at(-1)?.id ?? 0;
  const log = [...state.log, { id: lastId + 1, at: now, level, message }].slice(-MAX_LOG_ENTRIES);
  return { ...state, log };
}

// ---- chrome.storage wrappers ----
// local:   survives browser restarts (settings, job state)
// session: cleared when the browser closes (per-tab Maps page state)

const SETTINGS_KEY = "settings";
const COLLECTOR_KEY = "collector";
const pageKey = (tabId: number) => `page:${tabId}`;

export async function loadSettings(): Promise<CollectorSettings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<CollectorSettings> | undefined;
  const defaults = defaultCollectorSettings();
  return { ...defaults, ...stored, fields: { ...defaults.fields, ...stored?.fields } };
}

export function saveSettings(settings: CollectorSettings): Promise<void> {
  return chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function loadCollectorState(): Promise<CollectorState> {
  const stored = (await chrome.storage.local.get(COLLECTOR_KEY))[COLLECTOR_KEY] as Partial<CollectorState> | undefined;
  // Merge with defaults so state saved by an older version still loads.
  return { ...initialCollectorState(), ...stored };
}

// Processed listing keys per run, kept separately (can hold thousands of entries).
const processedKey = (runId: string) => `processed:${runId}`;

export async function loadProcessedKeys(runId: string): Promise<string[]> {
  return ((await chrome.storage.local.get(processedKey(runId)))[processedKey(runId)] as string[] | undefined) ?? [];
}

export async function addProcessedKey(runId: string, key: string): Promise<void> {
  const keys = await loadProcessedKeys(runId);
  if (!keys.includes(key)) await chrome.storage.local.set({ [processedKey(runId)]: [...keys, key] });
}

/** Drops processed-key lists of runs other than `keepRunId`. */
export async function clearOtherProcessedKeys(keepRunId: string | null): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith("processed:") && k !== (keepRunId && processedKey(keepRunId)));
  if (stale.length) await chrome.storage.local.remove(stale);
}

export function saveCollectorState(state: CollectorState): Promise<void> {
  return chrome.storage.local.set({ [COLLECTOR_KEY]: state });
}

export function onCollectorStateChange(callback: (state: CollectorState) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const change = changes[COLLECTOR_KEY];
    if (area === "local" && change?.newValue) callback(change.newValue as CollectorState);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function loadPageState(tabId: number): Promise<MapsPageState | null> {
  const key = pageKey(tabId);
  return ((await chrome.storage.session.get(key))[key] as MapsPageState | undefined) ?? null;
}

export function savePageState(tabId: number, page: MapsPageState): Promise<void> {
  return chrome.storage.session.set({ [pageKey(tabId)]: page });
}

export function clearPageState(tabId: number): Promise<void> {
  return chrome.storage.session.remove(pageKey(tabId));
}

// Local (in-run) duplicate index for immediate feedback. The backend makes the final decision.
const seenKey = (runId: string) => `seen:${runId}`;

export async function loadSeenIndex(runId: string): Promise<Record<string, { name: string; placeId: string | null }>> {
  return ((await chrome.storage.session.get(seenKey(runId)))[seenKey(runId)] as Record<string, { name: string; placeId: string | null }>) ?? {};
}

export function saveSeenIndex(runId: string, index: Record<string, { name: string; placeId: string | null }>): Promise<void> {
  return chrome.storage.session.set({ [seenKey(runId)]: index });
}
