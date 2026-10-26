// Filters for Google Maps leads, shared by the list (GET /api/leads) and the exports, so an
// export always contains exactly what the filtered list shows.

import { z } from "zod";
import type { LeadListQuery } from "../database/repositories/index.js";
import { startOfDayInZone } from "../utils/time.js";
import { optionalText } from "./validation.js";

const yesNo = z
  .enum(["yes", "no"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "yes"));

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .optional();

export const LeadFilterShape = {
  q: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  category: optionalText(100),
  keyword: optionalText(100),
  hasPhone: yesNo,
  hasEmail: yesNo,
  hasWebsite: yesNo,
  minRating: z.coerce.number().min(0).max(5).optional(),
  minReviews: z.coerce.number().int().min(0).max(10_000_000).optional(),
  /** Added on or after this day (app time zone) */
  from: day,
  /** Added on or before this day (app time zone) */
  to: day,
};

const LeadFilterObject = z.object(LeadFilterShape);
export type LeadFilterParams = z.infer<typeof LeadFilterObject>;

/** Start of a calendar day in the app's time zone. */
function dayStart(value: string, timeZone: string): Date {
  // Noon UTC is the same calendar day in every zone from UTC-11 to UTC+11.
  return startOfDayInZone(new Date(`${value}T12:00:00Z`), timeZone);
}

export function toLeadFilters(p: LeadFilterParams, timeZone: string): Omit<LeadListQuery, "sort" | "order" | "skip" | "take"> {
  return {
    q: p.q,
    city: p.city,
    state: p.state,
    category: p.category,
    searchKeyword: p.keyword,
    hasPhone: p.hasPhone,
    hasEmail: p.hasEmail,
    hasWebsite: p.hasWebsite,
    minRating: p.minRating,
    minReviews: p.minReviews,
    createdFrom: p.from ? dayStart(p.from, timeZone) : undefined,
    // Inclusive: everything before the start of the next calendar day.
    createdUntil: p.to ? dayStart(nextDay(p.to), timeZone) : undefined,
  };
}

function nextDay(value: string): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
