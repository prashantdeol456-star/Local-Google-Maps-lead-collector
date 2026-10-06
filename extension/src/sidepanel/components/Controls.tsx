import { nextStatus, type CollectorCommand, type CollectorStatus } from "@platform/shared";

interface Props {
  status: CollectorStatus;
  canStart: boolean;
  busy: boolean;
  onCommand: (c: CollectorCommand) => void;
}

export function Controls({ status, canStart, busy, onCommand }: Props) {
  const allowed = (c: CollectorCommand) => !busy && nextStatus(status, c) !== null;

  return (
    <div className="controls">
      <button className="btn btn--primary" disabled={!allowed("start") || !canStart} onClick={() => onCommand("start")}>
        {status === "paused" ? "RESUME" : "START"}
      </button>
      <button className="btn" disabled={!allowed("pause")} onClick={() => onCommand("pause")}>
        PAUSE
      </button>
      <button className="btn btn--danger" disabled={!allowed("stop")} onClick={() => onCommand("stop")}>
        STOP
      </button>
    </div>
  );
}
