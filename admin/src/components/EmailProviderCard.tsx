import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { ErrorBox, Spinner } from "./ui";

interface ProviderInfo {
  provider: "log" | "resend" | "smtp";
  from: string;
  replyTo: string | null;
  sendsRealEmail: boolean;
  capabilities: Record<string, boolean>;
  details: Record<string, string | number | boolean | null>;
  tracking: { clickTracking: boolean; publicBaseUrl: string | null; webhookUrl: string | null };
}

const PROVIDER_LABEL = { log: "Development (no sending)", resend: "Resend", smtp: "SMTP" };
const CAPABILITY_LABEL: Record<string, string> = {
  delivery: "Delivery",
  opens: "Opens (approx.)",
  clicks: "Clicks",
  bounces: "Bounces",
  replies: "Replies",
  batch: "Batch send",
  statusLookup: "Status lookup",
};

export function EmailProviderCard({ defaultTo }: { defaultTo: string }) {
  const info = useQuery({ queryKey: ["email-provider"], queryFn: () => api<ProviderInfo>("/email/provider") });
  const [to, setTo] = useState(defaultTo);
  const test = useMutation({
    mutationFn: (address: string) =>
      api<{ externalMessageId: string; sentReal: boolean }>("/email/send-test", { method: "POST", body: { to: address } }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    test.mutate(to.trim());
  }

  return (
    <section className="card mb-6">
      <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">Email provider</h2>
        <p className="text-xs text-slate-500">Configured in backend/.env (EMAIL_PROVIDER and related settings). Secrets are never shown here.</p>
      </div>
      {info.isPending && <Spinner />}
      {info.error && <div className="p-4"><ErrorBox error={info.error} /></div>}
      {info.data && (
        <div className="space-y-5 p-5 text-sm">
          {!info.data.sendsRealEmail && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Development mode: emails are only recorded, nothing is delivered. Set <code>EMAIL_PROVIDER=resend</code> or{" "}
              <code>smtp</code> in backend/.env and restart the backend to send real email.
            </p>
          )}
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="label">Provider</dt>
              <dd className="mt-1 font-medium">{PROVIDER_LABEL[info.data.provider]}</dd>
            </div>
            <div>
              <dt className="label">From</dt>
              <dd className="mt-1 break-all">{info.data.from}</dd>
            </div>
            <div>
              <dt className="label">Reply-to</dt>
              <dd className="mt-1 break-all">{info.data.replyTo ?? "—"}</dd>
            </div>
            {Object.entries(info.data.details)
              .filter(([k]) => k !== "note")
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="label">{k}</dt>
                  <dd className="mt-1 break-all">{v === null ? "—" : String(v)}</dd>
                </div>
              ))}
          </dl>
          <div>
            <p className="label mb-2">Tracking this provider supports</p>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(info.data.capabilities).map(([k, on]) => (
                <li
                  key={k}
                  className={`rounded-full px-2.5 py-0.5 text-xs ${on ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-slate-100 text-slate-400 line-through dark:bg-slate-800"}`}
                >
                  {CAPABILITY_LABEL[k] ?? k}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="label">Tracking</p>
            <p>
              Public address (PUBLIC_BASE_URL): {info.data.tracking.publicBaseUrl ? <code>{info.data.tracking.publicBaseUrl}</code> : <span className="text-amber-600">not set: unsubscribe and click links will not work for recipients</span>}
            </p>
            <p>Click tracking: {info.data.tracking.clickTracking ? "on" : "off"} (EMAIL_TRACK_CLICKS)</p>
            {info.data.provider === "resend" && (
              <div className="text-xs text-slate-600 dark:text-slate-300">
                {info.data.tracking.webhookUrl ? (
                  <>
                    <p className="mb-1">To receive delivery, open and bounce events, in the Resend dashboard → Webhooks → Add endpoint:</p>
                    <ol className="list-decimal space-y-0.5 pl-5">
                      <li>
                        URL: <code className="break-all">{info.data.tracking.webhookUrl}</code>
                      </li>
                      <li>Events: all <code>email.*</code> events</li>
                      <li>
                        Copy the signing secret (<code>whsec_…</code>) into <code>RESEND_WEBHOOK_SECRET</code> in backend/.env and restart.
                      </li>
                    </ol>
                  </>
                ) : (
                  <p className="text-amber-600">Set PUBLIC_BASE_URL to get the webhook address for Resend.</p>
                )}
              </div>
            )}
          </div>

          <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <label className="block min-w-64 flex-1 space-y-1">
              <span className="label">Send a test email to</span>
              <input className="input" type="email" required value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button className="btn btn-primary" disabled={test.isPending}>
              {test.isPending ? "Sending…" : "Send test email"}
            </button>
          </form>
          {test.error && <ErrorBox error={test.error} />}
          {test.data && (
            <p className="text-emerald-700 dark:text-emerald-400" role="status">
              {test.data.sentReal
                ? `Sent. Check the inbox of ${to} (message id ${test.data.externalMessageId}).`
                : `Recorded by the development provider (nothing was delivered). Message id ${test.data.externalMessageId}.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
