import { isActive, validateCollectorSettings, type CollectorCommand } from "@platform/shared";
import { useState } from "react";
import type { BackendStatus } from "../../storage/auth";
import { ActivityLog } from "../components/ActivityLog";
import { BackendStatusBar } from "../components/BackendStatusBar";
import { Controls } from "../components/Controls";
import { PageStatus } from "../components/PageStatus";
import { QueueBar } from "../components/QueueBar";
import { RecentListings } from "../components/RecentListings";
import { SettingsForm } from "../components/SettingsForm";
import { StatsGrid } from "../components/StatsGrid";
import { SyncStatus } from "../components/SyncStatus";
import { collectorClient, useActivePage, useCollectorSettings, useCollectorState } from "../services/collectorClient";

const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  pending: "Pending",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

interface Props {
  backendStatus: BackendStatus;
  onLogout: () => void;
  onRetry: () => void;
}

export function CollectorPage({ backendStatus, onLogout, onRetry }: Props) {
  const state = useCollectorState();
  const page = useActivePage();
  const [settings, setSettings] = useCollectorSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!settings) return <div className="loading">Loading…</div>;

  const errors = validateCollectorSettings(settings);
  const formValid = Object.keys(errors).length === 0;
  const active = isActive(state.status);
  const canStart = state.status === "paused" || (formValid && !!page?.isMaps);

  async function run(command: CollectorCommand) {
    setBusy(true);
    setError(null);
    const res = await collectorClient.command(command, settings!);
    if (!res.ok) setError(res.error);
    setBusy(false);
  }

  async function openSearch(query: string) {
    setError(null);
    const res = await collectorClient.openSearch(query);
    if (!res.ok) setError(res.error);
  }

  async function startNext() {
    setBusy(true);
    setError(null);
    const res = await collectorClient.startNext();
    if (!res.ok) setError(res.error);
    setBusy(false);
  }

  return (
    <main className="panel">
      <header className="panel__header">
        <h1>Maps Data Collector</h1>
        <span className={`badge badge--${state.status}`}>{STATUS_LABEL[state.status]}</span>
      </header>

      <BackendStatusBar status={backendStatus} onLogout={onLogout} onRetry={onRetry} />
      <PageStatus page={page} />

      {active && state.jobLabel && (
        <p className="job-label">
          Job: <strong>{state.jobLabel}</strong>
        </p>
      )}

      <SettingsForm
        settings={settings}
        errors={errors}
        disabled={active}
        onChange={setSettings}
        onOpenSearch={openSearch}
      />

      <Controls status={state.status} canStart={canStart} busy={busy} onCommand={run} />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <QueueBar state={state} busy={busy} onStartNext={startNext} />

      <StatsGrid counters={state.counters} />
      <SyncStatus sync={state.sync} onRetry={() => collectorClient.retrySync()} />
      <RecentListings items={state.recent} />
      <ActivityLog entries={state.log} />
    </main>
  );
}
