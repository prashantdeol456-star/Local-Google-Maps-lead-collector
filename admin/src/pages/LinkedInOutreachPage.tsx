import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber, safeHref } from "../lib/format";
import { Link, navigate, setSearchParams, useSearchParams } from "../lib/router";
import type {
  AttemptStatus,
  ChannelTemplate,
  ContactFacets,
  LinkedInCampaign,
  LinkedInCampaignDetail,
  LinkedInMessage,
  LinkedInRecipientSummary,
  LinkedInSendMode,
  Page,
} from "../lib/types";
import { Badge } from "./EmailPage";

// LinkedIn message campaigns. Sending happens in the LinkedIn Messenger extension, in your own
// browser and LinkedIn account: this page queues the messages and sets the pace.

const MODE_LABEL: Record<LinkedInSendMode, string> = { assisted: "Assisted (you click Send)", auto: "Automatic" };

const WAITING_TEXT: Record<NonNullable<LinkedInCampaignDetail["waitingFor"]>, string> = {
  not_started: "waiting for the scheduled start time",
  outside_window: "outside the sending hours (press Edit timing → Any time to send now)",
  daily_limit: "daily limit reached",
  interval: "waiting for the gap between messages",
  extension: "ready — waiting for the LinkedIn Messenger extension to pick it up",
};

/** Same start and end = no hours limit. */
const anyTime = (c: { windowStart: string; windowEnd: string }) => c.windowStart === c.windowEnd;
const hoursLabel = (c: { windowStart: string; windowEnd: string; timeZone?: string }) =>
  anyTime(c) ? "any time" : `${c.windowStart}–${c.windowEnd}${c.timeZone ? ` (${c.timeZone})` : ""}`;

/** "Any time" or a from–to range. */
function HoursFields({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  const isAny = start === end;
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="label mb-1">Sending hours</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" checked={isAny} onChange={() => onChange("00:00", "00:00")} />
        Any time: starts as soon as you press Start
      </label>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input type="radio" checked={!isAny} onChange={() => onChange("10:00", "18:00")} />
        Only between
        <input className="input w-auto py-1" type="time" disabled={isAny} value={isAny ? "10:00" : start} onChange={(e) => onChange(e.target.value, end)} aria-label="Send from" />
        and
        <input className="input w-auto py-1" type="time" disabled={isAny} value={isAny ? "18:00" : end} onChange={(e) => onChange(start, e.target.value)} aria-label="Send until" />
      </label>
    </fieldset>
  );
}

/** Change the pace of a campaign that is not finished. */
function TimingEditor({ campaign, onSaved }: { campaign: LinkedInCampaign; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [intervalMin, setIntervalMin] = useState(campaign.intervalSec / 60);
  const [dailyLimit, setDailyLimit] = useState(campaign.dailyLimit);
  const [start, setStart] = useState(campaign.windowStart);
  const [end, setEnd] = useState(campaign.windowEnd);
  const save = useMutation({
    mutationFn: () =>
      api(`/linkedin-outreach/campaigns/${campaign.id}/schedule`, {
        method: "PATCH",
        body: { intervalSec: Math.round(intervalMin * 60), dailyLimit, windowStart: start, windowEnd: end },
      }),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });
  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Edit timing
      </button>
    );
  }
  return (
    <form
      className="card mb-6 grid gap-4 p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Minutes between messages" hint="At least 1 minute.">
        <input className="input" type="number" min={1} max={1440} step={0.5} required value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} />
      </Field>
      <Field label="Messages per day" hint="At most 100.">
        <input className="input" type="number" min={1} max={100} required value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} />
      </Field>
      <HoursFields
        start={start}
        end={end}
        onChange={(a, b) => {
          setStart(a);
          setEnd(b);
        }}
      />
      {save.error && <div className="sm:col-span-2"><ErrorBox error={save.error} /></div>}
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save timing"}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RiskNotice() {
  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      <strong>Your LinkedIn account is at risk.</strong> LinkedIn&apos;s User Agreement does not allow tools that automate sending messages. Accounts that use them
      can be restricted. Assisted mode (you press Send for each message) is the safer choice. Keep the daily limit low and only message people who would
      want to hear from you.
    </div>
  );
}

