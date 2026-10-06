import type { CollectorCounters } from "@platform/shared";

const TILES: { key: keyof CollectorCounters; label: string; tone?: string }[] = [
  { key: "found", label: "Found" },
  { key: "new", label: "New", tone: "good" },
  { key: "duplicate", label: "Duplicate", tone: "muted" },
  { key: "errors", label: "Errors", tone: "bad" },
];

export function StatsGrid({ counters }: { counters: CollectorCounters }) {
  return (
    <div className="stats">
      {TILES.map((t) => (
        <div key={t.key} className={`stat ${t.tone ? `stat--${t.tone}` : ""}`}>
          <span className="stat__value">{counters[t.key].toLocaleString()}</span>
          <span className="stat__label">{t.label}</span>
        </div>
      ))}
    </div>
  );
}
