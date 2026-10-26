// LinkedIn Helper: types and profile-URL normalization shared by the LinkedIn extension and
// the backend. Profiles are saved by hand, one at a time, from pages the user opened.

export interface LinkedInWebsite {
  url: string;
  /** As LinkedIn shows it, e.g. "Company", "Blog", "Personal" */
  label: string | null;
}

/** One position from the profile's Experience section. */
export interface LinkedInExperience {
  title: string;
  company: string | null;
  /** e.g. "Full-time" */
  employmentType: string | null;
  /** As shown, e.g. "Jul 2024 - Sep 2026 · 2 yrs 3 mos" */
  dates: string | null;
  location: string | null;
}

/** One entry from the profile's Education section. */
export interface LinkedInEducation {
  school: string;
  /** Degree and field of study as shown */
  degree: string | null;
  dates: string | null;
}

/** One profile as sent by the extension (or built from a CSV row). */
export interface LinkedInLeadInput {
  profileUrl: string;
  name: string;
  headline?: string | null;
  company?: string | null;
  location?: string | null;
  emails?: string[];
  phones?: string[];
  websites?: LinkedInWebsite[];
  ims?: string[];
  experience?: LinkedInExperience[];
  education?: LinkedInEducation[];
  birthday?: string | null;
  address?: string | null;
  connectedSince?: string | null;
  notes?: string | null;
  tag?: string | null;
}

/**
 * Canonical profile URL: "https://www.linkedin.com/in/<slug>" with a lowercase, decoded slug and
 * no query, hash or trailing path (/overlay/contact-info/, /details/…). Country subdomains
 * (in.linkedin.com) and the bare host are accepted. Anything else → null.
 */
export function normalizeLinkedInProfileUrl(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const match = /^\/in\/([^/]+)/i.exec(url.pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  slug = slug.trim().toLowerCase();
  if (!slug || slug.length > 200 || /[\s/?#]/.test(slug)) return null;
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
}
