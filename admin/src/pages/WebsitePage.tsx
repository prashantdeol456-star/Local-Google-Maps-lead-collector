import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate } from "../lib/format";
import { setSearchParams, useSearchParams } from "../lib/router";

// Super admin: the public website's brand and contact details, and contact-form messages.

interface SiteSettings {
  brandName: string;
  tagline: string;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string;
  address: string;
}

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string;
  status: "new" | "read";
  createdAt: string;
}

function SettingsCard() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["site-settings"], queryFn: () => api<{ settings: SiteSettings }>("/site/settings") });
  const [f, setF] = useState<SiteSettings | null>(null);
  useEffect(() => {
    if (query.data && !f) setF(query.data.settings);
  }, [query.data, f]);
  const save = useMutation({
    mutationFn: (body: SiteSettings) => api<{ settings: SiteSettings }>("/site/settings", { method: "PUT", body }),
    onSuccess: (d) => client.setQueryData(["site-settings"], d),
  });
  if (query.error) return <ErrorBox error={query.error} />;
  if (!f) return <Spinner />;
  const set = (k: keyof SiteSettings) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const field = (k: keyof SiteSettings, label: string, attrs: Record<string, string | number | boolean> = {}) => (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <input className="input" value={f[k]} onChange={set(k)} {...attrs} />
    </label>
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(f!);
  }
  return (
    <form onSubmit={submit} className="card mb-6 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Website details</h2>
        <a className="text-sm text-brand-600 hover:underline" href="/" target="_blank" rel="noopener">
          Open the website ↗
        </a>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("brandName", "Brand name", { required: true, maxLength: 80 })}
        {field("contactEmail", "Contact email", { type: "email", maxLength: 254 })}
        {field("contactPhone", "Contact phone", { maxLength: 30 })}
        {field("whatsapp", "WhatsApp number", { maxLength: 30, placeholder: "+91 98765 43210" })}
      </div>
      {field("tagline", "Tagline (shown on the home page and in the footer)", { maxLength: 300 })}
      {field("address", "Address", { maxLength: 300 })}
      {save.error && <ErrorBox error={save.error} />}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {save.isSuccess && <span className="text-sm text-emerald-600">Saved. The website shows it now.</span>}
      </div>
    </form>
  );
}

function Messages() {
  const client = useQueryClient();
  const params = useSearchParams();
  const status = params.get("status") === "new" ? "new" : "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const list = useQuery({
    queryKey: ["site-messages", status, page],
    queryFn: () => api<{ items: ContactMessage[]; total: number; unread: number }>(`/site/messages${qs({ status, page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const act = useMutation({
    mutationFn: ({ id, what }: { id: string; what: "read" | "new" | "delete" }) =>
      what === "delete" ? api(`/site/messages/${encodeURIComponent(id)}`, { method: "DELETE" }) : api(`/site/messages/${encodeURIComponent(id)}/${what}`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["site-messages"] }),
  });
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">
          Contact messages
          {!!list.data?.unread && <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">{list.data.unread} new</span>}
        </h2>
        <div className="flex gap-1">
          {(["", "new"] as const).map((v) => (
            <button
              key={v}
              className={`rounded-lg px-3 py-1.5 text-sm ${status === v ? "bg-brand-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
              onClick={() => setSearchParams({ status: v || null, page: null })}
            >
              {v ? "New" : "All"}
            </button>
          ))}
        </div>
      </div>
      {list.isPending && <Spinner />}
      {list.error && (
        <div className="p-4">
          <ErrorBox error={list.error} />
        </div>
      )}
      {list.data?.items.length === 0 && <EmptyState title="No messages">Messages from the website's contact form appear here.</EmptyState>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {list.data?.items.map((m) => (
          <li key={m.id} className={`px-5 py-4 text-sm ${m.status === "new" ? "bg-brand-50/40 dark:bg-brand-700/10" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {m.name}
                  {m.company && <span className="font-normal text-slate-500"> · {m.company}</span>}
                </p>
                <p className="text-slate-500">
                  <a className="hover:text-brand-600" href={`mailto:${m.email}`}>
                    {m.email}
                  </a>
                  {m.phone && ` · ${m.phone}`} · {formatDate(m.createdAt)}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{m.message}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn" disabled={act.isPending} onClick={() => act.mutate({ id: m.id, what: m.status === "new" ? "read" : "new" })}>
                  {m.status === "new" ? "Mark read" : "Mark new"}
                </button>
                <ConfirmButton label="Delete" confirmLabel="Delete?" onConfirm={() => act.mutate({ id: m.id, what: "delete" })} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {list.data && list.data.total > 25 && <Pagination page={page} pageSize={25} total={list.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />}
    </div>
  );
}

export function WebsitePage() {
  return (
    <>
      <PageHeader title="Website" subtitle="The public pages before login (home, features, pricing, contact) and messages sent from the contact form." />
      <SettingsCard />
      <Messages />
    </>
  );
}
