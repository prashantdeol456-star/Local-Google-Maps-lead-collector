import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner, StatusBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { AgentLog, Job, JobStatus, Page } from "../lib/types";

const STATUSES: JobStatus[] = ["pending", "running", "paused", "completed", "stopped", "failed"];
const STOPPABLE: JobStatus[] = ["pending", "running", "paused"];

function useStopJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ job: Job }>(`/jobs/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "stopped", statusReason: "stopped_from_admin" } }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["jobs"] });
      client.invalidateQueries({ queryKey: ["job"] });
      client.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function CollectionsPage() {
  const params = useSearchParams();
  const status = STATUSES.includes(params.get("status") as JobStatus) ? params.get("status")! : "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = 25;
  const query = qs({ status, page, pageSize });
  const jobs = useQuery({ queryKey: ["jobs", query], queryFn: () => api<Page<Job>>(`/jobs${query}`), placeholderData: keepPreviousData });
  const stop = useStopJob();

  return (
    <>
      <PageHeader
        title="Collections"
        subtitle="Google Maps searches run from the Chrome extension"
        actions={
          <select className="input w-auto" aria-label="Filter by status" value={status} onChange={(e) => setSearchParams({ status: e.target.value, page: null })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
        }
      />
      <div className="card">
        {jobs.error && <div className="p-4"><ErrorBox error={jobs.error} /></div>}
        {stop.error && <div className="p-4"><ErrorBox error={stop.error} /></div>}
        {jobs.isPending && <Spinner />}
        {jobs.data?.items.length === 0 && <EmptyState title="No collections" />}
        {jobs.data && jobs.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="th">Search</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Found</th>
                  <th className="th text-right">New</th>
                  <th className="th text-right">Duplicate</th>
                  <th className="th text-right">Errors</th>
                  <th className="th">Started</th>
                  <th className="th">Finished</th>
                  <th className="th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {jobs.data.items.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="td">
                      <Link to={`/collections/${j.id}`} className="font-medium hover:text-brand-600">
                        {j.searchKeyword}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {j.location ?? "Any location"}
                        {j.maxRecords ? ` · max ${formatNumber(j.maxRecords)}` : ""}
                        {j.queueId !== null && j.position !== null ? ` · queue #${j.position + 1}` : ""}
                      </p>
                    </td>
                    <td className="td"><StatusBadge status={j.status} /></td>
                    <td className="td text-right tabular-nums">{formatNumber(j.totalFound)}</td>
                    <td className="td text-right tabular-nums text-emerald-600">{formatNumber(j.newRecords)}</td>
                    <td className="td text-right tabular-nums text-slate-500">{formatNumber(j.duplicateRecords)}</td>
                    <td className="td text-right tabular-nums text-red-600">{formatNumber(j.errorRecords)}</td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">{formatDate(j.startedAt)}</td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">{formatDate(j.completedAt)}</td>
                    <td className="td whitespace-nowrap text-right">
                      {STOPPABLE.includes(j.status) && (
                        <ConfirmButton label="Stop" confirmLabel="Stop job" className="btn btn-danger px-2 py-1 text-xs" disabled={stop.isPending} onConfirm={() => stop.mutate(j.id)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {jobs.data && jobs.data.total > 0 && (
          <Pagination page={page} pageSize={pageSize} total={jobs.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />
        )}
      </div>
    </>
  );
}

const LOG_DOT: Record<AgentLog["status"], string> = {
  info: "bg-brand-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

export function CollectionDetailPage({ id }: { id: string }) {
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api<{ job: Job }>(`/jobs/${encodeURIComponent(id)}`).then((r) => r.job) });
  const logs = useQuery({ queryKey: ["logs", id], queryFn: () => api<{ items: AgentLog[] }>(`/jobs/${encodeURIComponent(id)}/logs`).then((r) => r.items) });
  const stop = useStopJob();

  if (job.isPending) return <Spinner />;
  if (job.error) return <ErrorBox error={job.error} />;
  const j = job.data;

  return (
    <>
      <Link to="/collections" className="mb-3 inline-block text-sm text-slate-500 hover:text-brand-600">
        ← Collections
      </Link>
      <PageHeader
        title={`${j.searchKeyword}${j.location ? ` in ${j.location}` : ""}`}
        subtitle={<StatusBadge status={j.status} />}
        actions={
          <>
            {j.searchKeyword && (
              <Link className="btn" to={`/leads?keyword=${encodeURIComponent(j.searchKeyword)}`}>
                View leads for “{j.searchKeyword}”
              </Link>
            )}
            {STOPPABLE.includes(j.status) && <ConfirmButton label="Stop" confirmLabel="Stop job" onConfirm={() => stop.mutate(j.id)} disabled={stop.isPending} />}
          </>
        }
      />
      {stop.error && <ErrorBox error={stop.error} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Found", j.totalFound, ""],
          ["New", j.newRecords, "text-emerald-600"],
          ["Duplicate", j.duplicateRecords, "text-slate-500"],
          ["Errors", j.errorRecords, "text-red-600"],
        ].map(([label, value, color]) => (
          <div key={label as string} className="card p-5">
            <p className="label">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{formatNumber(value as number)}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card">
          <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Details</h2>
          <dl className="space-y-3 p-5 text-sm">
            {[
              ["Max records", j.maxRecords ? formatNumber(j.maxRecords) : "No limit"],
              ["Created", formatDate(j.createdAt)],
              ["Started", formatDate(j.startedAt)],
              ["Finished", formatDate(j.completedAt)],
              ["Last reason", j.statusReason ?? "—"],
              ["Queue", j.queueId !== null && j.position !== null ? `Search #${j.position + 1}` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card lg:col-span-2">
          <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Activity log</h2>
          {logs.isPending && <Spinner />}
          {logs.data?.length === 0 && <EmptyState title="No activity yet" />}
          <ol className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {logs.data?.map((log) => (
              <li key={log.id} className="flex gap-3 px-5 py-2.5 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LOG_DOT[log.status]}`} aria-label={log.status} />
                <div className="min-w-0 flex-1">
                  <code className="text-xs text-slate-500">{log.action}</code>
                  {log.message && <p className="break-words">{log.message}</p>}
                </div>
                <time className="shrink-0 text-xs text-slate-500">{formatDate(log.createdAt)}</time>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
