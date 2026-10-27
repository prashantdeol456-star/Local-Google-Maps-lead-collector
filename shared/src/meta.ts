// Instagram and Facebook links, normalized the same way by the Meta Helper extension, the contact
// sheet import and the backend, so a profile saved twice is recognised as one.

/** Instagram paths that are not profiles. */
const IG_RESERVED = new Set([
  "p", "reel", "reels", "explore", "direct", "accounts", "stories", "tv", "about", "legal", "developer", "web", "challenge", "emails", "session", "popular", "privacy",
]);

/**
 * "https://www.instagram.com/<username>/" (lowercase) from a profile link or a bare
 * username ("@cakes_makes"). Anything else → null.
 */
export function normalizeInstagramUrl(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  // A bare username: letters, digits, dot and underscore, up to 30 characters.
  const bare = /^@?([A-Za-z0-9._]{1,30})$/.exec(raw);
  if (bare && !raw.includes("/") && !/^\d+$/.test(bare[1]!)) {
    const u = bare[1]!.toLowerCase();
    return IG_RESERVED.has(u) ? null : `https://www.instagram.com/${u}/`;
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;
  const m = /^\/([A-Za-z0-9._]{1,30})\/?/.exec(url.pathname);
  if (!m) return null;
  const u = m[1]!.toLowerCase();
  if (IG_RESERVED.has(u)) return null;
  return `https://www.instagram.com/${u}/`;
}

export function instagramUsername(url: string): string | null {
  return /^https:\/\/www\.instagram\.com\/([^/]+)\/$/.exec(url)?.[1] ?? null;
}

/**
 * Canonical Facebook link for a Page, profile or group: "https://www.facebook.com/<path>"
 * without query (except profile.php?id=…), trailing slash removed. Anything else → null.
 */
export function normalizeFacebookUrl(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "facebook.com" && !host.endsWith(".facebook.com") && host !== "fb.com") return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/profile.php") {
    const id = url.searchParams.get("id");
    return id && /^\d+$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  const group = /^\/groups\/([^/]+)/.exec(path);
  if (group) return `https://www.facebook.com/groups/${group[1]!.toLowerCase()}`;
  const people = /^\/people\/([^/]+)\/(\d+)/.exec(path);
  if (people) return `https://www.facebook.com/profile.php?id=${people[2]}`;
  const vanity = /^\/([A-Za-z0-9.\-]{2,100})$/.exec(path);
  if (!vanity) return null;
  const v = vanity[1]!;
  if (["search", "watch", "marketplace", "gaming", "events", "friends", "messages", "notifications", "groups", "pages", "login", "help", "settings"].includes(v.toLowerCase())) return null;
  return `https://www.facebook.com/${v.toLowerCase()}`;
}

/** "21.7K followers" → 21700; "1,234 members" → 1234; null when there is no number. */
export function parseCount(text: string | null | undefined): number | null {
  // The unit must not start a word: the "m" of "members" is not "M" (million).
  const m = /([\d.,]+)\s*(lakh|crore|[KkMmLl])?(?![A-Za-z])/.exec(text ?? "");
  if (!m) return null;
  let n = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k") n *= 1_000;
  else if (unit === "m") n *= 1_000_000;
  else if (unit === "l" || unit === "lakh") n *= 100_000;
  else if (unit === "crore") n *= 10_000_000;
  return Math.round(n);
}
