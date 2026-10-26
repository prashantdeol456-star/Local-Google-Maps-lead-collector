import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export type LiveState = "connecting" | "live" | "offline";

const LEAD_EVENTS = ["lead.saved", "lead.updated", "lead.deleted"];
const REFRESH_DELAY_MS = 800;

/**
 * Subscribes to /api/events (Server-Sent Events) and refreshes affected data.
 * Bursts of events (a running collection) are coalesced into one refresh.
 */
export function useLiveUpdates(enabled: boolean): LiveState {
  const client = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events", { withCredentials: true });
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (...keys: string[]) => {
      keys.forEach((k) => pending.add(k));
      timer ??= setTimeout(() => {
        for (const key of pending) client.invalidateQueries({ queryKey: [key] });
        pending.clear();
        timer = undefined;
      }, REFRESH_DELAY_MS);
    };

    source.addEventListener("ready", () => setState("live"));
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    for (const type of LEAD_EVENTS) source.addEventListener(type, () => schedule("leads", "lead", "stats", "facets", "jobs", "job", "communications", "wa-inbox", "preferences", "opt-outs"));
    source.addEventListener("job.updated", () => schedule("jobs", "job", "stats", "logs"));
    source.addEventListener("campaign.updated", () => schedule("campaigns", "campaign", "stats", "communications", "wa-inbox", "linkedin-campaigns", "linkedin-campaign"));

    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [enabled, client]);

  return state;
}