function ExtensionHint() {
  return (
    <p className="text-sm text-slate-500">
      Messages are sent by the <strong>LinkedIn Messenger</strong> extension (<code>npm run build:messenger</code>, then load <code>linkedin-messenger/dist</code> in{" "}
      <code>chrome://extensions</code>). Log in to it with your admin account, open LinkedIn in the same browser, and press <em>Start</em> in its side panel.
    </p>
  );
}

export function LinkedInCampaignsPage() {
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const list = useQuery({
    queryKey: ["linkedin-campaigns", page],
    queryFn: () => api<Page<LinkedInCampaign>>(`/linkedin-outreach/campaigns${qs({ page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="LinkedIn Outreach"
        subtitle={<ExtensionHint />}
        actions={
          <>
            <Link to="/templates?channel=linkedin" className="btn">
              Templates
            </Link>
            <Link to="/linkedin-outreach/new" className="btn btn-primary">
              + New campaign
            </Link>
          </>
        }
      />
      <RiskNotice />
      <div className="card">
        {list.isPending && <Spinner />}
        {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
        {list.data?.total === 0 && (
          <EmptyState title="No LinkedIn campaigns yet">
            Upload contacts in <Link to="/contacts" className="text-brand-600 hover:underline">Contacts (Sheets)</Link>, write a{" "}
            <Link to="/templates?channel=linkedin" className="text-brand-600 hover:underline">LinkedIn template</Link>, then create a campaign.
          </EmptyState>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {list.data?.items.map((c) => (
            <li key={c.id}>
              <Link to={`/linkedin-outreach/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-slate-500">
                    {MODE_LABEL[c.mode]} · {formatNumber(c.dailyLimit)}/day · every {Math.round(c.intervalSec / 60)} min · {hoursLabel(c)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{formatDate(c.createdAt)}</span>
                  <Badge status={c.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {list.data && list.data.total > 25 && <Pagination page={page} pageSize={25} total={list.data.total} onPage={(p) => setSearchParams({ page: p })} />}
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function NewLinkedInCampaignPage() {
  const params = useSearchParams();
  const preselected = (params.get("contactIds") ?? "").split(",").filter(Boolean);
  const client = useQueryClient();
  const templates = useQuery({
    queryKey: ["channel-templates", "linkedin"],
    queryFn: () => api<{ items: ChannelTemplate[] }>("/channel-templates?channel=linkedin").then((r) => r.items),
  });
  const facets = useQuery({ queryKey: ["contacts", "facets"], queryFn: () => api<ContactFacets>("/contacts/facets") });

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [listName, setListName] = useState(params.get("list") ?? "");
  const [mode, setMode] = useState<LinkedInSendMode>("assisted");
  const [intervalMin, setIntervalMin] = useState(5);
  const [dailyLimit, setDailyLimit] = useState(20);
  const [windowStart, setWindowStart] = useState("00:00"); // any time
  const [windowEnd, setWindowEnd] = useState("00:00");

  useEffect(() => {
    if (!templateId && templates.data?.[0]) setTemplateId(templates.data[0].id);
  }, [templates.data, templateId]);

  const recipients = preselected.length ? { contactIds: preselected } : { filters: { listName: listName || undefined } };
  const summary = useQuery({
    queryKey: ["linkedin-recipients", recipients],
    queryFn: () => api<LinkedInRecipientSummary>("/linkedin-outreach/recipients", { method: "POST", body: { recipients } }),
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ campaign: LinkedInCampaign; queued: number }>("/linkedin-outreach/campaigns", {
        method: "POST",
        body: { name, templateId, mode, recipients, intervalSec: Math.round(intervalMin * 60), dailyLimit, windowStart, windowEnd },
      }),
    onSuccess: ({ campaign }) => {
      client.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
      navigate(`/linkedin-outreach/${campaign.id}`);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  const template = templates.data?.find((t) => t.id === templateId);

  return (
    <>
      <Link to="/linkedin-outreach" className="mb-2 inline-block text-sm text-brand-600 hover:underline">
        ← LinkedIn campaigns
      </Link>
      <PageHeader title="New LinkedIn campaign" subtitle="It is saved as a draft; nothing is sent until you press Start and the extension is running." />
      <RiskNotice />
      {templates.data?.length === 0 ? (
        <div className="card p-5 text-sm">
          First write a LinkedIn message template:{" "}
          <Link to="/templates?channel=linkedin" className="text-brand-600 hover:underline">
            Templates → LinkedIn message
          </Link>
          .
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-4 p-5">
            <Field label="Campaign name">
              <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR Lucknow intro" />
            </Field>
            <Field label="Template">
              <select className="input" required value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            {preselected.length ? (
              <p className="text-sm">
                Recipients: <strong>{preselected.length}</strong> contacts selected on the Contacts page.{" "}
                <Link to="/linkedin-outreach/new" className="text-brand-600 hover:underline">
                  Use a list instead
                </Link>
              </p>
            ) : (
              <Field label="Contacts" hint="Only contacts with a LinkedIn URL are messaged.">
                <select className="input" value={listName} onChange={(e) => setListName(e.target.value)}>
                  <option value="">All contacts</option>
                  {facets.data?.lists.map((l) => (
                    <option key={l.value} value={l.value}>
                      List: {l.value} ({l.count})
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {summary.data && (
              <p className="text-sm text-slate-600 dark:text-slate-300" role="status">
                <strong>{formatNumber(summary.data.eligible)}</strong> will get a message
                {summary.data.noLinkedIn > 0 && ` · ${formatNumber(summary.data.noLinkedIn)} have no LinkedIn URL`}
                {summary.data.tooMany && " · too many: at most 2000 per campaign"}
              </p>
            )}
            <fieldset className="space-y-2">
              <legend className="label mb-1">Sending mode</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === "assisted"} onChange={() => setMode("assisted")} className="mt-1" />
                <span>
                  <strong>Assisted (recommended)</strong>: the extension opens the profile and types the message; you check it and press Send.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === "auto"} onChange={() => setMode("auto")} className="mt-1" />
                <span>
                  <strong>Automatic</strong>: the extension also presses Send. Higher risk of LinkedIn restricting your account.
                </span>
              </label>
            </fieldset>
          </div>
          <div className="space-y-6">
            <div className="card grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Minutes between messages" hint="At least 1 minute.">
                <input className="input" type="number" min={1} max={1440} step={0.5} required value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} />
              </Field>
              <Field label="Messages per day" hint="At most 100. 20–25 is a common cautious limit.">
                <input className="input" type="number" min={1} max={100} required value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} />
              </Field>
              <HoursFields
                start={windowStart}
                end={windowEnd}
                onChange={(a, b) => {
                  setWindowStart(a);
                  setWindowEnd(b);
                }}
              />
            </div>
            {template && (
              <section className="card p-5">
                <h2 className="mb-2 font-medium">Message</h2>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm dark:bg-slate-800/60">{template.body}</pre>
              </section>
            )}
            {create.error && <ErrorBox error={create.error} />}
            <button className="btn btn-primary" disabled={create.isPending || !summary.data?.eligible}>
              {create.isPending ? "Creating…" : "Create draft campaign"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

const MESSAGE_FILTERS: (AttemptStatus | "")[] = ["", "queued", "sending", "sent", "skipped", "failed", "cancelled"];

export function LinkedInCampaignDetailPage({ id }: { id: string }) {
  const client = useQueryClient();
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const status = (params.get("status") ?? "") as AttemptStatus | "";
  const detail = useQuery({ queryKey: ["linkedin-campaign", id], queryFn: () => api<LinkedInCampaignDetail>(`/linkedin-outreach/campaigns/${id}`), refetchInterval: 15_000 });
  const messages = useQuery({
    queryKey: ["linkedin-campaign", id, "messages", page, status],
    queryFn: () => api<Page<LinkedInMessage>>(`/linkedin-outreach/campaigns/${id}/messages${qs({ page, pageSize: 50, status })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const action = useMutation({
    mutationFn: (verb: "start" | "pause" | "stop") => api(`/linkedin-outreach/campaigns/${id}/${verb}`, { method: "POST" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["linkedin-campaign", id] });
      client.invalidateQueries({ queryKey: ["linkedin-campaigns"] });
    },
  });

  if (detail.isPending) return <Spinner />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const { campaign: c, template, counts, sentToday, nextSendAt, waitingFor } = detail.data;
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <Link to="/linkedin-outreach" className="mb-2 inline-block text-sm text-brand-600 hover:underline">
        ← LinkedIn campaigns
      </Link>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge status={c.status} /> {MODE_LABEL[c.mode]} · {formatNumber(c.dailyLimit)}/day · every {Math.round(c.intervalSec / 60)} min · {hoursLabel(c)}
          </span>
        }
        actions={
          <>
            {(c.status === "draft" || c.status === "paused") && (
              <button className="btn btn-primary" disabled={action.isPending} onClick={() => action.mutate("start")}>
                {c.status === "draft" ? "Start" : "Resume"}
              </button>
            )}
            {c.status === "running" && (
              <button className="btn" disabled={action.isPending} onClick={() => action.mutate("pause")}>
                Pause
              </button>
            )}
            {c.status !== "stopped" && c.status !== "completed" && (
              <ConfirmButton label="Stop" confirmLabel="Stop for good?" onConfirm={() => action.mutate("stop")} />
            )}
          </>
        }
      />
      {action.error && <div className="mb-4"><ErrorBox error={action.error} /></div>}
      {c.status !== "stopped" && c.status !== "completed" && (
        <div className="mb-4">
          <TimingEditor key={`${c.intervalSec}-${c.dailyLimit}-${c.windowStart}-${c.windowEnd}`} campaign={c} onSaved={() => client.invalidateQueries({ queryKey: ["linkedin-campaign", id] })} />
        </div>
      )}
      {c.status === "paused" && c.statusReason && c.statusReason !== "paused_by_admin" && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Paused: {c.statusReason}. Fix it in your browser (log in to LinkedIn, finish any security check yourself), then press Resume.
        </div>
      )}
      {c.status === "running" && waitingFor && (
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          Next message: {WAITING_TEXT[waitingFor]}
          {nextSendAt && waitingFor !== "extension" && ` (${formatDate(nextSendAt)})`}.
        </p>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Total", total],
            ["Queued", counts.queued ?? 0],
            ["Sent", counts.sent ?? 0],
            ["Sent today", sentToday],
            ["Skipped", counts.skipped ?? 0],
            ["Failed", counts.failed ?? 0],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="label">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(value)}</p>
          </div>
        ))}
      </div>

      {template && (
        <details className="card mb-6 p-5">
          <summary className="cursor-pointer font-medium">Template: {template.name}</summary>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm dark:bg-slate-800/60">{template.body}</pre>
        </details>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 p-3 dark:border-slate-800">
          {MESSAGE_FILTERS.map((s) => (
            <button key={s || "all"} className={`btn px-2 py-1 text-xs ${status === s ? "btn-primary" : ""}`} onClick={() => setSearchParams({ status: s, page: null })}>
              {s || "All"}
            </button>
          ))}
        </div>
        {messages.isPending && <Spinner />}
        {messages.data?.total === 0 && <EmptyState title="No messages" />}
        {messages.data && messages.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2">Contact</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Sent</th>
                  <th className="px-4 py-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {messages.data.items.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="px-4 py-2">
                      <a href={safeHref(m.profileUrl)} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-600 hover:underline">
                        {m.contactName}
                      </a>
                      <details className="text-xs text-slate-500">
                        <summary className="cursor-pointer">Message</summary>
                        <pre className="mt-1 max-w-xl whitespace-pre-wrap font-sans">{m.renderedBody}</pre>
                      </details>
                    </td>
                    <td className="px-4 py-2">
                      <Badge status={m.status} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-500">{m.sentAt ? formatDate(m.sentAt) : "—"}</td>
                    <td className="px-4 py-2 text-slate-500">{m.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {messages.data && messages.data.total > 50 && <Pagination page={page} pageSize={50} total={messages.data.total} onPage={(p) => setSearchParams({ page: p })} />}
      </div>
    </>
  );
}
