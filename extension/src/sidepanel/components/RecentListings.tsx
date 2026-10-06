import type { ExtractedListing } from "../../content/maps/types";

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function RecentListings({ items }: { items: ExtractedListing[] }) {
  if (items.length === 0) return null;
  return (
    <section className="card recent">
      <h2>Recent listings</h2>
      <ul>
        {items.map((l) => (
          <li key={l.clientKey}>
            <div className="recent__top">
              <strong>{l.name}</strong>
              {l.rating !== null && (
                <span className="recent__rating">
                  ★ {l.rating}
                  {l.reviewCount !== null && <> ({l.reviewCount.toLocaleString()})</>}
                </span>
              )}
            </div>
            <div className="recent__meta">
              {[l.category, l.city, l.phone, l.website && host(l.website)].filter(Boolean).join(" · ") || "No contact details"}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
