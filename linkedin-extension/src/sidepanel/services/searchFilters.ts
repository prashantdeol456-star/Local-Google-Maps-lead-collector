// LinkedIn people-search filters, as URL parameters of linkedin.com/search/results/people/.
// Checked on linkedin.com (Oct 2026): text fields are sent in quotes, multi-choice filters as
// JSON arrays. Locations, companies, industries etc. are LinkedIn ids that cannot be typed, so
// they are copied from a search page where the user picked them in LinkedIn's own filter panel.

export type Connection = "F" | "S" | "O";

export const CONNECTION_LABEL: Record<Connection, string> = { F: "1st", S: "2nd", O: "3rd+" };

export const PROFILE_LANGUAGES: [string, string][] = [
  ["", "Any language"],
  ["en", "English"],
  ["de", "German"],
  ["zh", "Chinese"],
];

/** Filters picked in LinkedIn's panel, copied from a search URL (param → label). */
export const COPIED_PARAMS: Record<string, string> = {
  geoUrn: "Locations",
  currentCompany: "Current companies",
  pastCompany: "Past companies",
  schoolFilter: "Schools",
  industry: "Industries",
  serviceCategory: "Service categories",
  connectionOf: "Connections of",
  followerOf: "Followers of",
  activelyHiringForJobTitles: "Actively hiring",
};

export interface PeopleSearchFilters {
  connections: Connection[];
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  school: string;
  language: string;
  /** Copied from a LinkedIn search URL; see COPIED_PARAMS */
  copied: Record<string, string>;
}

export const emptyFilters = (): PeopleSearchFilters => ({
  connections: [],
  firstName: "",
  lastName: "",
  title: "",
  company: "",
  school: "",
  language: "",
  copied: {},
});

const quoted = (v: string) => `"${v.trim().replace(/"/g, "")}"`;

/** LinkedIn's people search (the "People" filter) for a keyword and filters. */
export function peopleSearchUrl(keyword: string, filters: PeopleSearchFilters = emptyFilters()): string {
  const p = new URLSearchParams();
  if (keyword.trim()) p.set("keywords", keyword.trim());
  p.set("origin", "FACETED_SEARCH");
  if (filters.connections.length) p.set("network", JSON.stringify(filters.connections));
  const text: [string, string][] = [
    ["firstName", filters.firstName],
    ["lastName", filters.lastName],
    ["title", filters.title],
    ["company", filters.company],
    ["schoolFreetext", filters.school],
  ];
  for (const [name, value] of text) if (value.trim()) p.set(name, quoted(value));
  if (filters.language) p.set("profileLanguage", JSON.stringify([filters.language]));
  for (const [name, value] of Object.entries(filters.copied)) if (name in COPIED_PARAMS && value) p.set(name, value);
  return `https://www.linkedin.com/search/results/people/?${p.toString().replace(/\+/g, "%20")}`;
}

/** The id-based filters of a LinkedIn people-search URL (null when it is not one). */
export function copyFiltersFromUrl(url: string | null | undefined): Record<string, string> | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "www.linkedin.com" || !u.pathname.startsWith("/search/results/people")) return null;
  const copied: Record<string, string> = {};
  for (const name of Object.keys(COPIED_PARAMS)) {
    const value = u.searchParams.get(name);
    if (value) copied[name] = value;
  }
  return copied;
}

/** "Locations (2), Industries (1)" */
export function describeCopied(copied: Record<string, string>): string {
  return Object.entries(copied)
    .map(([name, value]) => {
      let count = 1;
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) count = parsed.length;
      } catch {
        // a single value
      }
      return `${COPIED_PARAMS[name] ?? name} (${count})`;
    })
    .join(", ");
}

export function hasAnyFilter(f: PeopleSearchFilters): boolean {
  const text = [f.firstName, f.lastName, f.title, f.company, f.school, f.language].some((v) => v.trim());
  return f.connections.length > 0 || text || Object.keys(f.copied).length > 0;
}
