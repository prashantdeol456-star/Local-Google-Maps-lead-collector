import { normalizeLinkedInProfileUrl } from "@platform/shared";
import { emptyFilters, type PeopleSearchFilters } from "../sidepanel/services/searchFilters";

// The user's list of profiles to go through, one click at a time. Lives in chrome.storage.local.

export type QueueStatus = "pending" | "opened" | "saved" | "skipped";

export interface QueueItem {
  profileUrl: string;
  name: string | null;
  status: QueueStatus;
}

export const MAX_QUEUE = 1000;

/**
 * Adds new profiles at the end (at most `limit` new ones); known ones keep their status
 * (a missing name is filled in).
 */
export function addToQueue(queue: QueueItem[], links: { profileUrl: string; name?: string | null }[], limit = Infinity): { queue: QueueItem[]; added: number } {
  const next = queue.map((q) => ({ ...q }));
  const index = new Map(next.map((q, i) => [q.profileUrl, i]));
  let added = 0;
  for (const link of links) {
    const url = normalizeLinkedInProfileUrl(link.profileUrl);
    if (!url) continue;
    const at = index.get(url);
    if (at !== undefined) {
      if (!next[at]!.name && link.name) next[at]!.name = link.name;
      continue;
    }
    if (next.length >= MAX_QUEUE || added >= limit) break;
    index.set(url, next.length);
    next.push({ profileUrl: url, name: link.name ?? null, status: "pending" });
    added++;
  }
  return { queue: next, added };
}

export function setStatus(queue: QueueItem[], profileUrl: string, status: QueueStatus): QueueItem[] {
  const url = normalizeLinkedInProfileUrl(profileUrl) ?? profileUrl;
  return queue.map((q) => (q.profileUrl === url ? { ...q, status } : q));
}

/** Marks the ones the backend already has as saved. */
export function markSaved(queue: QueueItem[], savedUrls: Iterable<string>): QueueItem[] {
  const saved = new Set([...savedUrls].map((u) => normalizeLinkedInProfileUrl(u) ?? u));
  return queue.map((q) => (saved.has(q.profileUrl) && q.status !== "saved" ? { ...q, status: "saved" } : q));
}

export function nextPending(queue: QueueItem[]): QueueItem | null {
  return queue.find((q) => q.status === "pending") ?? null;
}

/** Profile links pasted as text: one per line, or separated by commas/spaces. */
export function parsePastedLinks(text: string): { profileUrl: string }[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => normalizeLinkedInProfileUrl(s))
    .filter((u): u is string => !!u)
    .map((profileUrl) => ({ profileUrl }));
}

const KEY = "helper";

export interface HelperState {
  queue: QueueItem[];
  tag: string;
  /** Last people search typed in the side panel */
  keyword: string;
  /** Read a profile as soon as it opens (default on) */
  autoRead: boolean;
  /** Add the profiles of each people-search results page the user opens (default on) */
  autoAdd: boolean;
  /** How many profiles the user wants in this round; null = no target */
  target: number | null;
  /** People-search filters for the Search button */
  filters: PeopleSearchFilters;
  /** Most profiles to open per day (see DAILY_LIMIT_*) */
  dailyLimit: number;
  /** Profiles read today */
  usage: DailyUsage;
  /** Day on which LinkedIn showed a security check; the helper stops for that day */
  pausedOn: string | null;
}

// ---- Daily pace. LinkedIn publishes no number; ~80 profile views a day is commonly seen as
// normal for a free account and ~150 for Premium. ----

export const DEFAULT_DAILY_LIMIT = 80;
export const MAX_DAILY_LIMIT = 150;
/** Suggest a short break after this many profiles. */
export const BREAK_EVERY = 25;

export interface DailyUsage {
  /** Local date, YYYY-MM-DD */
  date: string;
  /** Distinct profiles read on that date */
  profiles: string[];
}

export function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Profiles read today (0 on a new day). */
export function usedToday(usage: DailyUsage, now = new Date()): number {
  return usage.date === localDay(now) ? usage.profiles.length : 0;
}

/** Counts a profile once per day. */
export function recordProfile(usage: DailyUsage, profileUrl: string, now = new Date()): DailyUsage {
  const day = localDay(now);
  const profiles = usage.date === day ? usage.profiles : [];
  return profiles.includes(profileUrl) ? { date: day, profiles } : { date: day, profiles: [...profiles, profileUrl] };
}

export function clampDailyLimit(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_DAILY_LIMIT) : DEFAULT_DAILY_LIMIT;
}

/** LinkedIn's security check / sign-in wall pages. */
export function isSecurityCheckUrl(url: string | null | undefined): boolean {
  return !!url && /^https:\/\/www\.linkedin\.com\/(checkpoint|authwall|uas\/login)/.test(url);
}

/** Profiles that count towards the target: everything in the list except skipped ones. */
export function countTowardsTarget(queue: QueueItem[]): number {
  return queue.filter((q) => q.status !== "skipped").length;
}

/** How many more profiles may be added before the target is reached. */
export function roomForTarget(queue: QueueItem[], target: number | null): number {
  return target ? Math.max(0, target - countTowardsTarget(queue)) : Infinity;
}

export async function loadHelperState(): Promise<HelperState> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<HelperState> | undefined;
  return {
    queue: stored?.queue ?? [],
    tag: stored?.tag ?? "",
    keyword: stored?.keyword ?? "",
    autoRead: stored?.autoRead ?? true,
    autoAdd: stored?.autoAdd ?? true,
    target: stored?.target ?? null,
    filters: { ...emptyFilters(), ...stored?.filters },
    dailyLimit: clampDailyLimit(stored?.dailyLimit ?? DEFAULT_DAILY_LIMIT),
    usage: stored?.usage ?? { date: localDay(), profiles: [] },
    pausedOn: stored?.pausedOn ?? null,
  };
}

export function saveHelperState(state: HelperState): Promise<void> {
  return chrome.storage.local.set({ [KEY]: state });
}
