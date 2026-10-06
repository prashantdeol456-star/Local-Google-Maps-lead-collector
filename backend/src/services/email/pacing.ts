// Decides whether a running campaign may send its next email now. Pure and deterministic:
// a fixed interval between sends, a daily cap and a local-time sending window.
// No random delays (the goal is respecting limits, not disguising traffic).

import { startOfDayInZone, toWallClock } from "../../utils/time.js";

export interface PacingInput {
  intervalSec: number;
  dailyLimit: number;
  windowStart: string; // "HH:MM"
  windowEnd: string; // "HH:MM"
  timeZone: string;
  startAt: Date | null;
  lastSentAt: Date | null;
  sentToday: number;
}

export type PacingDecision =
  | { send: true }
  | { send: false; reason: "not_started" | "outside_window" | "daily_limit" | "interval"; nextCheckAt: Date };

export function parseClock(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes since local midnight in the time zone. */
function localMinutes(now: Date, timeZone: string): number {
  const wall = toWallClock(now, timeZone);
  return wall.getUTCHours() * 60 + wall.getUTCMinutes();
}

export function inWindow(now: Date, windowStart: string, windowEnd: string, timeZone: string): boolean {
  const start = parseClock(windowStart);
  const end = parseClock(windowEnd);
  if (start === null || end === null) return false;
  const m = localMinutes(now, timeZone);
  // A window like 22:00–06:00 crosses midnight.
  return start <= end ? m >= start && m < end : m >= start || m < end;
}

/** Next time the window opens (start of the next minute where inWindow is true, searched minute by minute up to 24h). */
function nextWindowOpen(now: Date, p: PacingInput): Date {
  const minute = 60_000;
  let t = new Date(Math.floor(now.getTime() / minute) * minute + minute);
  for (let i = 0; i < 24 * 60; i++, t = new Date(t.getTime() + minute)) {
    if (inWindow(t, p.windowStart, p.windowEnd, p.timeZone)) return t;
  }
  return new Date(now.getTime() + 24 * 60 * minute);
}

export function decideSend(now: Date, p: PacingInput): PacingDecision {
  if (p.startAt && now < p.startAt) return { send: false, reason: "not_started", nextCheckAt: p.startAt };
  if (!inWindow(now, p.windowStart, p.windowEnd, p.timeZone)) {
    return { send: false, reason: "outside_window", nextCheckAt: nextWindowOpen(now, p) };
  }
  if (p.sentToday >= p.dailyLimit) {
    // The count resets at local midnight; sending resumes when the window next opens after that.
    const tomorrow = startOfDayInZone(new Date(now.getTime() + 24 * 60 * 60 * 1000), p.timeZone);
    const opensAt = inWindow(tomorrow, p.windowStart, p.windowEnd, p.timeZone) ? tomorrow : nextWindowOpen(tomorrow, p);
    return { send: false, reason: "daily_limit", nextCheckAt: opensAt };
  }
  if (p.lastSentAt) {
    const due = p.lastSentAt.getTime() + p.intervalSec * 1000;
    if (now.getTime() < due) return { send: false, reason: "interval", nextCheckAt: new Date(due) };
  }
  return { send: true };
}

/** Wait before retrying after a temporary provider error: 1 min, 5 min, 15 min, 60 min. */
export const RETRY_DELAYS_MIN = [1, 5, 15, 60];
export const MAX_TRIES = RETRY_DELAYS_MIN.length + 1;
