import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner, StatCard } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatRelative } from "../lib/format";
import { setSearchParams, useSearchParams } from "../lib/router";
import { EmailFinderBulk } from "./EmailFinderBulk";

// Email finder: your own Hunter API key for Contact Finder (find a person's work email, check an
// email, emails at a company's domain). Every lookup checks your free credits first and never
// goes over them.

interface Status {
  configured: boolean;
  keyHint: string | null;
  status: "ok" | "disabled" | "error" | null;
  statusReason: string | null;
  planName: string | null;
  credits: { used: number; available: number; left: number; held: number } | null;
  resetDate: string | null;
  exhaustedUntil: string | null;
  checkedAt: string | null;
  recent: { id: string; kind: string; query: string; status: string; reservedUnits: number; usedUnits: number | null; error: string | null; createdAt: string }[];
}

interface Found {
  email: string;
  score: number | null;
  verification: string | null;
  position: string | null;
  sources: number;
}

const KIND: Record<string, string> = { email_finder: "Find email", email_verifier: "Check email", domain_search: "Domain emails" };
const STATUS: Record<string, string> = { done: "Found", not_found: "Not found", reserved: "Waiting", unknown: "Unknown (credit held)", failed: "Failed", blocked: "Not enough credits" };

function KeyCard({ status, onSaved }: { status: Status; onSaved: (s: Status) => void }) {
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: (value: string | null) => api<Status>("/enrich/hunter-key", { method: "PUT", body: { key: value } }),
    onSuccess: (s) => {
      setKey("");
      onSaved(s);
    },
  });
  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-semibold">Hunter API key</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Make a free account on hunter.io, then Hunter → API → copy your API key and paste it here. The free plan has 50 credits a month: finding an email costs 1 credit
        only when an email is found, checking an email 0.5, domain emails 1 per email found. The key stays on the server (encrypted), never in the extension.
      </p>
      {status.configured && (
        <p className="text-sm">
          Saved key: <code>{status.keyHint}</code>
          {status.status === "disabled" && <span className="ml-2 text-red-600">Switched off: {status.statusReason}</span>}
        </p>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (key.trim()) save.mutate(key.trim());
        }}
      >
        <input className="input flex-1" type="password" autoComplete="off" placeholder={status.configured ? "Paste a new key to replace it" : "Paste your Hunter API key"} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Hunter API key" />
        <button className="btn btn-primary" disabled={save.isPending || !key.trim()}>
          {save.isPending ? "Checking…" : "Save and check"}
        </button>
        {status.configured && (
          <button type="button" className="btn btn-danger" disabled={save.isPending} onClick={() => save.mutate(null)}>
            Remove key
          </button>
        )}
      </form>
      {save.error && <ErrorBox error={save.error} />}
    </div>
  );
}

