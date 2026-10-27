import { useCallback, useEffect, useState } from "react";
import type { CampaignOverview, RunnerState, WaitReason } from "../../messages";
import type { BackendStatus } from "../../storage/auth";
import { BackendStatusBar } from "../components/BackendStatusBar";
import { backendClient } from "../services/backendClient";
import { CollectPanel } from "./CollectPanel";

const WAIT_TEXT: Record<WaitReason, string> = {
  no_running_campaigns: "No running Instagram campaign. Start one in the admin panel (Instagram Outreach).",
  in_flight: "A message is still open in another Meta Helper.",
  not_started: "Waiting for the campaign's start time.",
  outside_window: "Outside the campaign's sending hours.",
  daily_limit: "Daily limit reached. Continues tomorrow.",
  interval: "Waiting for the gap between messages.",
};

const time = (iso: string | number | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

export function RunnerPage({ backendStatus, onLogout, onRetry }: { backendStatus: BackendStatus; onLogout: () => void; onRetry: () => void }) {
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"collect" | "campaigns">("collect");

  const refresh = useCallback(async () => {
    const res = await backendClient.runner();
    if (res.ok) setRunner(res.data);
  }, []);
  const refreshCampaigns = useCallback(async () => {
    const res = await backendClient.overview();
    if (res.ok) setCampaigns(res.data);
  }, []);

  useEffect(() => {
    refresh();
    refreshCampaigns();
    const a = setInterval(refresh, 2000);
    const b = setInterval(refreshCampaigns, 15_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refresh, refreshCampaigns]);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res.error ?? "Something went wrong");
    await refresh();
    await refreshCampaigns();
    setBusy(false);
  }

  const current = runner?.current;

  return (
    <div className="panel">
      <header className="panel__header">
        <h1>Meta Helper</h1>
        <span className={`badge ${runner?.running ? "badge--running" : "badge--paused"}`}>{runner?.running ? "Running" : "Stopped"}</span>
      </header>
      <BackendStatusBar status={backendStatus} onRetry={onRetry} />
      <div className="controls">
        <button className={`btn ${tab === "collect" ? "btn--primary" : ""}`} onClick={() => setTab("collect")}>
          Collect
        </button>
        <button className={`btn ${tab === "campaigns" ? "btn--primary" : ""}`} onClick={() => setTab("campaigns")}>
          Instagram messages
        </button>
      </div>
      {/* Kept mounted so watching continues while you look at campaigns. */}
      {tab === "collect" && <CollectPanel />}
      {tab === "campaigns" && (
        <>

      <section className="card">
        <p className="hint">
          Keep this browser open and logged in to Instagram. Messages go out from your own account, one at a time, at the pace set in the campaign. Instagram does
          not allow automated messaging and blocks or disables accounts that use it. Assisted mode, where you press Send, is the safer choice.
        </p>
        <div className="controls">
          {runner?.running ? (
            <button className="btn" disabled={busy} onClick={() => act(backendClient.stop)}>
              ■ Stop
            </button>
          ) : (
            <button className="btn btn--primary" disabled={busy} onClick={() => act(backendClient.start)}>
              ▶ Start
            </button>
          )}
        </div>
        {error && <p className="msg msg--error">{error}</p>}
        {runner?.lastError && <p className="msg msg--warn">{runner.lastError}</p>}
      </section>

      {current && (
        <section className="card">
          <p className="form__title">
            {current.mode === "assisted" ? "Your turn: check and press Send" : "Sending…"} · {current.contactName}
          </p>
          <p className="hint">
            {current.campaignName} · started {time(current.startedAt)}
            {current.mode === "assisted" && " · the Instagram tab has the message typed in. Edit it if you like, then press Send there."}
          </p>
          <pre className="msg" style={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto" }}>
            {current.body}
          </pre>
          <div className="controls">
            <button className="btn btn--ghost" disabled={busy} onClick={() => act(backendClient.skip)}>
              Skip this contact
            </button>
          </div>
        </section>
      )}

      {!current && runner?.running && runner.waiting && (
        <section className="card">
          <p className="hint">
            {WAIT_TEXT[runner.waiting.reason]}
            {runner.waiting.campaignName && ` (${runner.waiting.campaignName})`}
            {runner.waiting.nextCheckAt && ` Next at ${time(runner.waiting.nextCheckAt)}.`}
          </p>
        </section>
      )}

      <section className="card">
        <p className="form__title">Running campaigns</p>
        {campaigns === null && <p className="hint">Loading…</p>}
        {campaigns?.length === 0 && <p className="hint">None. Start a campaign in the admin panel → Instagram Outreach.</p>}
        <ul className="list">
          {campaigns?.map((c) => (
            <li key={c.id} className="list__item">
              <span className="list__text">
                <strong>{c.name}</strong> · {c.mode}
                <br />
                {c.sentToday}/{c.dailyLimit} today · {c.queued} left · {c.sent} sent
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <p className="form__title">Activity</p>
        {runner?.log.length === 0 && <p className="hint">Nothing yet.</p>}
        <ul className="list">
          {runner?.log.map((l, i) => (
            <li key={`${l.at}-${i}`} className={`list__item ${l.level === "ok" ? "list__item--saved" : l.level === "warn" || l.level === "error" ? "list__item--skipped" : ""}`}>
              <span className="list__text">
                {time(l.at)} {l.text}
              </span>
            </li>
          ))}
        </ul>
      </section>

        </>
      )}

      <button className="btn btn--ghost" onClick={onLogout}>
        Log out of the lead platform
      </button>
    </div>
  );
}
