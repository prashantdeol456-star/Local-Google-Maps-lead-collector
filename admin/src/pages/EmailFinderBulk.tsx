import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, Spinner } from "../components/ui";
import { api, withViewOwner } from "../lib/api";
import { formatRelative } from "../lib/format";
import { setSearchParams, useSearchParams } from "../lib/router";

// Email finder → Bulk: upload a sheet of companies / people; each row's website is read for the
// emails and phones it publishes, and Hunter fills in work emails within a credit budget.

interface Job {
  id: string;
  name: string;
  status: "queued" | "running" | "paused" | "done" | "stopped";
  useWebsites: boolean;
  useHunter: boolean;
  hunterBudget: number;
  hunterUsed: number;
  total: number;
  done: number;
  found: number;
  note: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  idx: number;
  name: string | null;
  company: string | null;
  website: string | null;
  designation: string | null;
  status: "pending" | "found" | "not_found" | "failed" | "skipped";
  emails: { value: string; source: string }[];
  phones: { value: string; source: string }[];
  note: string | null;
}

const SOURCE: Record<string, string> = { given: "in sheet", website: "website", contact_page: "contact page", hunter: "Hunter", snov: "Snov.io" };
const STATUS: Record<Row["status"], string> = { pending: "Waiting", found: "Found", not_found: "Nothing found", failed: "Failed", skipped: "Skipped (no website or name)" };
const JOB_STATUS: Record<Job["status"], string> = { queued: "Waiting", running: "Running", paused: "Paused", done: "Done", stopped: "Stopped" };

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("Cannot read the file"));
    r.readAsDataURL(file);
  });
}

function Upload({ hunterReady, creditsLeft, onCreated }: { hunterReady: boolean; creditsLeft: number | null; onCreated: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [useWebsites, setUseWebsites] = useState(true);
  const [useHunter, setUseHunter] = useState(false);
  const [budget, setBudget] = useState(10);
  const create = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a sheet");
      if (file.size > 5 * 1024 * 1024) throw new Error("The sheet is larger than 5 MB");
      return api<{ job: Job }>("/enrich/jobs", { method: "POST", body: { name, fileName: file.name, data: await toBase64(file), useWebsites, useHunter, hunterBudget: useHunter ? budget : 0 } });
    },
    onSuccess: (r) => onCreated(r.job.id),
  });
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2 className="font-semibold">Fill in emails and phones for a sheet</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Excel or CSV, up to 2,000 rows, with a column <strong>Website</strong> (and if you have them Name, Company, LinkedIn URL, Designation).{" "}
        <a className="text-brand-600 underline" href={withViewOwner("/api/enrich/template.csv")} download>
          Download a sample sheet
        </a>
        .
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Sheet" />
        <input className="input" placeholder="Name for this job (optional)" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Job name" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={useWebsites} onChange={(e) => setUseWebsites(e.target.checked)} />
        Read each website (home page and up to 3 Contact/About pages) for the emails and phones it shows · free
      </label>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input type="checkbox" checked={useHunter} disabled={!hunterReady} onChange={(e) => setUseHunter(e.target.checked)} />
        When a website shows no email, ask Hunter for the person's work email (rows with a name), at most
        <input className="input w-20 py-1" type="number" min={1} max={1000} value={budget} disabled={!useHunter} onChange={(e) => setBudget(e.target.valueAsNumber || 1)} aria-label="Hunter credit budget" />
        credits{creditsLeft !== null && ` (${creditsLeft} left this month)`}
      </label>
      {!hunterReady && <p className="text-xs text-slate-500">Add your Hunter key above to use Hunter here.</p>}
      {create.error && <ErrorBox error={create.error} />}
      <button className="btn btn-primary" disabled={create.isPending || !file}>
        {create.isPending ? "Uploading…" : "Start"}
      </button>
    </form>
  );
}

