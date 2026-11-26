import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { EmptyState, ErrorBox, Spinner, StatCard } from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";

// Email finder → Apollo people search: find decision-makers by job title, seniority, location and
// company with your own Apollo.io key (free), then get the work emails of the ones you pick
// (1 Apollo credit each, only within your credits, never more).

interface Status {
  configured: boolean;
  keyHint: string | null;
  status: "ok" | "disabled" | null;
  statusReason: string | null;
  credits: { limit: number; used: number; left: number; held: number } | null;
  cycleEnd: string | null;
}

interface Revealed {
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  city: string | null;
  country: string | null;
}

interface Person {
  id: string;
  firstName: string;
  lastName: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  hasEmail: boolean;
  /** null: not asked yet; false: Apollo had no details */
  revealed: Revealed | false | null;
}

interface SearchResult {
  total: number;
  page: number;
  pages: number;
  people: Person[];
}

const SENIORITY: [string, string][] = [
  ["owner", "Owner"],
  ["founder", "Founder"],
  ["c_suite", "CXO"],
  ["partner", "Partner"],
  ["vp", "VP"],
  ["head", "Head"],
  ["director", "Director"],
  ["manager", "Manager"],
  ["senior", "Senior"],
];
const SIZES: [string, string][] = [
  ["", "Any size"],
  ["1,10", "1–10"],
  ["11,50", "11–50"],
  ["51,200", "51–200"],
  ["201,1000", "201–1,000"],
  ["1001,100000", "1,000+"],
];

const lines = (s: string) =>
  s
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

function KeyCard({ status, onSaved }: { status: Status; onSaved: (s: Status) => void }) {
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: (value: string | null) => api<Status>("/enrich/apollo/key", { method: "PUT", body: { key: value } }),
    onSuccess: (s) => {
      setKey("");
      onSaved(s);
    },
  });
  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-semibold">Apollo API key</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Make a free Apollo.io account with your work email, then Settings → Integrations → API → Create new key. Tick <b>People API Search</b>, <b>People Enrichment</b> and{" "}
        <b>View Credit Usage Stats</b> (or choose “Set as master key”), copy the key and paste it here. Searching is free; each work email costs 1 Apollo credit. The key stays on the server
        (encrypted).
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
        <input className="input flex-1" type="password" autoComplete="off" placeholder={status.configured ? "Paste a new key to replace it" : "Paste your Apollo API key"} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Apollo API key" />
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

