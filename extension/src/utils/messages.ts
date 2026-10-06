import type { AiAction, AiStep, CollectorCommand, CollectorFieldSelection, CollectorSettings, PageSnapshot } from "@platform/shared";
import type { RunOutcome } from "../content/maps/runner";
import type { ExtractedListing } from "../content/maps/types";
import type { BackendStatus } from "../storage/auth";
import type { MapsPageState } from "./maps";

/** Side panel → background */
export type PanelRequest =
  | { type: "COMMAND"; command: CollectorCommand; settings: CollectorSettings }
  | { type: "OPEN_SEARCH"; query: string }
  | { type: "GET_ACTIVE_PAGE" }
  | { type: "LOGIN"; backendUrl: string; email: string; password: string }
  | { type: "LOGOUT" }
  | { type: "GET_BACKEND_STATUS" }
  | { type: "START_NEXT" }
  | { type: "RETRY_SYNC" };

/** Content script → background. `runId` lets the background ignore events from an old run. */
export type ContentEvent =
  | { type: "PAGE_STATE"; page: MapsPageState }
  | { type: "JOB_PROCESSED"; runId: string; clientKey: string }
  | { type: "JOB_LISTING"; runId: string; listing: ExtractedListing }
  | { type: "JOB_ITEM_ERROR"; runId: string; clientKey: string; name: string; message: string }
  | { type: "JOB_HEARTBEAT"; runId: string }
  | { type: "JOB_FINISHED"; runId: string; outcome: RunOutcome }
  /** Optional AI assist: asks the background (→ backend) for one next step; answered with an AiAction. */
  | { type: "JOB_AI_ASSIST"; runId: string; snapshot: PageSnapshot; history: AiStep[] };

export type { AiAction };

/** Background → content script */
export type ContentCommand =
  | {
      type: "RUN_JOB";
      runId: string;
      searchKeyword: string;
      location: string | null;
      fields: CollectorFieldSelection;
      maxRecords: number;
      processedKeys: string[];
      delayMs: number;
      aiAssist: boolean;
    }
  | { type: "CONTROL"; runId: string; control: "pause" | "stop" };

export type ExtensionMessage = PanelRequest | ContentEvent;

export type MessageResponse<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export type { BackendStatus };
