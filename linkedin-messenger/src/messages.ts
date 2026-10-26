import type { SendJob, SendOutcome } from "./content/messenger";

export type MessageResponse<T> = { ok: true; data: T } | { ok: false; error: string };

/** One message handed out by the backend. */
export interface QueuedMessage {
  id: string;
  campaignId: string;
  campaignName: string;
  mode: "assisted" | "auto";
  profileUrl: string;
  contactName: string;
  body: string;
}

export type WaitReason = "no_running_campaigns" | "in_flight" | "not_started" | "outside_window" | "daily_limit" | "interval";

export type NextResponse = { message: QueuedMessage } | { wait: { reason: WaitReason; nextCheckAt: string | null; campaignName?: string } };

export interface CampaignOverview {
  id: string;
  name: string;
  mode: "assisted" | "auto";
  dailyLimit: number;
  sentToday: number;
  queued: number;
  sent: number;
  nextSendAt: string | null;
  waitingFor: string | null;
}

export interface LogEntry {
  at: number;
  level: "info" | "ok" | "warn" | "error";
  text: string;
}

export interface RunnerState {
  running: boolean;
  /** The message being worked on in the LinkedIn tab. */
  current: (Pick<QueuedMessage, "id" | "campaignName" | "contactName" | "profileUrl" | "mode" | "body"> & { tabId: number; startedAt: number }) | null;
  /** Why nothing is being sent right now (from the backend). */
  waiting: { reason: WaitReason; nextCheckAt: string | null; campaignName?: string } | null;
  lastError: string | null;
  log: LogEntry[];
}

/** Background → content script in the LinkedIn tab. */
export type ContentRequest = { type: "LM_SEND"; messageId: string; job: SendJob } | { type: "LM_ABORT"; messageId: string } | { type: "LM_PING" };

/** Content script → background. */
export type ContentEvent = { type: "LM_RESULT"; messageId: string; outcome: SendOutcome };

/** Side panel → background (which holds the backend token). */
export type PanelRequest =
  | { type: "GET_BACKEND_STATUS" }
  | { type: "LOGIN"; backendUrl: string; email: string; password: string }
  | { type: "LOGOUT" }
  | { type: "GET_RUNNER" }
  | { type: "START" }
  | { type: "STOP" }
  | { type: "SKIP_CURRENT" }
  | { type: "GET_OVERVIEW" };
