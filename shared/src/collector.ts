// Collector settings, job status and state transitions. Shared by the extension and the backend.

export const COLLECTOR_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "category", label: "Category" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "rating", label: "Rating" },
  { key: "reviewCount", label: "Review Count" },
  { key: "mapsUrl", label: "Maps URL" },
] as const;

export type CollectorFieldKey = (typeof COLLECTOR_FIELDS)[number]["key"];
export type CollectorFieldSelection = Record<CollectorFieldKey, boolean>;

export const MAX_RECORDS_LIMIT = 5000;

export interface CollectorSettings {
  keyword: string;
  location: string;
  maxRecords: number;
  fields: CollectorFieldSelection;
  /** Optional AI help when the results list cannot be found (off unless the user turns it on). */
  aiAssist?: boolean;
}

export function defaultCollectorSettings(): CollectorSettings {
  return {
    keyword: "",
    location: "",
    maxRecords: 500,
    fields: Object.fromEntries(COLLECTOR_FIELDS.map((f) => [f.key, true])) as CollectorFieldSelection,
  };
}

export type SettingsErrors = Partial<Record<"keyword" | "location" | "maxRecords" | "fields", string>>;

export const MAX_QUEUE_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 100;

/**
 * Splits the keyword field into a search queue: "University, College\nEngineering College"
 * → ["University", "College", "Engineering College"]. Duplicates (case-insensitive) are dropped.
 */
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/[,\n;]/)) {
    const k = part.replace(/\s+/g, " ").trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

export function validateCollectorSettings(s: CollectorSettings): SettingsErrors {
  const errors: SettingsErrors = {};
  const keywords = parseKeywords(s.keyword);
  if (keywords.length === 0) errors.keyword = "Search keyword is required";
  else if (keywords.some((k) => k.length > MAX_KEYWORD_LENGTH)) {
    errors.keyword = `Keyword is too long (max ${MAX_KEYWORD_LENGTH} characters)`;
  } else if (keywords.length > MAX_QUEUE_KEYWORDS) errors.keyword = `At most ${MAX_QUEUE_KEYWORDS} keywords at a time`;
  if (s.location.trim().length > 100) errors.location = "Location is too long (max 100 characters)";
  if (!Number.isInteger(s.maxRecords) || s.maxRecords < 1 || s.maxRecords > MAX_RECORDS_LIMIT) {
    errors.maxRecords = `Maximum records must be a whole number from 1 to ${MAX_RECORDS_LIMIT}`;
  }
  if (!s.fields.name) errors.fields = "Name is always collected";
  return errors;
}

/** "University" + "Lucknow" → "University in Lucknow" */
export function buildSearchQuery(keyword: string, location: string): string {
  const k = keyword.trim().replace(/\s+/g, " ");
  const l = location.trim().replace(/\s+/g, " ");
  return l ? `${k} in ${l}` : k;
}

// ---- Job status ----

export const JOB_STATUSES = ["pending", "running", "paused", "completed", "failed", "stopped"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** "idle" = no job yet in this browser. */
export type CollectorStatus = "idle" | JobStatus;
export type CollectorCommand = "start" | "pause" | "stop";

const FINISHED: ReadonlySet<CollectorStatus> = new Set(["idle", "completed", "failed", "stopped"]);

/** Returns the next status, or null when the command is not allowed in the current status. */
export function nextStatus(current: CollectorStatus, command: CollectorCommand): CollectorStatus | null {
  switch (command) {
    case "start":
      return FINISHED.has(current) || current === "paused" || current === "pending" ? "running" : null;
    case "pause":
      return current === "running" ? "paused" : null;
    case "stop":
      return current === "running" || current === "paused" || current === "pending" ? "stopped" : null;
  }
}

/** True when "start" begins a new job (counters reset) rather than resuming a paused one. */
export function startsNewJob(current: CollectorStatus): boolean {
  return FINISHED.has(current);
}

export function isActive(status: CollectorStatus): boolean {
  return status === "running" || status === "paused" || status === "pending";
}

/**
 * Allowed status changes for a stored CollectionJob (backend).
 * completed / failed / stopped are final: a new run is a new job.
 */
const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ["running", "stopped", "failed"],
  running: ["paused", "completed", "stopped", "failed"],
  paused: ["running", "stopped", "failed"],
  completed: [],
  failed: [],
  stopped: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function isFinalJobStatus(status: JobStatus): boolean {
  return JOB_TRANSITIONS[status].length === 0;
}

export interface CollectorCounters {
  found: number;
  new: number;
  duplicate: number;
  errors: number;
}

export const EMPTY_COUNTERS: CollectorCounters = { found: 0, new: 0, duplicate: 0, errors: 0 };
