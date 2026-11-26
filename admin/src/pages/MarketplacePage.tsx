import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner, StatCard } from "../components/ui";
import { api, qs, withViewOwner } from "../lib/api";
import { formatRelative } from "../lib/format";
import type { WhatsAppTemplate } from "../lib/types";

// Marketplace leads: the buyer enquiries from your own IndiaMART / TradeIndia / other portal
// seller account, read every 5 minutes with the API key the portal gives you. Each new enquiry
// goes to Contacts and, if you choose a template, gets a WhatsApp reply from your own number.

type Kind = "indiamart" | "tradeindia" | "custom";

interface Source {
  id: string;
  kind: Kind;
  name: string;
  configHint: string | null;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastPolledAt: string | null;
  lastLeadAt: string | null;
  waTemplateId: string | null;
  leads: number;
}

interface Lead {
  id: string;
  sourceId: string;
  kind: Kind;
  name: string;
  mobile: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  state: string | null;
  product: string | null;
  subject: string | null;
  message: string | null;
  receivedAt: string;
  contactId: string | null;
  followUp: "none" | "sent" | "failed" | "skipped";
  followUpNote: string | null;
}

const KIND_LABEL: Record<Kind, string> = {
  indiamart: "IndiaMART",
  tradeindia: "TradeIndia",
  custom: "Other portal",
};
const HELP: Record<Kind, string> = {
  indiamart: "IndiaMART seller login → Lead Manager → Import/Export Leads (or Settings) → Pull API → generate the CRM key and paste it here. IndiaMART allows one check every 5 minutes.",
  tradeindia: "TradeIndia seller login → My Dashboard → Inquiries & Contacts → My Inquiry API: copy the User ID, Profile ID and Key.",
  custom:
    "ExportersIndia or another portal: open the enquiry API in your member panel and paste the full https link (with your key in it). We read the usual fields (name, mobile, email, product, message).",
};
const FOLLOW: Record<Lead["followUp"], string> = {
  none: "—",
  sent: "WhatsApp sent",
  failed: "WhatsApp failed",
  skipped: "Not sent",
};

function useTemplates() {
  return useQuery({
    queryKey: ["whatsapp-templates", "approved"],
    queryFn: () => api<{ items: WhatsAppTemplate[] }>("/whatsapp/templates").then((r) => r.items.filter((t) => t.approvalStatus === "approved")),
  });
}

function TemplateSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const templates = useTemplates();
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">No automatic WhatsApp reply</option>
      {(templates.data ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          WhatsApp: {t.name} ({t.language})
        </option>
      ))}
    </select>
  );
}

function AddSource({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<Kind>("indiamart");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [userId, setUserId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [url, setUrl] = useState("");
  const [tpl, setTpl] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api<{ source: Source }>("/marketplace/sources", {
        method: "POST",
        body: {
          kind,
          name: name.trim() || null,
          config: kind === "custom" ? { url } : kind === "tradeindia" ? { key, userId, profileId } : { key },
          waTemplateId: tpl || null,
        },
      }),
    onSuccess: () => {
      setKey("");
      setUserId("");
      setProfileId("");
      setUrl("");
      setName("");
      onDone();
    },
  });
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <h2 className="font-semibold">Connect a portal</h2>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Portal">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`btn ${kind === k ? "btn-primary" : ""}`} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{HELP[kind]}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {kind === "custom" && <input className="input" placeholder="Portal name, e.g. ExportersIndia" value={name} onChange={(e) => setName(e.target.value)} aria-label="Portal name" />}
        {kind === "tradeindia" && (
          <>
            <input className="input" placeholder="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="TradeIndia User ID" autoComplete="off" />
            <input className="input" placeholder="Profile ID" value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label="TradeIndia Profile ID" autoComplete="off" />
          </>
        )}
        {kind === "custom" ? (
          <input
            className="input sm:col-span-2"
            type="password"
            placeholder="https://… enquiry API link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="API link"
            autoComplete="off"
          />
        ) : (
          <input
            className="input"
            type="password"
            placeholder={kind === "indiamart" ? "IndiaMART CRM key" : "TradeIndia Key"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="Key"
            autoComplete="off"
          />
        )}
        <TemplateSelect value={tpl} onChange={setTpl} label="Automatic WhatsApp reply" />
      </div>
      <p className="text-xs text-slate-500">
        The key is kept encrypted on the server. The WhatsApp reply goes from your own number (My sender) with an approved template, so a new buyer hears from you within minutes.
      </p>
      <button className="btn btn-primary" disabled={add.isPending}>
        {add.isPending ? "Saving…" : "Save and start checking"}
      </button>
      {add.error && <ErrorBox error={add.error} />}
    </form>
  );
}

