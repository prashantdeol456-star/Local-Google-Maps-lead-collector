import type { SyncState } from "../../storage/state";

/** Shows whether every collected record has reached the backend. */
export function SyncStatus({ sync, onRetry }: { sync: SyncState; onRetry: () => void }) {
  if (sync.pending === 0) {
    return <p className="sync sync--ok">✓ All records saved to the database</p>;
  }
  return (
    <div className={`sync ${sync.lastError ? "sync--warn" : ""}`} role="status">
      <span>
        {sync.pending} {sync.pending === 1 ? "record" : "records"} waiting to be saved
        {sync.lastError ? ` (${sync.lastError})` : "…"}
      </span>
      {sync.lastError && (
        <button type="button" className="link" onClick={onRetry}>
          Retry now
        </button>
      )}
    </div>
  );
}
