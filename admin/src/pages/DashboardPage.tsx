import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorBox, PageHeader, StatCard, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { formatNumber, formatRelative } from "../lib/format";
import { Link } from "../lib/router";
import type { Job, Lead, Page, Stats } from "../lib/types";

function ActiveJob({ job }: { job: Job | null }) {
  if (!job) {
    return (
      <EmptyState title="No collection running">Start one from the Chrome extension side panel on Google Maps.</EmptyState>
    );
  }
  const progress = job.maxRecords ? Math.min(100, Math.round((job.totalFound / job.maxRecords) * 100)) : null;
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/collections/${job.id}`} className="font-medium text-brand-600 hover:underline">
          {job.searchKeyword}
          {job.location ? ` in ${job.location}` : ""}
        </Link>
        <StatusBadge status={job.status} />
      </div>
      {progress !== null && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatNumber(job.totalFound)} of {formatNumber(job.maxRecords)} listings ({progress}%)
          </p>
        </div>
      )}
      <dl className="grid grid-cols-4 gap-2 text-center">
        {[
          ["Found", job.totalFound],
          ["New", job.newRecords],
          ["Duplicate", job.duplicateRecords],
          ["Errors", job.errorRecords],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/50">
            <dd className="text-lg font-semibold tabular-nums">{formatNumber(value as number)}</dd>
            <dt className="text-xs text-slate-500">{label}</dt>
          </div>
        ))}
      </dl>
      {job.statusReason && <p className="text-xs text-slate-500">Reason: {job.statusReason}</p>}
    </div>
  );
}

export function DashboardPage() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats") });
  const leads = useQuery({ queryKey: ["leads", "recent"], queryFn: () => api<Page<Lead>>("/leads?pageSize=6") });
  const jobs = useQuery({ queryKey: ["jobs", "recent"], queryFn: () => api<Page<Job>>("/jobs?pageSize=6") });
  const s = stats.data;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={s ? `Times shown in your browser's zone; "today" counts in ${s.timeZone}.` : undefined} />
      {stats.error && <ErrorBox error={stats.error} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Total leads" value={s?.totalLeads} icon="☰" />
        <StatCard label="New today" value={s?.todayLeads} icon="✦" tone="green" />
        <StatCard label="Duplicates skipped" value={s?.totalDuplicates} icon="↺" tone="slate" />
        <StatCard label="Collections" value={s?.totalCollections} icon="⌖" tone="amber" />
        <StatCard label="Completed jobs" value={s?.completedJobs} icon="✓" tone="blue" />
        <StatCard label="Emails sent" value={s?.emailsSent} icon="✉" tone="green" />
        <StatCard label="WhatsApp sent" value={s?.whatsappSent} icon="✆" tone="green" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-1">
          <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Active collection</h2>
          {s && <ActiveJob job={s.activeJob} />}
        </section>

        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
            <h2 className="font-medium">Latest leads</h2>
            <Link to="/leads" className="text-sm text-brand-600 hover:underline">
              View all →
            </Link>
          </div>
          {leads.data?.items.length === 0 && <EmptyState title="No leads yet" />}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {leads.data?.items.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link to={`/leads/${l.id}`} className="block truncate font-medium hover:text-brand-600">
                    {l.name}
                  </Link>
                  <p className="truncate text-xs text-slate-500">{[l.category, l.city].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">{formatRelative(l.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card mt-6">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-medium">Recent collections</h2>
          <Link to="/collections" className="text-sm text-brand-600 hover:underline">
            View all →
          </Link>
        </div>
        {jobs.data?.items.length === 0 && <EmptyState title="No collections yet" />}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {jobs.data?.items.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <Link to={`/collections/${j.id}`} className="font-medium hover:text-brand-600">
                {j.searchKeyword}
                {j.location ? ` in ${j.location}` : ""}
              </Link>
              <span className="flex items-center gap-3 text-xs text-slate-500">
                {formatNumber(j.newRecords)} new · {formatNumber(j.duplicateRecords)} dup
                <StatusBadge status={j.status} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
