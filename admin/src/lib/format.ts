const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat();

export function formatDate(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : "—";
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : number.format(value);
}

/** "2 min ago" style for recent times, otherwise the date. */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const diff = (now - new Date(value).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  return formatDate(value);
}

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only http(s) links are rendered as clickable (data comes from scraped pages). */
export function safeHref(url: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
