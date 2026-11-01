import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getQuickSend, preselectedLeadIds } from "../lib/quickSend";
import { useEffect, useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber } from "../lib/format";
import { SENDER_REQUIRED_NOTE, useIsSuperAdmin } from "../lib/me";
import { useSender } from "./SenderPage";
import { Link, navigate, setSearchParams, useSearchParams } from "../lib/router";
import type { Attempt, AttemptStatus, Campaign, CampaignDetail, CampaignStatus, EmailTemplate, Facets, Page, RecipientSummary } from "../lib/types";
import { TemplatePreview } from "./TemplatesPage";

const STATUS_STYLE: Record<CampaignStatus | AttemptStatus, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  running: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  completed: "bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100",
  stopped: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  queued: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  sending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  sent: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  delivered: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  failed: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  skipped: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export function Badge({ status }: { status: CampaignStatus | AttemptStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}>{status}</span>;
}

const WAITING_TEXT: Record<NonNullable<CampaignDetail["waitingFor"]>, string> = {
  not_started: "waiting for the scheduled start time",
  outside_window: "outside the sending window",
  daily_limit: "daily limit reached",
  interval: "waiting for the send interval",
};

export type CampaignChannel = "email" | "whatsapp";

/** What differs between the email and WhatsApp campaign pages. */
const CHANNEL = {
  email: {
    base: "/email",
    api: "/email/campaigns",
    title: "Email campaigns",
    templates: "/templates",
    one: "email",
    provider: () =>
      api<{ provider: string; sendsRealEmail: boolean }>("/email/provider").then((p) => ({ provider: p.provider, real: p.sendsRealEmail })),
  },
  whatsapp: {
    base: "/whatsapp",
    api: "/whatsapp/campaigns",
    title: "WhatsApp campaigns",
    templates: "/whatsapp/templates",
    one: "message",
    provider: () =>
      api<{ provider: string; sendsRealMessages: boolean }>("/whatsapp/provider").then((p) => ({
        provider: p.provider === "meta" ? "Meta WhatsApp Cloud API" : p.provider,
        real: p.sendsRealMessages,
      })),
  },
} as const;

// ---------- List ----------

