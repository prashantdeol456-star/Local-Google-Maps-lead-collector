import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getQuickSend, preselectedLeadIds } from "../lib/quickSend";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatNumber } from "../lib/format";
import { Link, navigate, useSearchParams } from "../lib/router";
import type { Campaign, InboxMessage, Page, WhatsAppRecipientSummary, WhatsAppTemplate } from "../lib/types";
import { CampaignDetailPage, EmailCampaignsPage, LeadFilterFields } from "./EmailPage";
import { WhatsAppTemplatePreview } from "./WhatsAppTemplatesPage";

export function WhatsAppCampaignsPage() {
  return (
    <>
      <EmailCampaignsPage channel="whatsapp" />
      <WhatsAppInbox />
    </>
  );
}

/** Replies and messages from unknown numbers, newest first. Nothing is answered automatically. */
function WhatsAppInbox() {
  const [page, setPage] = useState(1);
  const inbox = useQuery({
    queryKey: ["wa-inbox", page],
    queryFn: () => api<Page<InboxMessage>>(`/whatsapp/inbox?page=${page}&pageSize=20`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  return (
    <section className="card mt-6">
      <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">Messages received</h2>
        <p className="text-xs text-slate-500">Replies arrive through the WhatsApp webhook. Answer them in WhatsApp; nothing is sent back automatically.</p>
      </div>
      {inbox.error && <div className="p-4"><ErrorBox error={inbox.error} /></div>}
      {inbox.data?.items.length === 0 && <EmptyState title="No messages yet" />}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {inbox.data?.items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">
                {m.leadId ? (
                  <Link to={`/leads/${m.leadId}`} className="font-medium text-slate-800 hover:text-brand-600 dark:text-slate-100">
                    {m.leadName}
                  </Link>
                ) : (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">Unknown number</span>
                )}{" "}
                · {m.phone}
                {m.metadata?.profileName ? ` · "${m.metadata.profileName}"` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{m.text ?? <span className="text-slate-500">({m.metadata?.messageType ?? "non-text"} message: open WhatsApp to see it)</span>}</p>
            </div>
            <time className="text-xs text-slate-500">{formatDate(m.occurredAt)}</time>
          </li>
        ))}
      </ul>
      {inbox.data && inbox.data.total > 20 && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-800">
          <button className="btn px-2 py-1 text-xs" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Newer
          </button>
          <button className="btn px-2 py-1 text-xs" disabled={page * 20 >= inbox.data.total} onClick={() => setPage(page + 1)}>
            Older
          </button>
        </div>
      )}
    </section>
  );
}

export function WhatsAppCampaignDetailPage({ id }: { id: string }) {
  return <CampaignDetailPage id={id} channel="whatsapp" />;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function NewWhatsAppCampaignPage() {
  const params = useSearchParams();
  const preselected = preselectedLeadIds(params);
  const client = useQueryClient();
  const templates = useQuery({ queryKey: ["wa-templates"], queryFn: () => api<{ items: WhatsAppTemplate[] }>("/whatsapp/templates").then((r) => r.items) });
  const approved = templates.data?.filter((t) => t.approvalStatus === "approved");

  const [name, setName] = useState(() => (params.get("quickSend") === "1" ? `Quick Send – ${getQuickSend()?.list ?? ""}` : ""));
  const [templateId, setTemplateId] = useState("");
  const [filters, setFilters] = useState({ city: "", category: "", searchKeyword: "", q: "" });
  const [intervalMin, setIntervalMin] = useState(2);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [windowStart, setWindowStart] = useState("10:00");
  const [windowEnd, setWindowEnd] = useState("18:00");

  useEffect(() => {
    if (!templateId && approved?.[0]) setTemplateId(approved[0].id);
  }, [approved, templateId]);

  const recipients = preselected.length ? { leadIds: preselected } : { filters };
  const summary = useQuery({
    queryKey: ["wa-recipients", recipients, templateId],
    queryFn: () =>
      api<WhatsAppRecipientSummary>("/whatsapp/campaigns/recipients", { method: "POST", body: { recipients, ...(templateId ? { templateId } : {}) } }),
    placeholderData: keepPreviousData,
  });
  const template = approved?.find((t) => t.id === templateId);

  const create = useMutation({
    mutationFn: () =>
      api<{ campaign: Campaign }>("/whatsapp/campaigns", {
        method: "POST",
        body: { name, templateId, recipients, intervalSec: Math.round(intervalMin * 60), dailyLimit, windowStart, windowEnd },
      }),
    onSuccess: ({ campaign }) => {
      client.invalidateQueries({ queryKey: ["campaigns"] });
      navigate(`/whatsapp/${campaign.id}`);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  if (templates.isPending) return <Spinner />;
  if (approved?.length === 0) {
    return (
      <>
        <PageHeader title="New WhatsApp campaign" />
        <EmptyState title="No approved template yet">
          WhatsApp campaigns can only use templates approved by Meta.{" "}
          <Link to="/whatsapp/templates" className="text-brand-600 hover:underline">
            Add a template
          </Link>
        </EmptyState>
      </>
    );
  }

  const s = summary.data;
  return (
    <>
      <Link to="/whatsapp" className="mb-3 inline-block text-sm text-slate-500 hover:text-brand-600">
        ← WhatsApp campaigns
      </Link>
      <PageHeader title="New WhatsApp campaign" subtitle="It is saved as a draft; nothing is sent until you press Start." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            <Field label="Campaign name">
              <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lucknow colleges follow-up" />
            </Field>
            <Field label="Approved template">
              <select className="input" required value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {approved?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.language}){t.category ? ` · ${t.category[0]!.toUpperCase()}${t.category.slice(1)}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="font-medium">Recipients</h2>
            {preselected.length ? (
              <p className="text-sm">{preselected.length} {params.get("quickSend") === "1" ? `contacts from Quick Send (${getQuickSend()?.list ?? ""})` : "leads selected on the Leads page"}.</p>
            ) : (
              <LeadFilterFields filters={filters} onChange={setFilters} />
            )}
            {summary.error && <ErrorBox error={summary.error} />}
            {s && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
                <p>
                  <strong className="text-lg tabular-nums">{formatNumber(s.eligible)}</strong> will receive the message (of {formatNumber(s.selected)} selected).
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Skipped: {s.skipped.noOptIn} without a recorded opt-in · {s.skipped.noPhone} without a mobile number · {s.skipped.optedOut} opted out ·{" "}
                  {s.skipped.duplicatePhone} repeated number · {s.skipped.missingValue} missing a template value
                </p>
                {s.selected > 0 && s.skipped.noOptIn > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    WhatsApp requires the person's consent. A number on Google Maps is not consent: record each opt-in (how they agreed) on the lead's
                    page first.
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="card grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="font-medium sm:col-span-2">Sending pace</h2>
            <Field label="Send interval (minutes)" hint="One message, then this pause">
              <input className="input" type="number" min={0.5} max={1440} step={0.5} value={intervalMin} onChange={(e) => setIntervalMin(e.target.valueAsNumber)} />
            </Field>
            <Field label="Daily limit" hint="Stay within your number's messaging limit in WhatsApp Manager">
              <input className="input" type="number" min={1} max={2000} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.valueAsNumber)} />
            </Field>
            <Field label="Window start" hint="Local time (Asia/Kolkata)">
              <input className="input" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
            </Field>
            <Field label="Window end">
              <input className="input" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </Field>
          </section>

          {create.error && <ErrorBox error={create.error} />}
          <button className="btn btn-primary" disabled={create.isPending || !s || s.eligible === 0 || !templateId}>
            {create.isPending ? "Creating…" : "Create draft campaign"}
          </button>
        </div>

        <section className="card h-fit p-5">
          <h2 className="mb-3 font-medium">Message preview</h2>
          {template ? <WhatsAppTemplatePreview body={template.body} paramFormat={template.paramFormat ?? "positional"} /> : <Spinner />}
        </section>
      </form>
    </>
  );
}