function JobView({ id }: { id: string }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [listName, setListName] = useState("");
  const detail = useQuery({
    queryKey: ["enrich-job", id, page],
    queryFn: () => api<{ job: Job; rows: Row[] }>(`/enrich/jobs/${id}?page=${page}`),
    refetchInterval: (q) => (q.state.data?.job.status === "running" ? 4000 : false),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["enrich-job", id] });
    void client.invalidateQueries({ queryKey: ["enrich-jobs"] });
  };
  const act = useMutation({ mutationFn: (action: "pause" | "resume" | "stop") => api(`/enrich/jobs/${id}/${action}`, { method: "POST" }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => api(`/enrich/jobs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setSearchParams({ job: null });
      void client.invalidateQueries({ queryKey: ["enrich-jobs"] });
    },
  });
  const toContacts = useMutation({ mutationFn: () => api<{ sent: number; created: number; updated: number }>(`/enrich/jobs/${id}/to-contacts`, { method: "POST", body: { listName: listName || null } }) });

  if (detail.isPending) return <Spinner />;
  if (detail.error) return <ErrorBox error={detail.error} />;
  const { job, rows } = detail.data;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn px-3 py-1 text-sm" onClick={() => setSearchParams({ job: null })}>
          ← All sheets
        </button>
        <h2 className="flex-1 font-semibold">{job.name}</h2>
        {job.status === "running" && (
          <button className="btn" onClick={() => act.mutate("pause")}>
            Pause
          </button>
        )}
        {job.status === "paused" && (
          <button className="btn btn-primary" onClick={() => act.mutate("resume")}>
            Resume
          </button>
        )}
        {(job.status === "running" || job.status === "paused") && <ConfirmButton label="Stop" onConfirm={() => act.mutate("stop")} />}
        <a className="btn" href={withViewOwner(`/api/enrich/jobs/${id}/export.csv`)} download>
          ⬇ Export CSV
        </a>
        <ConfirmButton label="Delete" onConfirm={() => remove.mutate()} />
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
          <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {JOB_STATUS[job.status]} · {job.done} of {job.total} rows · {job.found} with an email or phone
          {job.useHunter || job.hunterUsed ? ` · Hunter ${job.hunterUsed} of ${job.hunterBudget} credits` : ""}
        </p>
        {job.note && <p className="text-sm text-amber-700 dark:text-amber-300">{job.note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-56" placeholder={`List name (${job.name})`} value={listName} maxLength={100} onChange={(e) => setListName(e.target.value)} aria-label="Contact list name" />
        <button className="btn btn-primary" disabled={toContacts.isPending || job.found === 0} onClick={() => toContacts.mutate()}>
          Add the found ones to Contacts
        </button>
        {toContacts.data && (
          <span className="text-sm text-emerald-700 dark:text-emerald-400">
            Sent {toContacts.data.sent}: {toContacts.data.created} new, {toContacts.data.updated} updated.
          </span>
        )}
        {toContacts.error && <ErrorBox error={toContacts.error} />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Name / company</th>
              <th className="px-3 py-2">Website</th>
              <th className="px-3 py-2">Emails</th>
              <th className="px-3 py-2">Phones</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2 text-slate-500">{r.idx + 1}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{r.name ?? r.company ?? "—"}</span>
                  {r.name && r.company && <span className="block text-xs text-slate-500">{[r.designation, r.company].filter(Boolean).join(" · ")}</span>}
                </td>
                <td className="max-w-[12rem] truncate px-3 py-2 text-xs">{r.website ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {r.emails.map((e) => (
                    <span key={e.value} className="block">
                      {e.value} <span className="text-slate-500">({SOURCE[e.source] ?? e.source})</span>
                    </span>
                  ))}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.phones.map((p) => (
                    <span key={p.value} className="block whitespace-nowrap">
                      {p.value} <span className="text-slate-500">({SOURCE[p.source] ?? p.source})</span>
                    </span>
                  ))}
                </td>
                <td className="px-3 py-2 text-xs">
                  {STATUS[r.status]}
                  {r.note && <span className="block text-slate-500">{r.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {job.total > 100 && (
        <div className="flex items-center gap-2 text-sm">
          <button className="btn px-3 py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Previous
          </button>
          <span>
            Rows {(page - 1) * 100 + 1}–{Math.min(page * 100, job.total)} of {job.total}
          </span>
          <button className="btn px-3 py-1" disabled={page * 100 >= job.total} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

export function EmailFinderBulk({ hunterReady, creditsLeft }: { hunterReady: boolean; creditsLeft: number | null }) {
  const params = useSearchParams();
  const open = params.get("job");
  const jobs = useQuery({
    queryKey: ["enrich-jobs"],
    queryFn: () => api<{ items: Job[] }>("/enrich/jobs").then((r) => r.items),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "running") ? 5000 : false),
  });
  if (open) return <JobView key={open} id={open} />;
  return (
    <div className="space-y-6">
      <Upload hunterReady={hunterReady} creditsLeft={creditsLeft} onCreated={(id) => setSearchParams({ job: id })} />
      <div className="card">
        <h2 className="border-b border-slate-200 p-4 font-semibold dark:border-slate-800">Sheets</h2>
        {jobs.isPending && <Spinner />}
        {jobs.error && <ErrorBox error={jobs.error} />}
        {jobs.data?.length === 0 && <EmptyState title="No sheets yet">Upload a sheet above; rows are worked through in the background.</EmptyState>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {jobs.data?.map((j) => (
            <li key={j.id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSearchParams({ job: j.id })}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{j.name}</span>
                  <span className="text-xs text-slate-500">
                    {formatRelative(j.createdAt)} · {j.done}/{j.total} rows · {j.found} found
                  </span>
                </span>
                <span className="text-xs">{JOB_STATUS[j.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
