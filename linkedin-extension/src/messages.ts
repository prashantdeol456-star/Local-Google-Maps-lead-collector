import type { LinkedInLeadInput } from "@platform/shared";

export type MessageResponse<T> = { ok: true; data: T } | { ok: false; error: string };

/** Side panel → content script in the LinkedIn tab. */
export type ContentRequest = { type: "LI_READ_PROFILE" } | { type: "LI_READ_LINKS" };

/** Side panel → background (which holds the backend token). */
export type PanelRequest =
  | { type: "GET_BACKEND_STATUS" }
  | { type: "LOGIN"; backendUrl: string; email: string; password: string }
  | { type: "LOGOUT" }
  | { type: "SAVE_PROFILE"; lead: LinkedInLeadInput }
  | { type: "CHECK_SAVED"; profileUrls: string[] };
