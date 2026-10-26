import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner, StatCard } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber, safeHref } from "../lib/format";
import { Link, navigate, setSearchParams, useSearchParams } from "../lib/router";
import type { LinkedInFacets, LinkedInImportResult, LinkedInLead, LinkedInLeadPage } from "../lib/types";

// LinkedIn leads: profiles saved with the LinkedIn Helper extension or imported from
// LinkedIn's Connections.csv. Separate from Google Maps leads.

const PAGE_SIZE = 50;

const SOURCE_LABEL: Record<string, string> = { extension: "Extension", csv: "CSV import", admin: "Admin" };

function ImportCard({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [tag, setTag] = useState("");
  const run = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a CSV file");
      if (file.size > 10 * 1024 * 1024) throw new Error("The file is larger than 10 MB");
      return api<LinkedInImportResult>("/linkedin/import", { method: "POST", body: { csv: await file.text(), tag: tag.trim() || null } });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["linkedin"] }),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    run.mutate();
  }
  return (
    <form onSubmit={submit} className="card mb-6 space-y-4 p-5">
      <div>
        <h2 className="font-medium">Import LinkedIn connections (CSV)</h2>
        <p className="text-sm text-slate-500">
          LinkedIn → Settings → Data privacy → <em>Get a copy of your data</em> → Connections. Upload the <code>Connections.csv</code> from the download. A file
          exported from this page works too. Existing profiles are updated, not duplicated.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="label">CSV file</span>
          <input className="input" type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="block space-y-1">
          <span className="label">Tag (optional)</span>
          <input className="input" maxLength={100} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. My connections" />
        </label>
      </div>
      {run.error && <ErrorBox error={run.error} />}
      {run.data && (
        <div className="text-sm" role="status">
          <p className="text-emerald-700 dark:text-emerald-400">
            {formatNumber(run.data.created)} new, {formatNumber(run.data.updated)} updated, {formatNumber(run.data.skipped)} skipped (of {formatNumber(run.data.total)} rows).
          </p>
          {run.data.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-amber-700 dark:text-amber-400">
              {run.data.errors.slice(0, 10).map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.reason}
                </li>
              ))}
              {run.data.errors.length > 10 && <li>…</li>}
            </ul>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={run.isPending}>
          {run.isPending ? "Importing…" : "Import"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

function contactSummary(l: LinkedInLead) {
  return [...l.emails, ...l.phones].slice(0, 2).join(" · ");
}

export function LinkedInLeadsPage() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const company = params.get("company") ?? "";
  const tag = params.get("tag") ?? "";
  const source = params.get("source") ?? "";
  const hasEmail = params.get("hasEmail") ?? "";
  const hasPhone = params.get("hasPhone") ?? "";
  const hasWebsite = params.get("hasWebsite") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [search, setSearch] = useState(q);
  const [companyInput, setCompanyInput] = useState(company);
  const [importing, setImporting] = useState(false);

  const filters = { q, company, tag, source, hasEmail, hasPhone, hasWebsite };
  const list = useQuery({
    queryKey: ["linkedin", "list", filters, page],
    queryFn: () => api<LinkedInLeadPage>(`/linkedin/leads${qs({ ...filters, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000, // new saves from the extension show up without a reload
  });
  const facets = useQuery({ queryKey: ["linkedin", "facets"], queryFn: () => api<LinkedInFacets>("/linkedin/facets"), refetchInterval: 15_000 });
  const filtered = Object.values(filters).some(Boolean);

  const select = (name: string, value: string, options: [string, string][], label: string) => (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => setSearchParams({ [name]: e.target.value || null, page: null })}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <PageHeader
        title="LinkedIn Leads"
        subtitle="Profiles you saved with the LinkedIn Helper extension or imported from LinkedIn. Kept separate from Google Maps leads."
        actions={
          <>
            {!importing && (
              <button className="btn" onClick={() => setImporting(true)}>
                Import CSV
              </button>
            )}
            <a className="btn btn-primary" href={`/api/linkedin/export.csv${qs(filters)}`} download title={filtered ? "Exports all profiles matching the filters" : "Exports all profiles"}>
              Export CSV{filtered ? " (filtered)" : ""}
            </a>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="LinkedIn profiles" value={facets.data?.total} icon="in" />
        <StatCard label="With email" value={facets.data?.withEmail} icon="✉" tone="green" />
        <StatCard label="With phone" value={facets.data?.withPhone} icon="✆" tone="amber" />
        <StatCard label="With website" value={facets.data?.withWebsite} icon="🌐" tone="slate" />
      </div>

      {importing && <ImportCard onDone={() => setImporting(false)} />}

      <div className="card">
        <div className="grid gap-3 border-b border-slate-200 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6 dark:border-slate-800">
          <form
            className="sm:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearchParams({ q: search.trim() || null, page: null });
            }}
          >
            <label className="block space-y-1">
              <span className="label">Search</span>
              <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, headline, email, phone, experience, school…" />
            </label>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearchParams({ company: companyInput.trim() || null, page: null });
            }}
          >
            <label className="block space-y-1">
              <span className="label">Company</span>
              <input className="input" type="search" list="linkedin-companies" value={companyInput} onChange={(e) => setCompanyInput(e.target.value)} placeholder="Any" />
              <datalist id="linkedin-companies">
                {facets.data?.companies.map((c) => <option key={c.value} value={c.value} />)}
              </datalist>
            </label>
          </form>
          {select("tag", tag, [["", "All tags"], ...(facets.data?.tags.map((t) => [t.value, `${t.value} (${t.count})`] as [string, string]) ?? [])], "Tag")}
          {select("hasEmail", hasEmail, [["", "Any"], ["true", "Has email"], ["false", "No email"]], "Email")}
          {select("hasPhone", hasPhone, [["", "Any"], ["true", "Has phone"], ["false", "No phone"]], "Phone")}
          {select("hasWebsite", hasWebsite, [["", "Any"], ["true", "Has website"], ["false", "No website"]], "Website")}
          {select("source", source, [["", "All sources"], ["extension", "Extension"], ["csv", "CSV import"], ["admin", "Admin"]], "Source")}
          {filtered && (
            <div className="flex items-end">
              <button
                className="btn"
                onClick={() => {
                  setSearch("");
                  setCompanyInput("");
                  setSearchParams({ q: null, company: null, tag: null, source: null, hasEmail: null, hasPhone: null, hasWebsite: null, page: null });
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {list.isPending && <Spinner />}
        {list.error && (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        )}
        {list.data?.items.length === 0 && (
          <EmptyState title={filtered ? "No matches" : "No LinkedIn profiles yet"}>
            {filtered ? "Try other filters." : "Save profiles with the LinkedIn Helper extension, or import your Connections.csv."}
          </EmptyState>
        )}
        {!!list.data?.items.length && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Headline / company</th>
                  <th className="th">Contact</th>
                  <th className="th">Tag</th>
                  <th className="th">Saved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.data.items.map((l) => (
                  <tr key={l.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/40" onClick={() => navigate(`/linkedin/${l.id}`)}>
                    <td className="td font-medium">
                      <Link to={`/linkedin/${l.id}`} className="hover:text-brand-600" onClick={(e) => e.stopPropagation()}>
                        {l.name}
                      </Link>
                      {l.location && <p className="text-xs font-normal text-slate-500">{l.location}</p>}
                    </td>
                    <td className="td max-w-xs">
                      <p className="truncate">{l.headline ?? "—"}</p>
                      {l.company && <p className="truncate text-xs text-slate-500">{l.company}</p>}
                    </td>
                    <td className="td text-sm">{contactSummary(l) || <span className="text-slate-400">—</span>}</td>
                    <td className="td text-sm">{l.tag ?? "—"}</td>
                    <td className="td whitespace-nowrap text-sm text-slate-500">
                      {formatDate(l.createdAt)}
                      <p className="text-xs">{SOURCE_LABEL[l.source] ?? l.source}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > PAGE_SIZE && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />
        )}
      </div>
    </>
  );
}

const lines = (v: string) =>
  v
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** "fixtra.in (Company)" ⇄ { url, label } */
function parseWebsite(line: string) {
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(line);
  return m ? { url: m[1]!, label: m[2]! } : { url: line, label: null };
}

/** Experience/education are edited one entry per line, parts separated by " | ". */
const joinParts = (parts: (string | null)[]) => parts.map((p) => p ?? "").join(" | ").replace(/( \| )+$/, "");
const splitParts = (line: string) => line.split("|").map((p) => p.trim() || null);

function parseExperience(text: string): LinkedInLead["experience"] {
  return lines(text)
    .map(splitParts)
    .map(([title, company, employmentType, dates, location]) => ({ title: title ?? "", company: company ?? null, employmentType: employmentType ?? null, dates: dates ?? null, location: location ?? null }))
    .filter((e) => e.title);
}

function parseEducation(text: string): LinkedInLead["education"] {
  return lines(text)
    .map(splitParts)
    .map(([school, degree, dates]) => ({ school: school ?? "", degree: degree ?? null, dates: dates ?? null }))
    .filter((e) => e.school);
}

function EditForm({ lead, onDone }: { lead: LinkedInLead; onDone: () => void }) {
  const client = useQueryClient();
  const [f, setF] = useState({
    name: lead.name,
    headline: lead.headline ?? "",
    company: lead.company ?? "",
    location: lead.location ?? "",
    emails: lead.emails.join("\n"),
    phones: lead.phones.join("\n"),
    websites: lead.websites.map((w) => (w.label ? `${w.url} (${w.label})` : w.url)).join("\n"),
    ims: lead.ims.join("\n"),
    experience: lead.experience.map((e) => joinParts([e.title, e.company, e.employmentType, e.dates, e.location])).join("\n"),
    education: lead.education.map((e) => joinParts([e.school, e.degree, e.dates])).join("\n"),
    birthday: lead.birthday ?? "",
    address: lead.address ?? "",
    connectedSince: lead.connectedSince ?? "",
    tag: lead.tag ?? "",
    notes: lead.notes ?? "",
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/linkedin/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        body: {
          ...f,
          emails: lines(f.emails),
          phones: lines(f.phones),
          websites: lines(f.websites).map(parseWebsite),
          ims: lines(f.ims),
          experience: parseExperience(f.experience),
          education: parseEducation(f.education),
        },
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["linkedin"] });
      onDone();
    },
  });
  const field = (key: keyof typeof f, label: string, opts: { multi?: boolean; hint?: string } = {}) => (
    <label className="block space-y-1">
      <span className="label">
        {label}
        {opts.hint && <span className="ml-1 font-normal text-slate-400">{opts.hint}</span>}
      </span>
      {opts.multi ? (
        <textarea className="input min-h-20 text-sm" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
      ) : (
        <input className="input" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} required={key === "name"} />
      )}
    </label>
  );
  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field("name", "Name")}
        {field("headline", "Headline / designation")}
        {field("company", "Company")}
        {field("location", "Location")}
        {field("emails", "Emails", { multi: true, hint: "one per line" })}
        {field("phones", "Phones", { multi: true, hint: "one per line" })}
        {field("websites", "Websites", { multi: true, hint: "one per line, e.g. fixtra.in (Company)" })}
        {field("ims", "IM", { multi: true, hint: "one per line" })}
        {field("experience", "Experience", { multi: true, hint: "Title | Company | Type | Dates | Location" })}
        {field("education", "Education", { multi: true, hint: "School | Degree | Dates" })}
        {field("birthday", "Birthday")}
        {field("connectedSince", "Connected since")}
        {field("address", "Address")}
        {field("tag", "Tag")}
      </div>
      {field("notes", "Notes", { multi: true })}
      {save.error && <ErrorBox error={save.error} />}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2 break-words">{!children || (Array.isArray(children) && children.length === 0) ? <span className="text-slate-400">—</span> : children}</dd>
    </div>
  );
}

export function LinkedInLeadDetailPage({ id }: { id: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const query = useQuery({ queryKey: ["linkedin", "lead", id], queryFn: () => api<{ lead: LinkedInLead }>(`/linkedin/leads/${encodeURIComponent(id)}`) });
  const remove = useMutation({
    mutationFn: () => api(`/linkedin/leads/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["linkedin"] });
      navigate("/linkedin");
    },
  });

  if (query.isPending) return <Spinner />;
  if (query.error) return <ErrorBox error={query.error} />;
  const l = query.data.lead;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/linkedin" className="text-slate-500 hover:text-brand-600">
          ← LinkedIn Leads
        </Link>
      </p>
      <PageHeader
        title={l.name}
        subtitle={[l.headline, l.company].filter(Boolean).join(" · ") || undefined}
        actions={
          !editing && (
            <>
              <a className="btn" href={safeHref(l.profileUrl)} target="_blank" rel="noopener noreferrer">
                Open on LinkedIn ↗
              </a>
              <button className="btn btn-primary" onClick={() => setEditing(true)}>
                Edit
              </button>
              <ConfirmButton label="Delete" confirmLabel="Delete profile?" onConfirm={() => remove.mutate()} disabled={remove.isPending} />
            </>
          )
        }
      />
      {remove.error && <ErrorBox error={remove.error} />}
      {editing ? (
        <EditForm lead={l} onDone={() => setEditing(false)} />
      ) : (
        <div className="card p-5">
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            <Row label="Profile">
              <a className="text-brand-600 hover:underline" href={safeHref(l.profileUrl)} target="_blank" rel="noopener noreferrer">
                {l.profileUrl.replace(/^https:\/\/www\./, "")}
              </a>
            </Row>
            <Row label="Emails">
              {l.emails.map((e) => (
                <div key={e}>
                  <a className="hover:text-brand-600" href={`mailto:${e}`}>
                    {e}
                  </a>
                </div>
              ))}
            </Row>
            <Row label="Phones">
              {l.phones.map((p) => (
                <div key={p}>{p}</div>
              ))}
            </Row>
            <Row label="Websites">
              {l.websites.map((w) => {
                const href = safeHref(/^https?:\/\//i.test(w.url) ? w.url : `https://${w.url}`);
                return (
                  <div key={w.url}>
                    {href ? (
                      <a className="hover:text-brand-600" href={href} target="_blank" rel="noopener noreferrer">
                        {w.url}
                      </a>
                    ) : (
                      w.url
                    )}
                    {w.label && <span className="text-slate-500"> ({w.label})</span>}
                  </div>
                );
              })}
            </Row>
            <Row label="IM">
              {l.ims.map((s) => (
                <div key={s}>{s}</div>
              ))}
            </Row>
            <Row label="Experience">
              {l.experience.map((e, i) => (
                <div key={i} className="mb-2 last:mb-0">
                  <p className="font-medium">{e.title}</p>
                  <p className="text-slate-500">{[e.company, e.employmentType].filter(Boolean).join(" · ")}</p>
                  <p className="text-xs text-slate-500">{[e.dates, e.location].filter(Boolean).join(" · ")}</p>
                </div>
              ))}
            </Row>
            <Row label="Education">
              {l.education.map((e, i) => (
                <div key={i} className="mb-2 last:mb-0">
                  <p className="font-medium">{e.school}</p>
                  <p className="text-slate-500">{[e.degree, e.dates].filter(Boolean).join(" · ")}</p>
                </div>
              ))}
            </Row>
            <Row label="Location">{l.location}</Row>
            <Row label="Address">{l.address}</Row>
            <Row label="Birthday">{l.birthday}</Row>
            <Row label="Connected since">{l.connectedSince}</Row>
            <Row label="Tag">{l.tag}</Row>
            <Row label="Notes">{l.notes && <span className="whitespace-pre-wrap">{l.notes}</span>}</Row>
            <Row label="Saved">
              {formatDate(l.createdAt)} · {SOURCE_LABEL[l.source] ?? l.source}
              {l.updatedAt !== l.createdAt && <span className="text-slate-500"> · updated {formatDate(l.updatedAt)}</span>}
            </Row>
          </dl>
        </div>
      )}
    </>
  );
}
