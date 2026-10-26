import type { OpenThread, ReplyOutcome, UnreadThread } from "./content/inbox";
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
export type ContentRequest =
  | { type: "LM_SEND"; messageId: string; job: SendJob }
  | { type: "LM_ABORT"; messageId: string }
  | { type: "LM_PING" }
  // Inbox assist (LinkedIn messaging pages)
  | { type: "LI_INBOX_SCAN" }
  | { type: "LI_READ_THREAD" }
  | { type: "LI_TYPE_REPLY"; draftId: string; text: string; participantName: string }
  | { type: "LI_ABORT_REPLY"; draftId: string };

export type { OpenThread, UnreadThread };

/** A reply the AI wrote for a LinkedIn chat, waiting for the extension to type it. */
export interface InboxDraft {
  id: string;
  threadId: string;
  participantName: string;
  text: string;
  confidence: number | null;
  decision: string | null;
}

/** Content script → background. */
export type ContentEvent = { type: "LM_RESULT"; messageId: string; outcome: SendOutcome } | { type: "LI_REPLY_RESULT"; draftId: string; outcome: ReplyOutcome };

/** Side panel → background (which holds the backend token). */
export type PanelRequest =
  | { type: "GET_BACKEND_STATUS" }
  | { type: "LOGIN"; backendUrl: string; email: string; password: string }
  | { type: "LOGOUT" }
  | { type: "GET_RUNNER" }
  | { type: "START" }
  | { type: "STOP" }
  | { type: "SKIP_CURRENT" }
  | { type: "GET_OVERVIEW" }
  | { type: "INBOX_SYNC"; threads: OpenThread[] }
  | { type: "INBOX_DRAFTS"; threadId?: string }
  | { type: "INBOX_RESULT"; draftId: string; status: "sent" | "skipped"; text?: string };
