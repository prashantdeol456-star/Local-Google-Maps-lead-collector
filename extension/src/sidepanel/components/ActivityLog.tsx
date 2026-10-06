import type { LogEntry } from "../../storage/state";

const ICONS: Record<LogEntry["level"], string> = { info: "●", success: "✓", warning: "!", error: "✕" };

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  return (
    <section className="card log">
      <h2>Activity</h2>
      {entries.length === 0 ? (
        <p className="log__empty">No activity yet. Press START to begin.</p>
      ) : (
        <ol>
          {[...entries].reverse().map((e) => (
            <li key={e.id} className={`log__item log__item--${e.level}`}>
              <span className="log__icon" aria-hidden>
                {ICONS[e.level]}
              </span>
              <span className="log__msg">{e.message}</span>
              <time>{time(e.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