export function EmailFinderApollo() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ["apollo"], queryFn: () => api<Status>("/enrich/apollo/status") });
  const refresh = useMutation({ mutationFn: () => api<Status>("/enrich/apollo/refresh", { method: "POST" }), onSuccess: (s) => client.setQueryData(["apollo"], s) });
  const [titles, setTitles] = useState("");
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [place, setPlace] = useState("");
  const [placeOf, setPlaceOf] = useState<"company" | "person">("company");
  const [domains, setDomains] = useState("");
  const [keywords, setKeywords] = useState("");
  const [size, setSize] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [listName, setListName] = useState("");
  const [got, setGot] = useState<Record<string, Revealed | false>>({});
  const search = useMutation({
    mutationFn: (page: number) =>
      api<SearchResult>("/enrich/apollo/search", {
        method: "POST",
        body: {
          titles: lines(titles.replace(/,/g, ";")),
          seniorities,
          [placeOf === "company" ? "organizationLocations" : "personLocations"]: lines(place),
          domains: lines(domains.replace(/[,\s]+/g, ";")),
          employeeRanges: size ? [size] : [],
          keywords: keywords.trim() || null,
          page,
        },
      }),
    onSuccess: () => setPicked(new Set()),
  });
  const reveal = useMutation({
    mutationFn: (ids: string[]) => api<{ items: { id: string; status: string; person: Revealed | null; error?: string }[]; creditsLeft: number | null }>("/enrich/apollo/reveal", { method: "POST", body: { ids } }),
    onSuccess: (r) => {
      // Show the emails in the list at once, and the credits left.
      const next = { ...got };
      for (const it of r.items) if (it.status === "found" || it.status === "cached" || it.status === "not_found") next[it.id] = it.person ?? false;
      setGot(next);
      setPicked(new Set());
      void client.invalidateQueries({ queryKey: ["apollo"] });
    },
  });
  const toContacts = useMutation({
    mutationFn: (ids: string[]) => api<{ sent: number }>("/enrich/apollo/to-contacts", { method: "POST", body: { ids, listName: listName.trim() || null } }),
  });
  const s = status.data;
  const data = search.data && { ...search.data, people: search.data.people.map((p) => (p.id in got ? { ...p, revealed: got[p.id]! } : p)) };
  const revealedIds = (data?.people ?? []).filter((p) => p.revealed).map((p) => p.id);
  const blocked = reveal.data?.items.filter((i) => i.status === "blocked" || i.status === "failed") ?? [];

  if (status.isPending) return <Spinner />;
  if (status.error) return <ErrorBox error={status.error} />;
  if (!s) return null;
  return (
    <div className="space-y-6">
      {s.credits && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Apollo email credits left" value={s.credits.left} hint={`of ${s.credits.limit} this cycle`} icon="◎" tone="green" />
          <StatCard label="Used" value={s.credits.used} icon="✓" />
          <StatCard label="Held for unfinished lookups" value={s.credits.held} icon="⏳" tone="amber" />
          <StatCard label="Kept as safety margin" value={Math.ceil(s.credits.limit * 0.1)} hint={s.cycleEnd ? `Renews ${formatDate(s.cycleEnd)}` : undefined} icon="⛨" tone="slate" />
        </div>
      )}
      <KeyCard status={s} onSaved={(next) => client.setQueryData(["apollo"], next)} />
      {s.configured && (
        <div className="flex justify-end">
          <button className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? "Checking…" : "⟳ Check Apollo credits"}
          </button>
        </div>
      )}
      {refresh.error && <ErrorBox error={refresh.error} />}
      {s.configured && s.status !== "disabled" && (
        <form
          className="card space-y-3 p-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            search.mutate(1);
          }}
        >
          <h2 className="font-semibold">Find people (free)</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Job titles <span className="text-slate-500">(comma-separated)</span>
              <input className="input mt-1" placeholder="HR Manager, Purchase Manager" value={titles} onChange={(e) => setTitles(e.target.value)} />
            </label>
            <label className="text-sm">
              Location <span className="text-slate-500">(one per line or “;”)</span>
              <div className="mt-1 flex gap-2">
                <input className="input flex-1" placeholder="Noida, India; Gurugram, India" value={place} onChange={(e) => setPlace(e.target.value)} />
                <select className="input w-auto" value={placeOf} onChange={(e) => setPlaceOf(e.target.value as "company" | "person")} aria-label="Location of">
                  <option value="company">Company office</option>
                  <option value="person">Person lives</option>
                </select>
              </div>
            </label>
            <label className="text-sm">
              Company websites <span className="text-slate-500">(optional)</span>
              <input className="input mt-1" placeholder="acme.in, example.com" value={domains} onChange={(e) => setDomains(e.target.value)} />
            </label>
            <label className="text-sm">
              Keywords <span className="text-slate-500">(optional)</span>
              <input className="input mt-1" placeholder="e.g. study visa, real estate, IT services" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Seniority:</span>
            {SENIORITY.map(([v, label]) => (
              <label key={v} className="flex items-center gap-1">
                <input type="checkbox" checked={seniorities.includes(v)} onChange={(e) => setSeniorities(e.target.checked ? [...seniorities, v] : seniorities.filter((x) => x !== v))} />
                {label}
              </label>
            ))}
            <select className="input ml-auto w-auto" value={size} onChange={(e) => setSize(e.target.value)} aria-label="Company size">
              {SIZES.map(([v, label]) => (
                <option key={v} value={v}>
                  {v ? `${label} employees` : label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" disabled={search.isPending}>
            {search.isPending ? "Searching…" : "Search Apollo (free)"}
          </button>
          {search.error && <ErrorBox error={search.error} />}
        </form>
      )}
      {data && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
            <h2 className="mr-auto font-semibold">
              {data.total.toLocaleString("en-IN")} people · page {data.page} of {Math.max(1, data.pages)}
            </h2>
            <button className="btn btn-primary" disabled={reveal.isPending || picked.size === 0} onClick={() => reveal.mutate([...picked])}>
              {reveal.isPending ? "Getting emails…" : `Get emails for ${picked.size} selected (up to ${picked.size} credits)`}
            </button>
          </div>
          {reveal.error && <ErrorBox error={reveal.error} />}
          {blocked.length > 0 && <p className="px-4 pt-3 text-sm text-amber-700 dark:text-amber-300">{blocked[0]!.error ?? "Some emails could not be fetched."}</p>}
          {data.people.length === 0 ? (
            <EmptyState title="Nobody found">Try fewer or broader filters (e.g. only a job title and a country).</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all not yet revealed"
                        checked={picked.size > 0 && data.people.filter((p) => p.revealed === null).every((p) => picked.has(p.id))}
                        onChange={(e) => setPicked(new Set(e.target.checked ? data.people.filter((p) => p.revealed === null).map((p) => p.id) : []))}
                      />
                    </th>
                    <th className="px-4 py-2">Person</th>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Company</th>
                    <th className="px-4 py-2">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.people.map((p) => {
                    const r = p.revealed || null;
                    return (
                      <tr key={p.id} className="align-top">
                        <td className="px-4 py-2">
                          {p.revealed === null && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${p.firstName}`}
                              checked={picked.has(p.id)}
                              onChange={(e) => {
                                const next = new Set(picked);
                                if (e.target.checked) next.add(p.id);
                                else next.delete(p.id);
                                setPicked(next);
                              }}
                            />
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <strong>{r?.name ?? `${p.firstName} ${p.lastName ?? ""}`}</strong>
                          {r?.linkedinUrl && (
                            <a className="ml-2 text-xs text-brand-600" href={r.linkedinUrl} target="_blank" rel="noreferrer">
                              LinkedIn
                            </a>
                          )}
                          {r && (r.city || r.country) && <span className="block text-xs text-slate-500">{[r.city, r.country].filter(Boolean).join(", ")}</span>}
                        </td>
                        <td className="px-4 py-2">{r?.title ?? p.title ?? "—"}</td>
                        <td className="px-4 py-2">
                          {p.company ?? "—"}
                          {p.domain && <span className="block text-xs text-slate-500">{p.domain}</span>}
                        </td>
                        <td className="px-4 py-2">
                          {r?.email ? (
                            <>
                              <strong>{r.email}</strong>
                              {r.emailStatus && <span className="block text-xs text-slate-500">{r.emailStatus}</span>}
                            </>
                          ) : p.revealed === false || (r && !r.email) ? (
                            <span className="text-slate-500">No email with Apollo</span>
                          ) : (
                            <span className="text-xs text-slate-500">{p.hasEmail ? "Email available (1 credit)" : "Email may not be available"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
            <button className="btn" disabled={search.isPending || data.page <= 1} onClick={() => search.mutate(data.page - 1)}>
              ← Prev
            </button>
            <button className="btn" disabled={search.isPending || data.page >= data.pages} onClick={() => search.mutate(data.page + 1)}>
              Next →
            </button>
            <input className="input ml-auto w-48" placeholder="List name, e.g. HR Noida" value={listName} onChange={(e) => setListName(e.target.value)} aria-label="Contacts list name" />
            <button className="btn" disabled={toContacts.isPending || revealedIds.length === 0} onClick={() => toContacts.mutate(revealedIds)}>
              Add {revealedIds.length} revealed to Contacts
            </button>
          </div>
          {toContacts.data && <p className="px-4 pb-4 text-sm text-green-700 dark:text-green-400">{toContacts.data.sent} people sent to Contacts.</p>}
          {toContacts.error && <ErrorBox error={toContacts.error} />}
        </div>
      )}
    </div>
  );
}
