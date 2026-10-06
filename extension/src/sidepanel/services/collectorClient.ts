import type { CollectorCommand, CollectorSettings } from "@platform/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialCollectorState,
  loadCollectorState,
  loadSettings,
  onCollectorStateChange,
  saveSettings,
  type CollectorState,
} from "../../storage/state";
import type { MapsPageState } from "../../utils/maps";
import type { MessageResponse, PanelRequest } from "../../utils/messages";

export async function send<T>(request: PanelRequest): Promise<MessageResponse<T>> {
  try {
    return (await chrome.runtime.sendMessage(request)) as MessageResponse<T>;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const collectorClient = {
  command: (command: CollectorCommand, settings: CollectorSettings) =>
    send<CollectorState>({ type: "COMMAND", command, settings }),
  openSearch: (query: string) => send({ type: "OPEN_SEARCH", query }),
  getActivePage: () => send<MapsPageState | null>({ type: "GET_ACTIVE_PAGE" }),
  startNext: () => send<CollectorState>({ type: "START_NEXT" }),
  retrySync: () => send({ type: "RETRY_SYNC" }),
};

/** Job state from chrome.storage, kept live via storage change events. */
export function useCollectorState(): CollectorState {
  const [state, setState] = useState<CollectorState>(initialCollectorState);
  useEffect(() => {
    loadCollectorState().then(setState);
    return onCollectorStateChange(setState);
  }, []);
  return state;
}

/** Settings loaded once, then saved (debounced) on every change. */
export function useCollectorSettings(): [CollectorSettings | null, (s: CollectorSettings) => void] {
  const [settings, setSettings] = useState<CollectorSettings | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadSettings().then(setSettings);
    return () => clearTimeout(timer.current);
  }, []);

  const update = useCallback((next: CollectorSettings) => {
    setSettings(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveSettings(next).catch(console.error), 300);
  }, []);

  return [settings, update];
}

const PAGE_POLL_MS = 1500;

/** Maps page state of the active tab; polled because the user switches tabs freely. */
export function useActivePage(): MapsPageState | null {
  const [page, setPage] = useState<MapsPageState | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const res = await collectorClient.getActivePage();
      if (!cancelled && res.ok) setPage(res.data);
    };
    refresh();
    const id = setInterval(refresh, PAGE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return page;
}
