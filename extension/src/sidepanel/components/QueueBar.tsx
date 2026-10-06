import { buildSearchQuery } from "@platform/shared";
import { nextQueued, type CollectorState } from "../../storage/state";

interface Props {
  state: CollectorState;
  busy: boolean;
  onStartNext: () => void;
}

/** Progress of a multi-keyword queue and the button to start the next search (never automatic). */
export function QueueBar({ state, busy, onStartNext }: Props) {
  const q = state.queue;
  if (!q) return null;
  const next = nextQueued(state);
  const finished = state.status === "completed" || state.status === "stopped" || state.status === "failed";
  const location = state.jobSettings?.location ?? "";

  return (
    <div className="card queue">
      <div className="queue__steps">
        {q.jobs.map((j, i) => (
          <span key={j.id} className={`queue__step ${i < q.index ? "is-done" : i === q.index ? "is-current" : ""}`} title={j.keyword}>
            {i + 1}. {j.keyword}
          </span>
        ))}
      </div>
      {next && finished && (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={onStartNext}>
          START NEXT: {buildSearchQuery(next.keyword, location)}
        </button>
      )}
      {!next && finished && <p className="queue__done">All {q.jobs.length} searches in the queue are done.</p>}
    </div>
  );
}