export function EmailCampaignsPage({ channel = "email" }: { channel?: CampaignChannel }) {
  const ch = CHANNEL[channel];
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const campaigns = useQuery({
    queryKey: ["campaigns", channel, page],
    queryFn: () => api<Page<Campaign>>(`${ch.api}${qs({ page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const superAdmin = useIsSuperAdmin();
  // The platform's sender is the super admin's: customers do not see it (they cannot send yet).
  const provider = useQuery({ queryKey: [`${channel}-provider-summary`], queryFn: ch.provider, enabled: superAdmin });
  const ownSender = useSender(!superAdmin);

  return (
    <>
      <PageHeader
        title={ch.title}
        subtitle={
          !superAdmin
            ? ownSender.data && (channel === "email" ? ownSender.data.email : ownSender.data.whatsapp)
              ? `Sending through your own sender (${channel === "email" ? ownSender.data.email!.from : `WhatsApp ${ownSender.data.whatsapp!.phoneNumberId ?? ""}`})`
              : SENDER_REQUIRED_NOTE
            : provider.data
              ? provider.data.real
                ? `Sending through ${provider.data.provider}`
                : `Development mode: ${ch.one}s are recorded, not delivered`
              : " "
        }
        actions={
          <>
            <Link to={ch.templates} className="btn">
              Templates
            </Link>
            <Link to={`${ch.base}/new`} className="btn btn-primary">
              + New campaign
            </Link>
          </>
        }
      />
      <div className="card">
        {campaigns.isPending && <Spinner />}
        {campaigns.error && <div className="p-4"><ErrorBox error={campaigns.error} /></div>}
        {campaigns.data?.items.length === 0 && (
          <EmptyState title="No campaigns yet">
            {channel === "whatsapp"
              ? "Add an approved template, record opt-ins on the lead pages, then create a campaign."
              : "Create a template, then a campaign for selected leads."}
          </EmptyState>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {campaigns.data?.items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <Link to={`${ch.base}/${c.id}`} className="font-medium hover:text-brand-600">
                  {c.name}
                </Link>
                <p className="text-xs text-slate-500">
                  every {Math.round(c.intervalSec / 60)} min · max {c.dailyLimit}/day · {c.windowStart}–{c.windowEnd} · created {formatDate(c.createdAt)}
                </p>
              </div>
              <Badge status={c.status} />
            </li>
          ))}
        </ul>
        {campaigns.data && campaigns.data.total > 25 && (
          <Pagination page={page} pageSize={25} total={campaigns.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />
        )}
      </div>
    </>
  );
}

// ---------- New ----------

export function NewCampaignPage() {
  const params = useSearchParams();
  const preselected = preselectedLeadIds(params);
  const client = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<{ items: EmailTemplate[] }>("/templates").then((r) => r.items) });

  const [name, setName] = useState(() => (params.get("quickSend") === "1" ? `Quick Send – ${getQuickSend()?.list ?? ""}` : ""));
  const [templateId, setTemplateId] = useState("");
  const [filters, setFilters] = useState({ city: "", category: "", searchKeyword: "", q: "" });
  const [intervalMin, setIntervalMin] = useState(3);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [windowStart, setWindowStart] = useState("10:00");
  const [windowEnd, setWindowEnd] = useState("18:00");

  useEffect(() => {
    if (!templateId && templates.data?.[0]) setTemplateId(templates.data[0].id);
  }, [templates.data, templateId]);

  const recipients = preselected.length ? { leadIds: preselected } : { filters };
  const summary = useQuery({
    queryKey: ["recipients", recipients],
    queryFn: () => api<RecipientSummary>("/email/campaigns/recipients", { method: "POST", body: { recipients } }),
    placeholderData: keepPreviousData,
  });
  const template = templates.data?.find((t) => t.id === templateId);

  const create = useMutation({
    mutationFn: () =>
      api<{ campaign: Campaign }>("/email/campaigns", {
        method: "POST",
        body: { name, templateId, recipients, intervalSec: Math.round(intervalMin * 60), dailyLimit, windowStart, windowEnd },
      }),
    onSuccess: ({ campaign }) => {
      client.invalidateQueries({ queryKey: ["campaigns"] });
      navigate(`/email/${campaign.id}`);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  if (templates.data?.length === 0) {
    return (
      <>
        <PageHeader title="New email campaign" />
        <EmptyState title="Create a template first">
          <Link to="/templates" className="text-brand-600 hover:underline">
            Go to templates
          </Link>
        </EmptyState>
      </>
    );
  }

  const field = (label: string, child: React.ReactNode, hint?: string) => (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      {child}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
  const s = summary.data;

  return (
    <>
      <Link to="/email" className="mb-3 inline-block text-sm text-slate-500 hover:text-brand-600">
        ← Email campaigns
      </Link>
      <PageHeader title="New email campaign" subtitle="It is saved as a draft; nothing is sent until you press Start." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            {field("Campaign name", <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="University web development outreach" />)}
            {field(
              "Template",
              <select className="input" required value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>,
            )}
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
                  <strong className="text-lg tabular-nums">{formatNumber(s.eligible)}</strong> will receive the email (of {formatNumber(s.selected)} selected).
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Skipped: {s.skipped.noEmail} without email · {s.skipped.optedOut} unsubscribed · {s.skipped.duplicateEmail} repeated address
                </p>
                {s.selected > 0 && s.skipped.noEmail === s.selected && (
                  <p className="mt-1 text-xs text-amber-600">Google Maps rarely shows email addresses. Add emails on the lead pages first.</p>
                )}
              </div>
            )}
          </section>

          <section className="card grid gap-4 p-5 sm:grid-cols-2">
            <h2 className="font-medium sm:col-span-2">Sending pace</h2>
            {field("Send interval (minutes)", <input className="input" type="number" min={0.5} max={1440} step={0.5} value={intervalMin} onChange={(e) => setIntervalMin(e.target.valueAsNumber)} />, "One email, then this pause")}
            {field("Daily limit", <input className="input" type="number" min={1} max={2000} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.valueAsNumber)} />, "Respect your provider's limits")}
            {field("Window start", <input className="input" type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />, "Local time (Asia/Kolkata)")}
            {field("Window end", <input className="input" type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />)}
          </section>

          {create.error && <ErrorBox error={create.error} />}
          <button className="btn btn-primary" disabled={create.isPending || !s || s.eligible === 0}>
            {create.isPending ? "Creating…" : "Create draft campaign"}
          </button>
        </div>

        <section className="card h-fit p-5">
          <h2 className="mb-3 font-medium">Email preview</h2>
          {template ? <TemplatePreview subject={template.subject ?? ""} body={template.body} /> : <Spinner />}
        </section>
      </form>
    </>
  );
}

// ---------- Detail ----------

const ATTEMPT_FILTERS: (AttemptStatus | "")[] = ["", "queued", "sent", "failed", "skipped", "cancelled"];

export function CampaignDetailPage({ id, channel = "email" }: { id: string; channel?: CampaignChannel }) {
  const ch = CHANNEL[channel];
  const superAdmin = useIsSuperAdmin();
  const ownSender = useSender(!superAdmin);
  const canSend = superAdmin || !!(channel === "email" ? ownSender.data?.email : ownSender.data?.whatsapp);
  const client = useQueryClient();
  const params = useSearchParams();
  const status = (ATTEMPT_FILTERS as string[]).includes(params.get("status") ?? "") ? params.get("status")! : "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const detail = useQuery({ queryKey: ["campaign", id], queryFn: () => api<CampaignDetail>(`${ch.api}/${id}`), refetchInterval: 15_000 });
  const attempts = useQuery({
    queryKey: ["campaign", id, "attempts", status, page],
    queryFn: () => api<Page<Attempt>>(`${ch.api}/${id}/attempts${qs({ status, page, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
  const action = useMutation({
    mutationFn: (verb: "start" | "pause" | "stop") => api(`${ch.api}/${id}/${verb}`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["campaign", id] }),
  });

  if (detail.isPending) return <Spinner />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const { campaign: c, counts, template, nextSendAt, waitingFor, sentToday } = detail.data;
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const done = (counts.sent ?? 0) + (counts.delivered ?? 0);

  return (
    <>
      <Link to={ch.base} className="mb-3 inline-block text-sm text-slate-500 hover:text-brand-600">
        ← {ch.title}
      </Link>
      <PageHeader
        title={c.name}
        subtitle={<Badge status={c.status} />}
        actions={
          <>
            {(c.status === "draft" || c.status === "paused") && (
              <button
                className="btn btn-primary"
                disabled={action.isPending || !canSend}
                title={canSend ? undefined : SENDER_REQUIRED_NOTE}
                onClick={() => action.mutate("start")}
              >
                {c.status === "draft" ? "Start sending" : "Resume"}
              </button>
            )}
            {c.status === "running" && (
              <button className="btn" disabled={action.isPending} onClick={() => action.mutate("pause")}>
                Pause
              </button>
            )}
            {(c.status === "draft" || c.status === "running" || c.status === "paused") && (
              <ConfirmButton label="Stop" confirmLabel="Stop & cancel queued" onConfirm={() => action.mutate("stop")} disabled={action.isPending} />
            )}
          </>
        }
      />
      {action.error && <div className="mb-4"><ErrorBox error={action.error} /></div>}
      {c.status === "paused" && c.statusReason && c.statusReason !== "paused_by_admin" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300" role="alert">
          Paused automatically: {c.statusReason}. Fix this, then press Resume.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            ["Sent", done, "text-emerald-600"],
            ["Queued", counts.queued ?? 0, ""],
            ["Failed", counts.failed ?? 0, "text-red-600"],
            ["Skipped", (counts.skipped ?? 0) + (counts.cancelled ?? 0), "text-slate-500"],
            ["Sent today", sentToday, ""],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="card p-4">
            <p className="label">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{formatNumber(value)}</p>
          </div>
        ))}
      </div>

      {total > 0 && (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      )}

      <TrackingStats channel={channel} tracking={detail.data.tracking} sent={done + (counts.failed ?? 0)} provider={c.provider} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card p-5 text-sm">
          <h2 className="mb-3 font-medium">Settings</h2>
          <dl className="space-y-2">
            {[
              ["Template", template?.name ?? "—"],
              ["Provider", c.provider === "log" ? "Development (not delivered)" : c.provider],
              ["Pace", `1 ${ch.one} every ${c.intervalSec >= 60 ? `${+(c.intervalSec / 60).toFixed(1)} min` : `${c.intervalSec} s`}`],
              ["Daily limit", String(c.dailyLimit)],
              ["Window", `${c.windowStart}–${c.windowEnd} (${c.timeZone})`],
              ["Started", formatDate(c.startedAt)],
              ["Finished", formatDate(c.completedAt)],
              [`Next ${ch.one}`, c.status === "running" ? (nextSendAt ? `${formatDate(nextSendAt)}${waitingFor ? ` (${WAITING_TEXT[waitingFor]})` : ""}` : "—") : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
            <h2 className="font-medium">Recipients</h2>
            <select className="input w-auto" aria-label="Filter by status" value={status} onChange={(e) => setSearchParams({ status: e.target.value, page: null })}>
              {ATTEMPT_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {f ? f : "All"}
                </option>
              ))}
            </select>
          </div>
          {attempts.data?.items.length === 0 && <EmptyState title="Nothing here" />}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {attempts.data?.items.map((a) => (
                  <tr key={a.id}>
                    <td className="td">
                      <Link to={`/leads/${a.leadId}`} className="hover:text-brand-600">
                        {a.toAddress}
                      </Link>
                      {a.error && <p className="text-xs text-red-600">{a.error}</p>}
                    </td>
                    <td className="td whitespace-nowrap">
                      <Badge status={a.status} />
                      <TrackingMarks attempt={a} />
                    </td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">{a.sentAt ? formatDate(a.sentAt) : a.nextTryAt ? `retry ${formatDate(a.nextTryAt)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {attempts.data && attempts.data.total > 50 && (
            <Pagination page={page} pageSize={50} total={attempts.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />
          )}
        </section>
      </div>
    </>
  );
}

// ---------- Tracking ----------

const TRACKING_TILES: { key: keyof CampaignDetail["tracking"]; label: string; note?: string; color: string }[] = [
  { key: "deliveredAt", label: "Delivered", color: "text-emerald-600" },
  { key: "openedAt", label: "Opened", note: "approximate", color: "" },
  { key: "clickedAt", label: "Clicked", color: "text-brand-600" },
  { key: "repliedAt", label: "Replied", color: "text-emerald-600" },
  { key: "bouncedAt", label: "Bounced", color: "text-red-600" },
  { key: "complainedAt", label: "Spam reports", color: "text-red-600" },
];

const WHATSAPP_TILES: typeof TRACKING_TILES = [
  { key: "deliveredAt", label: "Delivered", color: "text-emerald-600" },
  { key: "readAt", label: "Read", note: "if receipts on", color: "text-brand-600" },
  { key: "repliedAt", label: "Replied", color: "text-emerald-600" },
];

function TrackingStats({ channel, tracking, sent, provider }: { channel: CampaignChannel; tracking: CampaignDetail["tracking"]; sent: number; provider: string }) {
  const pct = (n: number) => (sent > 0 ? `${Math.round((n / sent) * 100)}%` : "—");
  const tiles = channel === "whatsapp" ? WHATSAPP_TILES : TRACKING_TILES;
  return (
    <section className="card mt-4 p-4">
      <div className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${channel === "whatsapp" ? "" : "lg:grid-cols-6"}`}>
        {tiles.map((t) => (
          <div key={t.key}>
            <p className="label">
              {t.label}
              {t.note && <span className="ml-1 normal-case text-slate-400">({t.note})</span>}
            </p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${t.color}`}>
              {formatNumber(tracking[t.key])} <span className="text-xs font-normal text-slate-500">{pct(tracking[t.key])}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {channel === "whatsapp"
          ? provider === "meta"
            ? "From WhatsApp webhooks. Read only appears when the recipient has read receipts on. Replies are listed on each lead and under Messages received."
            : "Development provider: nothing is delivered, so no delivery, read or reply updates arrive."
          : provider === "resend"
          ? "Delivery, opens and bounces come from Resend webhooks; clicks from tracked links. Opens are approximate (mail apps block or pre-load images); clicks can include link scanners."
          : provider === "smtp"
            ? "SMTP reports no delivery or opens. Clicks come from tracked links; replies are logged on each lead's page."
            : "Development provider: only clicks on tracked links and logged replies can appear here."}
      </p>
    </section>
  );
}

function TrackingMarks({ attempt }: { attempt: Attempt }) {
  const marks: [string | null, string, string][] = [
    [attempt.openedAt, "Opened (approx.)", "👁"],
    [attempt.clickedAt, "Clicked", "🔗"],
    [attempt.readAt, "Read", "✓✓"],
    [attempt.repliedAt, "Replied", "↩"],
    [attempt.bouncedAt, "Bounced", "⚠"],
  ];
  return (
    <span className="ml-2 inline-flex gap-1 align-middle">
      {marks.filter(([at]) => at).map(([at, label, icon]) => (
        <span key={label} title={`${label} ${formatDate(at)}`} aria-label={label}>
          {icon}
        </span>
      ))}
    </span>
  );
}

// ---------- Recipient filters (shared with WhatsApp campaigns) ----------

export interface LeadFilters {
  city: string;
  category: string;
  searchKeyword: string;
  q: string;
}

export function LeadFilterFields({ filters, onChange }: { filters: LeadFilters; onChange: (f: LeadFilters) => void }) {
  const facets = useQuery({ queryKey: ["facets"], queryFn: () => api<Facets>("/leads/facets") });
  const select = (key: "city" | "category" | "searchKeyword", label: string, all: string, options?: Facets["cities"]) => (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <select className="input" value={filters[key]} onChange={(e) => onChange({ ...filters, [key]: e.target.value })}>
        <option value="">{all}</option>
        {options?.map((f) => (
          <option key={f.value} value={f.value}>
            {f.value} ({f.count})
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {select("city", "City", "All cities", facets.data?.cities)}
      {select("category", "Category", "All categories", facets.data?.categories)}
      {select("searchKeyword", "Search keyword", "All keywords", facets.data?.keywords)}
      <label className="block space-y-1">
        <span className="label">Text search</span>
        <input className="input" value={filters.q} onChange={(e) => onChange({ ...filters, q: e.target.value })} placeholder="name, website…" />
      </label>
    </div>
  );
}