function TryIt({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [domain, setDomain] = useState("");
  const find = useMutation({
    mutationFn: () => api<{ status: string; result: Found | null; creditsLeft: number | null }>("/enrich/find-email", { method: "POST", body: { fullName: name, company: company || null, domain: domain || null } }),
    onSettled: onDone,
  });
  const byDomain = useMutation({
    mutationFn: () => api<{ status: string; result: Found[] | null }>("/enrich/domain-emails", { method: "POST", body: { domain, limit: 5 } }),
    onSettled: onDone,
  });
  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-semibold">Try it</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">Contact Finder does the same from a LinkedIn profile or a website. Results come from Hunter: check the confidence before you write.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="input" placeholder="Person's full name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" />
        <input className="input" placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company name" />
        <input className="input" placeholder="Company website, e.g. acme.in" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Company website" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={find.isPending || !name.trim() || (!company.trim() && !domain.trim())} onClick={() => find.mutate()}>
          {find.isPending ? "Finding…" : "Find work email (1 credit if found)"}
        </button>
        <button className="btn" disabled={byDomain.isPending || !domain.trim()} onClick={() => byDomain.mutate()}>
          {byDomain.isPending ? "Searching…" : "Emails at this website (up to 5 credits)"}
        </button>
      </div>
      {(find.error || byDomain.error) && <ErrorBox error={find.error ?? byDomain.error} />}
      {find.data && (
        <p className="text-sm">
          {find.data.result ? (
            <>
              <strong>{find.data.result.email}</strong> · confidence {find.data.result.score ?? "?"}% · {find.data.result.verification ?? "not checked"}
              {find.data.status === "cached" && " · from an earlier lookup (no credit)"}
            </>
          ) : (
            "Hunter found no email for this person (no credit used)."
          )}
        </p>
      )}
      {byDomain.data && (
        <ul className="text-sm">
          {(byDomain.data.result ?? []).length === 0 && <li>No emails known for this website.</li>}
          {(byDomain.data.result ?? []).map((e) => (
            <li key={e.email}>
              <strong>{e.email}</strong> {e.position && `· ${e.position}`} · confidence {e.score ?? "?"}%
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EmailFinderPage() {
  const client = useQueryClient();
  const params = useSearchParams();
  const tab = params.get("tab") === "bulk" || params.get("job") ? "bulk" : "key";
  const status = useQuery({ queryKey: ["enrich"], queryFn: () => api<Status>("/enrich/status") });
  const refresh = useMutation({ mutationFn: () => api<Status>("/enrich/refresh", { method: "POST" }), onSuccess: (s) => client.setQueryData(["enrich"], s) });
  const s = status.data;
  return (
    <>
      <PageHeader
        title="Email finder"
        subtitle="Emails and phones for people and companies: Contact Finder, a whole sheet at once (Bulk), and your own Hunter key for work emails. Only your free Hunter credits are used, never more."
        actions={
          s?.configured ? (
            <button className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? "Checking…" : "⟳ Check credits"}
            </button>
          ) : undefined
        }
      />
      <nav className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800" aria-label="Email finder">
        {(
          [
            ["key", "Hunter key and credits"],
            ["bulk", "Bulk (sheet)"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setSearchParams({ tab: id === "key" ? null : id, job: null })}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === id ? "border-brand-600 text-brand-600" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {status.isPending && <Spinner />}
      {s && tab === "bulk" && <EmailFinderBulk hunterReady={s.configured && s.status !== "disabled"} creditsLeft={s.credits?.left ?? null} />}
      {status.error && <ErrorBox error={status.error} />}
      {refresh.error && <ErrorBox error={refresh.error} />}
      {s && tab === "key" && (
        <div className="space-y-6">
          {s.credits && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Credits left" value={s.credits.left} hint={`of ${s.credits.available} this month (${s.planName ?? "plan"})`} icon="◎" tone="green" />
              <StatCard label="Used" value={s.credits.used} icon="✓" />
              <StatCard label="Held for unfinished lookups" value={s.credits.held} icon="⏳" tone="amber" />
              <StatCard label="Kept as safety margin" value={Math.ceil(s.credits.available * 0.1)} hint={s.resetDate ? `Renews ${formatDate(s.resetDate)}` : undefined} icon="⛨" tone="slate" />
            </div>
          )}
          {s.exhaustedUntil && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Credits are used up: lookups start again on {formatDate(s.exhaustedUntil)}.</p>}
          <KeyCard status={s} onSaved={(next) => client.setQueryData(["enrich"], next)} />
          {s.configured && s.status !== "disabled" && <TryIt onDone={() => void client.invalidateQueries({ queryKey: ["enrich"] })} />}
          <div className="card">
            <h2 className="border-b border-slate-200 p-4 font-semibold dark:border-slate-800">Recent lookups</h2>
            {s.recent.length === 0 ? (
              <EmptyState title="No lookups yet">Lookups from Contact Finder and this page appear here with the credits they used.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2">When</th>
                      <th className="px-4 py-2">Lookup</th>
                      <th className="px-4 py-2">For</th>
                      <th className="px-4 py-2">Result</th>
                      <th className="px-4 py-2">Credits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {s.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2 whitespace-nowrap text-slate-500">{formatRelative(r.createdAt)}</td>
                        <td className="px-4 py-2">{KIND[r.kind] ?? r.kind}</td>
                        <td className="max-w-xs truncate px-4 py-2">{r.query.replace(/\|+$/, "").replace(/\|/g, " · ")}</td>
                        <td className="px-4 py-2">
                          {STATUS[r.status] ?? r.status}
                          {r.error && <span className="block text-xs text-slate-500">{r.error}</span>}
                        </td>
                        <td className="px-4 py-2 tabular-nums">{r.usedUnits ?? (r.status === "unknown" ? `${r.reservedUnits} held` : "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