function SourceCard({ s, onChange }: { s: Source; onChange: () => void }) {
  const patch = useMutation({
    mutationFn: (body: Partial<Pick<Source, "enabled" | "waTemplateId">>) => api(`/marketplace/sources/${s.id}`, { method: "PATCH", body }),
    onSuccess: onChange,
  });
  const pull = useMutation({
    mutationFn: () =>
      api<{ added: number }>(`/marketplace/sources/${s.id}/pull`, {
        method: "POST",
      }),
    onSettled: onChange,
  });
  const remove = useMutation({
    mutationFn: () => api(`/marketplace/sources/${s.id}`, { method: "DELETE" }),
    onSuccess: onChange,
  });
  return (
    <div className="card space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{s.name}</h3>
        <span className="text-xs text-slate-500">
          {s.name !== KIND_LABEL[s.kind] && `${KIND_LABEL[s.kind]} · `}key {s.configHint}
        </span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${!s.enabled ? "bg-slate-100 text-slate-600 dark:bg-slate-800" : s.status === "error" ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300"}`}
        >
          {!s.enabled ? "Paused" : s.status === "error" ? "Problem" : "Checking every 5 min"}
        </span>
      </div>
      {s.lastError && <p className="text-sm text-red-600">{s.lastError}</p>}
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {s.leads} {s.leads === 1 ? "enquiry" : "enquiries"} · last checked {s.lastPolledAt ? formatRelative(s.lastPolledAt) : "not yet"}
        {s.lastLeadAt && ` · last new enquiry ${formatRelative(s.lastLeadAt)}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <TemplateSelect value={s.waTemplateId ?? ""} onChange={(v) => patch.mutate({ waTemplateId: v || null })} label={`Automatic WhatsApp reply for ${s.name}`} />
        <button className="btn" disabled={pull.isPending || !s.enabled} onClick={() => pull.mutate()}>
          {pull.isPending ? "Checking…" : "⟳ Check now"}
        </button>
        <button className="btn" disabled={patch.isPending} onClick={() => patch.mutate({ enabled: !s.enabled })}>
          {s.enabled ? "Pause" : "Resume"}
        </button>
        <ConfirmButton label="Remove" confirmLabel="Remove portal?" onConfirm={() => remove.mutate()} disabled={remove.isPending} />
      </div>
      {pull.data && <p className="text-sm text-green-700 dark:text-green-400">{pull.data.added === 0 ? "No new enquiries." : `${pull.data.added} new enquiries added.`}</p>}
      {(pull.error || patch.error || remove.error) && <ErrorBox error={pull.error ?? patch.error ?? remove.error} />}
    </div>
  );
}

export function MarketplacePage() {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const sources = useQuery({
    queryKey: ["marketplace-sources"],
    queryFn: () => api<{ items: Source[] }>("/marketplace/sources"),
    refetchInterval: 60_000,
  });
  const leads = useQuery({
    queryKey: ["marketplace-leads", page, q, sourceId, followUp],
    queryFn: () =>
      api<{
        items: Lead[];
        total: number;
        today: number;
        page: number;
        pageSize: number;
      }>(`/marketplace/leads${qs({ page, pageSize: 25, q: q || null, sourceId: sourceId || null, followUp: followUp || null })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["marketplace-sources"] });
    void client.invalidateQueries({ queryKey: ["marketplace-leads"] });
  };
  const list = sources.data?.items ?? [];
  const names = Object.fromEntries(list.map((s) => [s.id, s.name]));
  const data = leads.data;
  const enquiries = (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mr-auto font-semibold">Enquiries</h2>
        <input
          className="input w-56"
          placeholder="Search name, company, product, mobile"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          aria-label="Search enquiries"
        />
        <select
          className="input w-auto"
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            setPage(1);
          }}
          aria-label="Portal"
        >
          <option value="">All portals</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={followUp}
          onChange={(e) => {
            setFollowUp(e.target.value);
            setPage(1);
          }}
          aria-label="WhatsApp reply"
        >
          <option value="">Any reply</option>
          <option value="sent">WhatsApp sent</option>
          <option value="failed">WhatsApp failed</option>
          <option value="none">No reply set</option>
        </select>
      </div>
      {leads.error && <ErrorBox error={leads.error} />}
      {data && data.items.length === 0 ? (
        <EmptyState title="No enquiries yet">Connect a portal above. New buyer enquiries appear here within 5 minutes of reaching your portal account.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2">Received</th>
                <th className="px-4 py-2">Buyer</th>
                <th className="px-4 py-2">Mobile / email</th>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2">Portal</th>
                <th className="px-4 py-2">Reply</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(data?.items ?? []).map((l) => (
                <tr key={l.id} className="cursor-pointer align-top hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">{formatRelative(l.receivedAt)}</td>
                  <td className="px-4 py-2">
                    <strong>{l.name}</strong>
                    {(l.company || l.city) && <span className="block text-xs text-slate-500">{[l.company, l.city, l.state].filter(Boolean).join(" · ")}</span>}
                    {open === l.id && (l.subject || l.message) && (
                      <span className="mt-1 block max-w-md whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{[l.subject, l.message].filter(Boolean).join("\n")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {l.mobile && (
                      <a className="block text-brand-600" href={`tel:${l.mobile}`} onClick={(e) => e.stopPropagation()}>
                        {l.mobile}
                      </a>
                    )}
                    {l.email && <span className="block text-xs">{l.email}</span>}
                  </td>
                  <td className="max-w-xs px-4 py-2">{l.product ?? l.subject ?? "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{names[l.sourceId] ?? KIND_LABEL[l.kind]}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {FOLLOW[l.followUp]}
                    {l.followUpNote && (
                      <span className="block max-w-[14rem] truncate text-xs text-slate-500" title={l.followUpNote}>
                        {l.followUpNote}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
  return (
    <>
      <PageHeader
        title="Marketplace leads"
        subtitle="Buyer enquiries from your own IndiaMART, TradeIndia or other portal seller account, every 5 minutes: saved to Contacts, with an optional WhatsApp reply from your number."
        actions={
          <a className="btn" href={withViewOwner(`/api/marketplace/leads/export.csv${qs({ sourceId: sourceId || null })}`)} download>
            ⬇ Export CSV
          </a>
        }
      />
      {sources.isPending && <Spinner />}
      {sources.error && <ErrorBox error={sources.error} />}
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Enquiries in the last 24 h" value={data?.today} icon="✦" tone="green" />
          <StatCard label="All enquiries" value={data?.total} icon="☰" />
          <StatCard label="Portals connected" value={list.length} icon="⇄" tone="slate" />
        </div>
        {list.length === 0 ? (
          <>
            {list.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                {list.map((s) => (
                  <SourceCard key={s.id} s={s} onChange={refresh} />
                ))}
              </div>
            )}
            {sources.data && (list.length === 0 || adding) && (
              <AddSource
                onDone={() => {
                  setAdding(false);
                  refresh();
                }}
              />
            )}
            {list.length > 0 && !adding && (
              <button className="btn" onClick={() => setAdding(true)}>
                + Connect another portal
              </button>
            )}
            {enquiries}
          </>
        ) : (
          <>
            {enquiries}
            {list.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                {list.map((s) => (
                  <SourceCard key={s.id} s={s} onChange={refresh} />
                ))}
              </div>
            )}
            {sources.data && (list.length === 0 || adding) && (
              <AddSource
                onDone={() => {
                  setAdding(false);
                  refresh();
                }}
              />
            )}
            {list.length > 0 && !adding && (
              <button className="btn" onClick={() => setAdding(true)}>
                + Connect another portal
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
