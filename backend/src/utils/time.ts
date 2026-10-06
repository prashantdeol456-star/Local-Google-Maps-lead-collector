// Time-zone helpers built on Intl only (no extra dependency).

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds the zone's wall clock is ahead of UTC at instant `t`. */
function zoneOffsetMs(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(t / 1000) * 1000;
}

/** The instant at which the calendar day containing `now` began in `timeZone`. */
export function startOfDayInZone(now: Date, timeZone: string): Date {
  const local = new Date(now.getTime() + zoneOffsetMs(now.getTime(), timeZone));
  const midnightWall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // Offset can differ at midnight vs. now (DST), so measure it at the candidate instant.
  const guess = midnightWall - zoneOffsetMs(midnightWall, timeZone);
  return new Date(midnightWall - zoneOffsetMs(guess, timeZone));
}

/** A Date whose UTC fields show the wall-clock time in `timeZone` (for spreadsheets, which have no zones). */
export function toWallClock(date: Date, timeZone: string): Date {
  return new Date(date.getTime() + zoneOffsetMs(date.getTime(), timeZone));
}

/** "2026-10-05 19:59" in `timeZone`. */
export function formatWallClock(date: Date, timeZone: string): string {
  return toWallClock(date, timeZone).toISOString().slice(0, 16).replace("T", " ");
}
