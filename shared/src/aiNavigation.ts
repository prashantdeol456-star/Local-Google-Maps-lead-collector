// Optional AI navigation (Phase 16): the contract between the extension and the backend.
//
// The deterministic collector is always the default. Only when it cannot find the results
// list does the extension (if the user enabled AI assist) send a sanitized page snapshot;
// the AI picks ONE step from a fixed list, and both sides validate it here before use.
// The AI never supplies selectors, URLs, code or text to type: a "click" can only name an
// element the extension itself listed, and "search" always types the job's own query.

export const AI_ACTIONS = ["click", "scroll_results", "scroll_page", "search", "back", "wait", "done", "stop"] as const;
export type AiActionType = (typeof AI_ACTIONS)[number];

export const AI_STOP_REASONS = ["none", "no_results", "not_maps_search", "needs_user", "unknown_layout"] as const;
export type AiStopReason = (typeof AI_STOP_REASONS)[number];

export const AI_LIMITS = {
  maxCandidates: 40,
  maxLabelLength: 80,
  maxTextLength: 1500,
  maxTitleLength: 200,
  maxHistory: 10,
  maxNoteLength: 200,
  /** Steps one recovery may take before giving up (the backend also has a per-job budget). */
  stepsPerRecovery: 6,
  maxWaitSeconds: 5,
} as const;

export interface PageCandidate {
  /** Index the AI refers to; only the extension knows which element it is. */
  i: number;
  role: "button" | "link" | "tab";
  label: string;
}

/** What the AI sees: no cookies, no form values, emails masked, page text marked untrusted. */
export interface PageSnapshot {
  /** "search" | "place" | "maps" (another Maps page) | "other" */
  pageKind: "search" | "place" | "maps" | "other";
  /** Query in the Maps URL, if any */
  urlQuery: string | null;
  title: string;
  hasResultsList: boolean;
  /** Number of place links visible */
  placeLinks: number;
  hasSearchBox: boolean;
  candidates: PageCandidate[];
  /** Visible text of the main panel (untrusted) */
  text: string;
}

export interface AiStep {
  action: AiActionType;
  label: string | null;
  /** What happened after it */
  result: "list_found" | "no_change" | "page_changed" | "failed";
}

export interface AiAction {
  action: AiActionType;
  /** Candidate index for "click", else -1 */
  target: number;
  /** For "wait" */
  seconds: number;
  stopReason: AiStopReason;
  /** One short sentence for the activity log */
  note: string;
}

export type AiActionCheck = { ok: true; action: AiAction } | { ok: false; error: string };

const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * Validates an AI answer against the snapshot it was made for. Enum values are compared
 * case-insensitively (structured outputs do not guarantee their casing).
 */
export function checkAiAction(raw: unknown, snapshot: Pick<PageSnapshot, "candidates" | "hasSearchBox">): AiActionCheck {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Answer is not an object" };
  const r = raw as Record<string, unknown>;
  const action = AI_ACTIONS.find((a) => a === lower(r.action));
  if (!action) return { ok: false, error: `Unknown action "${String(r.action)}"` };
  const stopReason = AI_STOP_REASONS.find((s) => s === lower(r.stopReason ?? r.stop_reason)) ?? "none";
  const note = (typeof r.note === "string" ? r.note : "").replace(/\s+/g, " ").trim().slice(0, AI_LIMITS.maxNoteLength);

  let target = -1;
  if (action === "click") {
    const t = r.target;
    if (typeof t !== "number" || !Number.isInteger(t)) return { ok: false, error: "Click needs a candidate index" };
    if (!snapshot.candidates.some((c) => c.i === t)) return { ok: false, error: `Element ${t} is not one of the listed elements` };
    target = t;
  }
  if (action === "search" && !snapshot.hasSearchBox) return { ok: false, error: "There is no search box on this page" };

  const s = typeof r.seconds === "number" && Number.isFinite(r.seconds) ? Math.round(r.seconds) : 2;
  const seconds = action === "wait" ? Math.min(Math.max(s, 1), AI_LIMITS.maxWaitSeconds) : 0;
  return { ok: true, action: { action, target, seconds, stopReason: action === "stop" ? (stopReason === "none" ? "unknown_layout" : stopReason) : "none", note } };
}

/** JSON schema for the AI's answer (flat, every field required: works with structured outputs). */
export const AI_ACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: [...AI_ACTIONS], description: "The one next step" },
    target: { type: "integer", description: "For click: the index i of one listed element. Otherwise -1" },
    seconds: { type: "integer", description: "For wait: 1 to 5. Otherwise 0" },
    stopReason: { type: "string", enum: [...AI_STOP_REASONS], description: "For stop: why. Otherwise none" },
    note: { type: "string", description: "One short sentence (under 20 words) saying why, for the activity log" },
  },
  required: ["action", "target", "seconds", "stopReason", "note"],
  additionalProperties: false,
} as const;
