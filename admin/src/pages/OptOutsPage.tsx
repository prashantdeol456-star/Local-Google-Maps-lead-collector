import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ReasonAction, SOURCE_LABEL } from "../components/PreferencesCard";
import { EmptyState, ErrorBox, PageHeader, Pagination, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { SuppressionPage } from "../lib/types";

type Channel = "" | "email" | "whatsapp";

function AddForm({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [addresses, setAddresses] = useState("");
  const [reason, setReason] = useState("");
  const add = useMutation({
    mutationFn: () => api<{ added: number; alreadySuppressed: number; invalid: string[] }>("/opt-outs", { method: "POST", body: { channel, addresses, reason } }),
    onSuccess: () => {
      setAddresses("");
      client.invalidateQueries({ queryKey: ["opt-outs"] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }
  return (
    <form onSubmit={submit} className="card mb-6 space-y-4 p-5">
      <h2 className="font-medium">Add addresses that must not be contacted</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="label">Channel</span>
          <select className="input" value={channel} onChange={(e) => setChannel(e.target.value as "email" | "whatsapp")}>
            <option value="email">Email addresses</option>
            <option value="whatsapp">WhatsApp / phone numbers</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="label">Reason</span>
          <input className="input" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Do-not-contact list from the client" />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="label">One per line (or separated by commas)</span>
        <textarea
          className="input min-h-32 font-mono text-sm"
          required
          value={addresses}
          onChange={(e) => setAddresses(e.target.value)}
          placeholder={channel === "email" ? "info@example.in\nadmissions@example.edu" : "+91 98765 43210\n0522 400 0000"}
        />
      </label>
      {add.error && <ErrorBox error={add.error} />}
      {add.data && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
          {add.data.added} added, {add.data.alreadySuppressed} already on the list.
          {add.data.invalid.length > 0 && <span className="text-amber-600"> Not recognised: {add.data.invalid.slice(0, 10).join(", ")}{add.data.invalid.length > 10 ? "…" : ""}</span>}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add to opt-out list"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

export function OptOutsPage() {
  const client = useQueryClient();
  const params = useSearchParams();
  const channel = (["email", "whatsapp"].includes(params.get("channel") ?? "") ? params.get("channel") : "") as Channel;
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState(q);

  const list = useQuery({
    queryKey: ["opt-outs", channel, q, page],
    queryFn: () => api<SuppressionPage>(`/opt-outs${qs({ channel, q, page, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api(`/opt-outs/${encodeURIComponent(id)}`, { method: "DELETE", body: { note } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["opt-outs"] }),
  });

  const counts = list.data?.counts;
  const tab = (value: Channel, label: string, count?: number) => (
    <button
      key={value}
      className={`rounded-lg px-3 py-1.5 text-sm ${channel === value ? "bg-brand-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
      onClick={() => setSearchParams({ channel: value || null, page: null })}
    >
      {label}
      {count !== undefined && <span className="ml-1 tabular-nums opacity-75">{formatNumber(count)}</span>}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Opt-outs"
        subtitle="Email addresses and numbers that receive no marketing. Campaigns skip them automatically, even for leads collected again later."
        actions={
          !adding && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              + Add addresses
            </button>
          )
        }
      />
      {adding && <AddForm onDone={() => setAdding(false)} />}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex gap-1">
            {tab("", "All", counts ? counts.email + counts.whatsapp : undefined)}
            {tab("email", "Email", counts?.email)}
            {tab("whatsapp", "WhatsApp", counts?.whatsapp)}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearchParams({ q: search.trim() || null, page: null });
            }}
          >
            <input className="input w-64" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address or reason" aria-label="Search" />
          </form>
        </div>
        {list.isPending && <Spinner />}
        {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
        {remove.error && <div className="p-4"><ErrorBox error={remove.error} /></div>}
        {list.data?.items.length === 0 && <EmptyState title={q ? "No matches" : "No opt-outs yet"}>Unsubscribes, STOP replies and spam reports appear here automatically.</EmptyState>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {list.data?.items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p>
                  <span aria-hidden>{s.channel === "email" ? "✉ " : "✆ "}</span>
                  <code>{s.address}</code>
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{SOURCE_LABEL[s.source] ?? s.source}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {s.reason} · {formatDate(s.createdAt)}
                  {s.leadId &&
                    (s.leadName ? (
                      <>
                        {" · "}
                        <Link to={`/leads/${s.leadId}`} className="hover:text-brand-600">
                          {s.leadName}
                        </Link>
                      </>
                    ) : (
                      " · lead deleted"
                    ))}
                </p>
              </div>
              <ReasonAction
                label="Remove"
                prompt="Only if they asked to hear from you again: how?"
                placeholder="e.g. Wrote to us asking to be added back"
                pending={remove.isPending}
                onSubmit={(note) => remove.mutate({ id: s.id, note })}
              />
            </li>
          ))}
        </ul>
        {list.data && list.data.total > 50 && <Pagination page={page} pageSize={50} total={list.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />}
      </div>
    </>
  );
}
