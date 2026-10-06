import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatRelative } from "../lib/format";
import type { ApiToken, DeliveryResult, IntegrationEventType, Page, WebhookDelivery, WebhookEndpoint } from "../lib/types";

interface EventInfo {
  type: IntegrationEventType;
  description: string;
}

/** A value shown in full only once (a new secret or token), with a copy button. */
function OnceSecret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950" role="status">
      <p className="font-medium text-amber-800 dark:text-amber-300">{label}: copy it now, it will not be shown again.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-white px-2 py-1 text-xs dark:bg-slate-900">{value}</code>
        <button
          type="button"
          className="btn px-2 py-1 text-xs"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn px-2 py-1 text-xs" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function EventPicker({ events, value, onChange }: { events: EventInfo[]; value: IntegrationEventType[]; onChange: (v: IntegrationEventType[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="label mb-1">Send these events</legend>
      {events.map((e) => (
        <label key={e.type} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={value.includes(e.type)}
            onChange={(ev) => onChange(ev.target.checked ? [...value, e.type] : value.filter((v) => v !== e.type))}
          />
          <span>
            <code className="text-xs">{e.type}</code> <span className="text-slate-500">{e.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function NewWebhook({ events, onCreated }: { events: EventInfo[]; onCreated: (secret: string) => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("n8n");
  const [url, setUrl] = useState("http://localhost:5678/webhook/lead-platform");
  const [selected, setSelected] = useState<IntegrationEventType[]>(["lead.created"]);
  const create = useMutation({
    mutationFn: () => api<{ endpoint: WebhookEndpoint; secret: string }>("/integrations/webhooks", { method: "POST", body: { name, url, events: selected } }),
    onSuccess: ({ secret }) => {
      client.invalidateQueries({ queryKey: ["webhooks"] });
      onCreated(secret);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-4 border-b border-slate-200 p-5 dark:border-slate-800">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="label">Name</span>
          <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="label">Webhook URL (from the n8n Webhook node)</span>
          <input className="input font-mono text-sm" required value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
      </div>
      <EventPicker events={events} value={selected} onChange={setSelected} />
      {create.error && <ErrorBox error={create.error} />}
      <button className="btn btn-primary" disabled={create.isPending || selected.length === 0}>
        {create.isPending ? "Adding…" : "Add webhook"}
      </button>
    </form>
  );
}

function Deliveries({ endpointId }: { endpointId: string }) {
  const client = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["webhook-deliveries", endpointId, status, page],
    queryFn: () => api<Page<WebhookDelivery>>(`/integrations/webhooks/${endpointId}/deliveries${qs({ status, page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api<{ result: DeliveryResult }>(`/integrations/deliveries/${id}/retry`, { method: "POST" }),
    onSettled: () => {
      client.invalidateQueries({ queryKey: ["webhook-deliveries", endpointId] });
      client.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
  const color = { delivered: "text-emerald-600", pending: "text-amber-600", failed: "text-red-600" } as const;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <span className="label">Delivery log</span>
        <select className="input w-auto py-1 text-xs" aria-label="Filter deliveries" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      {list.error && <div className="p-3"><ErrorBox error={list.error} /></div>}
      {retry.error && <div className="p-3"><ErrorBox error={retry.error} /></div>}
      {list.data?.items.length === 0 && <p className="px-3 py-4 text-xs text-slate-500">Nothing yet.</p>}
      <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
        {list.data?.items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <code>{d.event}</code> <span className={color[d.status]}>{d.status}</span>
              <span className="text-slate-500">
                {" "}· {formatDate(d.createdAt)} · {d.attempts} {d.attempts === 1 ? "try" : "tries"}
                {d.status === "pending" && d.attempts > 0 ? ` · next ${formatRelative(d.nextAttemptAt)}` : ""}
              </span>
              {d.lastError && <span className="block text-red-600">{d.lastError}</span>}
            </div>
            {d.status !== "delivered" && (
              <button className="btn px-2 py-0.5 text-xs" disabled={retry.isPending} onClick={() => retry.mutate(d.id)}>
                Send now
              </button>
            )}
          </li>
        ))}
      </ul>
      {list.data && list.data.total > 20 && <Pagination page={page} pageSize={20} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

function WebhookRow({ endpoint: e, events }: { endpoint: WebhookEndpoint; events: EventInfo[] }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(e.events);
  const [secret, setSecret] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["webhooks"] });
  const patch = useMutation({
    mutationFn: (body: Partial<Pick<WebhookEndpoint, "enabled" | "events">>) => api(`/integrations/webhooks/${e.id}`, { method: "PATCH", body }),
    onSuccess: () => (setEditing(false), refresh()),
  });
  const test = useMutation({
    mutationFn: () => api<{ result: DeliveryResult }>(`/integrations/webhooks/${e.id}/test`, { method: "POST" }),
    onSettled: () => (refresh(), client.invalidateQueries({ queryKey: ["webhook-deliveries", e.id] })),
  });
  const rotate = useMutation({
    mutationFn: () => api<{ secret: string }>(`/integrations/webhooks/${e.id}/rotate-secret`, { method: "POST" }),
    onSuccess: (r) => (setSecret(r.secret), refresh()),
  });
  const remove = useMutation({ mutationFn: () => api(`/integrations/webhooks/${e.id}`, { method: "DELETE" }), onSuccess: refresh });
  const d = e.deliveries;

  return (
    <li className="space-y-2 px-5 py-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {e.name} {!e.enabled && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">Disabled</span>}
          </p>
          <p className="break-all font-mono text-xs text-slate-500">{e.url}</p>
          <p className="mt-1 text-xs text-slate-500">
            {e.events.join(", ")} · secret <code>{e.secret}</code>
            {d && ` · ${d.delivered} delivered, ${d.pending} pending, ${d.failed} failed`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn px-2 py-1 text-xs" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Sending…" : "Send test"}
          </button>
          <button className="btn px-2 py-1 text-xs" onClick={() => setOpen(!open)}>
            {open ? "Hide log" : "Log"}
          </button>
          <button className="btn px-2 py-1 text-xs" onClick={() => setEditing(!editing)}>
            Edit
          </button>
          <button className="btn px-2 py-1 text-xs" disabled={patch.isPending} onClick={() => patch.mutate({ enabled: !e.enabled })}>
            {e.enabled ? "Disable" : "Enable"}
          </button>
          <ConfirmButton label="New secret" confirmLabel="Replace secret" className="btn px-2 py-1 text-xs" onConfirm={() => rotate.mutate()} disabled={rotate.isPending} />
          <ConfirmButton label="Delete" className="btn btn-danger px-2 py-1 text-xs" onConfirm={() => remove.mutate()} disabled={remove.isPending} />
        </div>
      </div>
      {test.data && (
        <p className={test.data.result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"} role="status">
          {test.data.result.ok ? `Test delivered (HTTP ${test.data.result.status}).` : `Test failed: ${test.data.result.error}`}
        </p>
      )}
      {[test.error, patch.error, rotate.error, remove.error].map((err, i) => err && <ErrorBox key={i} error={err} />)}
      {secret && <OnceSecret label="New signing secret (update the Header Auth value in n8n)" value={secret} onDone={() => setSecret(null)} />}
      {editing && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <EventPicker events={events} value={selected} onChange={setSelected} />
          <button className="btn btn-primary px-2 py-1 text-xs" disabled={patch.isPending || selected.length === 0} onClick={() => patch.mutate({ events: selected })}>
            Save events
          </button>
        </div>
      )}
      {open && <Deliveries endpointId={e.id} />}
    </li>
  );
}

function IntegrationTokens() {
  const client = useQueryClient();
  const [name, setName] = useState("n8n");
  const [scope, setScope] = useState<"read" | "full">("read");
  const [days, setDays] = useState(365);
  const [token, setToken] = useState<string | null>(null);
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<{ tokens: ApiToken[] }>("/auth/tokens").then((r) => r.tokens) });
  const create = useMutation({
    mutationFn: () => api<{ token: string }>("/auth/tokens", { method: "POST", body: { name, scope, expiresInDays: days } }),
    onSuccess: (r) => (setToken(r.token), client.invalidateQueries({ queryKey: ["tokens"] })),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tokens"] }),
  });
  const integrationTokens = tokens.data?.filter((t) => t.scope === "read" || !/chrome extension/i.test(t.name));

  return (
    <section className="card mt-6">
      <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">API tokens for n8n</h2>
        <p className="text-xs text-slate-500">
          For n8n&apos;s HTTP Request node (Header Auth: name <code>Authorization</code>, value <code>Bearer &lt;token&gt;</code>). Read-only tokens can only fetch
          data (leads, exports, campaigns).
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="block space-y-1">
          <span className="label">Name</span>
          <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="label">Access</span>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as "read" | "full")}>
            <option value="read">Read only (recommended)</option>
            <option value="full">Full (can change data)</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="label">Expires after (days)</span>
          <input className="input w-28" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.valueAsNumber)} />
        </label>
        <button className="btn btn-primary" disabled={create.isPending}>
          Create token
        </button>
      </form>
      <div className="space-y-3 px-5 pb-5">
        {create.error && <ErrorBox error={create.error} />}
        {revoke.error && <ErrorBox error={revoke.error} />}
        {token && <OnceSecret label="New API token" value={token} onDone={() => setToken(null)} />}
        {tokens.isPending && <Spinner />}
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {integrationTokens?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {t.name} <code className="text-xs text-slate-500">{t.prefix}…</code>{" "}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{t.scope === "read" ? "read only" : "full"}</span>
                <span className="block text-xs text-slate-500">
                  last used {formatRelative(t.lastUsedAt)} · {t.expiresAt ? `expires ${formatDate(t.expiresAt)}` : "no expiry"}
                </span>
              </span>
              <ConfirmButton label="Revoke" confirmLabel="Revoke access" className="btn btn-danger px-2 py-1 text-xs" onConfirm={() => revoke.mutate(t.id)} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function IntegrationsPage() {
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const events = useQuery({ queryKey: ["integration-events"], queryFn: () => api<{ events: EventInfo[] }>("/integrations/events").then((r) => r.events) });
  const hooks = useQuery({ queryKey: ["webhooks"], queryFn: () => api<{ items: WebhookEndpoint[] }>("/integrations/webhooks").then((r) => r.items), refetchInterval: 15_000 });

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Send events to n8n (or any webhook), and let n8n read data with an API token. Optional: nothing here is needed for the platform itself."
        actions={
          !adding && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              + Add webhook
            </button>
          )
        }
      />

      <section className="card mb-6 p-5 text-sm">
        <h2 className="mb-2 font-medium">Connect n8n in 4 steps</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
          <li>
            In n8n add a <strong>Webhook</strong> node: HTTP Method <code>POST</code>, Authentication <strong>Header Auth</strong>.
          </li>
          <li>Copy its Test URL (while testing) or Production URL (after you publish the workflow) and add it here as a webhook.</li>
          <li>
            In the Header Auth credential set Name <code>X-Lead-Platform-Token</code> and Value = the signing secret shown here once.
          </li>
          <li>
            Press <strong>Send test</strong>. Events arrive as JSON <code>{"{ id, type, createdAt, data }"}</code>; use <code>id</code> to ignore repeats. Full guide:{" "}
            <code>docs/n8n.md</code>.
          </li>
        </ol>
      </section>

      {secret && (
        <div className="mb-6">
          <OnceSecret label="Signing secret (use it as the Header Auth value in n8n)" value={secret} onDone={() => setSecret(null)} />
        </div>
      )}

      <section className="card">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-medium">Webhooks</h2>
          {adding && (
            <button className="btn px-2 py-1 text-xs" onClick={() => setAdding(false)}>
              Close
            </button>
          )}
        </div>
        {adding && events.data && (
          <NewWebhook
            events={events.data}
            onCreated={(s) => {
              setSecret(s);
              setAdding(false);
            }}
          />
        )}
        {(hooks.isPending || events.isPending) && <Spinner />}
        {hooks.error && <div className="p-4"><ErrorBox error={hooks.error} /></div>}
        {hooks.data?.length === 0 && !adding && <EmptyState title="No webhooks yet">Add one to send new leads, replies or opt-outs to n8n.</EmptyState>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {events.data && hooks.data?.map((e) => <WebhookRow key={e.id} endpoint={e} events={events.data} />)}
        </ul>
      </section>

      <IntegrationTokens />
    </>
  );
}
