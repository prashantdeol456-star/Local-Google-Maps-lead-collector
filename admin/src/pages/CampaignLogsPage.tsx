import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, ErrorBox, PageHeader, Pagination, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber, formatRelative } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { AttemptStatus, CampaignEvent, CampaignLogEntry, CampaignSummary, LogChannel, Page } from "../lib/types";
import { Badge } from "./EmailPage";

// Every campaign and every message, across email, WhatsApp and LinkedIn.

const PAGE_SIZE = 50;

const CHANNEL_LABEL: Record<LogChannel, string> = { email: "✉ Email", whatsapp: "✆ WhatsApp", linkedin: "in LinkedIn" };

const CAMPAIGN_PATH: Record<LogChannel, string> = { email: "/email", whatsapp: "/whatsapp", linkedin: "/linkedin-outreach" };

const STATUSES: (AttemptStatus | "")[] = ["", "queued", "sending", "sent", "delivered", "skipped", "failed", "cancelled"];

const EVENT_TONE: Record<CampaignEvent["status"], string> = {
  info: "bg-slate-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

/** "linkedin_campaign_started" → { channel: "LinkedIn", action: "started" } */
function describeEvent(action: string) {
  const [channel, , ...rest] = action.split("_");
  const label = channel === "linkedin" ? "LinkedIn" : channel === "whatsapp" ? "WhatsApp" : channel === "email" ? "Email" : channel;
  return { channel: label, action: rest.join(" ") };
}

function ChannelPill({ channel }: { channel: LogChannel }) {
  return <span className="whitespace-nowrap rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{CHANNEL_LABEL[channel]}</span>;
}

export function CampaignLogsPage() {
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const channel = (params.get("channel") ?? "") as LogChannel | "";
  const status = (params.get("status") ?? "") as AttemptStatus | "";
  const campaignId = params.get("campaign") ?? "";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);

  const campaigns = useQuery({
    queryKey: ["campaigns", "logs", channel],
    queryFn: () => api<{ items: CampaignSummary[] }>(`/campaign-logs/campaigns${qs({ channel })}`).then((r) => r.items),
    refetchInterval: 30_000,
  });
  const messages = useQuery({
    queryKey: ["campaigns", "log-messages", page, channel, status, campaignId, q],
    queryFn: () => api<Page<CampaignLogEntry>>(`/campaign-logs/messages${qs({ page, pageSize: PAGE_SIZE, channel, status, campaignId, q })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const events = useQuery({
    queryKey: ["campaigns", "events"],
    queryFn: () => api<{ items: CampaignEvent[] }>("/campaign-logs/events").then((r) => r.items),
    refetchInterval: 30_000,
  });

  const selectedCampaign = campaigns.data?.find((c) => c.id === campaignId);

  return (
    <>
      <PageHeader title="Campaign Logs" subtitle="Every campaign and message across email, WhatsApp and LinkedIn." />

      <div className="mb-4 flex flex-wrap gap-1">
        {(["", "email", "whatsapp", "linkedin"] as const).map((ch) => (
          <button
            key={ch || "all"}
            className={`btn px-3 py-1 text-sm ${channel === ch ? "btn-primary" : ""}`}
            onClick={() => setSearchParams({ channel: ch, campaign: null, page: null })}
          >
            {ch ? CHANNEL_LABEL[ch] : "All channels"}
          </button>
        ))}
      </div>

      <section className="card mb-6">
        <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Campaigns</h2>
        {campaigns.isPending && <Spinner />}
        {campaigns.error && <div className="p-4"><ErrorBox error={campaigns.error} /></div>}
        {campaigns.data?.length === 0 && <EmptyState title="No campaigns yet" />}
        {campaigns.data && campaigns.data.length > 0 && (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                <tr>
                  <th className="px-4 py-2">Campaign</th>
                  <th className="px-4 py-2">Channel</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Messages</th>
                  <th className="px-4 py-2 text-right">Sent</th>
                  <th className="px-4 py-2 text-right">Queued</th>
                  <th className="px-4 py-2 text-right">Failed / skipped</th>
                  <th className="px-4 py-2">Last send</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {campaigns.data.map((c) => (
                  <tr key={`${c.channel}:${c.id}`} className={c.id === campaignId ? "bg-brand-50/60 dark:bg-brand-700/10" : ""}>
                    <td className="px-4 py-2">
                      <Link to={`${CAMPAIGN_PATH[c.channel]}/${c.id}`} className="font-medium text-brand-600 hover:underline">
                        {c.name}
                      </Link>
                      {c.statusReason && c.status === "paused" && <p className="text-xs text-amber-600">{c.statusReason}</p>}
                    </td>
                    <td className="px-4 py-2">
                      <ChannelPill channel={c.channel} />
                      {c.mode && <span className="ml-1 text-xs text-slate-500">{c.mode}</span>}
                    </td>
                    <td className="px-4 py-2">
                      <Badge status={c.status} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(c.total)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber((c.counts.sent ?? 0) + (c.counts.delivered ?? 0))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber((c.counts.queued ?? 0) + (c.counts.sending ?? 0))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatNumber(c.counts.failed ?? 0)} / {formatNumber(c.counts.skipped ?? 0)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-500">{formatRelative(c.lastSentAt)}</td>
                    <td className="px-4 py-2">
                      <button className="btn px-2 py-1 text-xs" onClick={() => setSearchParams({ campaign: c.id === campaignId ? null : c.id, page: null })}>
                        {c.id === campaignId ? "Show all" : "Messages"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
            <h2 className="mr-auto font-medium">
              Message log{selectedCampaign && <span className="font-normal text-slate-500"> · {selectedCampaign.name}</span>}
            </h2>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearchParams({ q: search, page: null });
              }}
            >
              <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Recipient or address" aria-label="Search recipient" />
              <button className="btn">Search</button>
            </form>
            <select className="input w-auto" value={status} onChange={(e) => setSearchParams({ status: e.target.value, page: null })} aria-label="Status">
              {STATUSES.map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "Any status"}
                </option>
              ))}
            </select>
          </div>
          {messages.isPending && <Spinner />}
          {messages.error && <div className="p-4"><ErrorBox error={messages.error} /></div>}
          {messages.data?.total === 0 && <EmptyState title="No messages match" />}
          {messages.data && messages.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2">When</th>
                    <th className="px-4 py-2">Channel</th>
                    <th className="px-4 py-2">Recipient</th>
                    <th className="px-4 py-2">Campaign</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {messages.data.items.map((m) => (
                    <tr key={`${m.channel}:${m.id}`} className="align-top">
                      <td className="px-4 py-2 whitespace-nowrap text-slate-500" title={formatDate(m.updatedAt)}>
                        {formatRelative(m.sentAt ?? m.updatedAt)}
                      </td>
                      <td className="px-4 py-2">
                        <ChannelPill channel={m.channel} />
                      </td>
                      <td className="px-4 py-2">
                        <p className="font-medium">{m.recipient}</p>
                        <p className="max-w-56 truncate text-xs text-slate-500">{m.to}</p>
                      </td>
                      <td className="px-4 py-2">{m.campaignName ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Badge status={m.status} />
                      </td>
                      <td className="max-w-xs px-4 py-2 text-xs text-slate-500">{m.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {messages.data && messages.data.total > PAGE_SIZE && (
            <Pagination page={page} pageSize={PAGE_SIZE} total={messages.data.total} onPage={(p) => setSearchParams({ page: p })} />
          )}
        </section>

        <section className="card">
          <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Activity</h2>
          {events.isPending && <Spinner />}
          {events.data?.length === 0 && <EmptyState title="No activity yet" />}
          <ul className="max-h-[36rem] divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
            {events.data?.map((e) => {
              const d = describeEvent(e.action);
              return (
                <li key={e.id} className="flex gap-3 px-5 py-3 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${EVENT_TONE[e.status]}`} aria-hidden />
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">{d.channel}</span> campaign {d.action}
                    </p>
                    {e.message && <p className="break-words text-xs text-slate-500">{e.message}</p>}
                    <p className="text-xs text-slate-400">{formatRelative(e.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
