import type { BackendStatus } from "../../storage/auth";

interface Props {
  status: BackendStatus;
  onLogout?: () => void;
  onRetry?: () => void;
}

export function BackendStatusBar({ status, onLogout, onRetry }: Props) {
  const offline = status.reachable === false;
  const dbDown = status.reachable && status.database === "unreachable";
  const tone = offline || dbDown ? "off" : status.reachable ? "on" : "wait";

  let title: string;
  if (status.reachable === null) title = "Checking backend…";
  else if (offline) title = "Backend offline";
  else if (dbDown) title = "Backend database unreachable";
  else title = "Backend connected";

  return (
    <div className={`backend backend--${tone}`} role="status">
      <span className="dot" />
      <div className="backend__text">
        <strong>{title}</strong>
        <span>
          {offline ? (
            <>
              Start it with <code>npm run dev:backend</code>
            </>
          ) : (
            <>
              {status.admin?.email ?? status.backendUrl}
              {status.admin && <span className="backend__url"> · {status.backendUrl.replace(/^https?:\/\//, "")}</span>}
            </>
          )}
        </span>
      </div>
      {offline && onRetry && (
        <button type="button" className="link" onClick={onRetry}>
          Retry
        </button>
      )}
      {status.loggedIn && onLogout && (
        <button type="button" className="link" onClick={onLogout}>
          Log out
        </button>
      )}
    </div>
  );
}
