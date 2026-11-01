import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner, StatCard } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber, safeHref } from "../lib/format";
import { useIsSuperAdmin } from "../lib/me";
import { navigate, setSearchParams, useSearchParams } from "../lib/router";
import type { Contact, ContactFacets, ContactImportResult, Page } from "../lib/types";

// Contacts uploaded from a sheet: Name, LinkedIn URL, Contact Number, Email, Designation,
// Company. Used for LinkedIn message campaigns (and SMS/WhatsApp/email templates later).

const PAGE_SIZE = 50;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function UploadCard({ lists }: { lists: string[] }) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [listName, setListName] = useState("");
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file");
      if (file.size > MAX_FILE_BYTES) throw new Error("The file is larger than 10 MB");
      return api<ContactImportResult>("/contacts/import", {
        method: "POST",
        body: { fileName: file.name, data: toBase64(await file.arrayBuffer()), listName: listName.trim() || null },
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["contacts"] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    upload.mutate();
  }

  return (
    <form onSubmit={submit} className="card mb-6 space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Upload a contacts sheet</h2>
          <p className="text-sm text-slate-500">
            Columns: <strong>Name</strong>, LinkedIn URL, Instagram URL, Contact Number, Email, Designation, Company. Excel (.xlsx) or CSV. The same LinkedIn URL (or email) uploaded
            again updates that contact instead of adding a copy.
          </p>
        </div>
        <div className="flex gap-2">
          <a className="btn" href="/api/contacts/template.xlsx" download>
            ⬇ Template (.xlsx)
          </a>
          <a className="btn" href="/api/contacts/template.csv" download>
            ⬇ Template (.csv)
          </a>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="label">Sheet file</span>
          <input
            className="input"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="block space-y-1">
          <span className="label">List name (optional)</span>
          <input className="input" list="contact-lists" maxLength={100} value={listName} onChange={(e) => setListName(e.target.value)} placeholder="e.g. HR Lucknow Oct" />
          <datalist id="contact-lists">
            {lists.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <span className="block text-xs text-slate-500">Groups the contacts so a campaign can target this upload.</span>
        </label>
      </div>
      {upload.error && <ErrorBox error={upload.error} />}
      {upload.data && (
        <div className="text-sm" role="status">
          <p className="text-emerald-700 dark:text-emerald-400">
            {formatNumber(upload.data.created)} new, {formatNumber(upload.data.updated)} updated
            {upload.data.duplicatesInFile > 0 && `, ${formatNumber(upload.data.duplicatesInFile)} repeated in the file`}
            {upload.data.errors.length > 0 && `, ${formatNumber(upload.data.errors.length)} skipped`} (of {formatNumber(upload.data.total)} rows).
          </p>
          {upload.data.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-amber-700 dark:text-amber-400">
              {upload.data.errors.slice(0, 10).map((e) => (
                <li key={e.line}>
                  Row {e.line}: {e.reason}
                </li>
              ))}
              {upload.data.errors.length > 10 && <li>…and {upload.data.errors.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}
      <button className="btn btn-primary" disabled={upload.isPending}>
        {upload.isPending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}

function ContactRow({ c, selected, onToggle }: { c: Contact; selected: boolean; onToggle: () => void }) {
  const href = safeHref(c.linkedinUrl);
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <td className="px-4 py-2">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${c.name}`} />
      </td>
      <td className="px-4 py-2">
        <p className="font-medium">{c.name}</p>
        {c.designation && <p className="text-xs text-slate-500">{c.designation}</p>}
      </td>
      <td className="px-4 py-2">{c.company ?? "—"}</td>
      <td className="px-4 py-2">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:underline">
            {c.linkedinUrl!.replace("https://www.linkedin.com/in/", "in/")}
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-2">
        {safeHref(c.instagramUrl) ? (
          <a href={safeHref(c.instagramUrl)} target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:underline">
            @{c.instagramUrl!.replace("https://www.instagram.com/", "").replace(/\/$/, "")}
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-2">{c.email ?? "—"}</td>
      <td className="px-4 py-2 whitespace-nowrap">{c.phone ?? "—"}</td>
      <td className="px-4 py-2">{c.listName ?? "—"}</td>
      <td className="px-4 py-2 whitespace-nowrap text-slate-500">{formatDate(c.createdAt)}</td>
    </tr>
  );
}

export function ContactsPage() {
  const superAdmin = useIsSuperAdmin(); // LinkedIn/Instagram outreach stays with super admins
  const client = useQueryClient();
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const filters = { q: params.get("q") ?? "", listName: params.get("list") ?? "", hasLinkedIn: params.get("hasLinkedIn") ?? "", hasInstagram: params.get("hasInstagram") ?? "" };
  const [q, setQ] = useState(filters.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const facets = useQuery({ queryKey: ["contacts", "facets"], queryFn: () => api<ContactFacets>("/contacts/facets") });
  const list = useQuery({
    queryKey: ["contacts", "list", page, filters],
    queryFn: () => api<Page<Contact>>(`/contacts${qs({ page, pageSize: PAGE_SIZE, q: filters.q, listName: filters.listName, hasLinkedIn: filters.hasLinkedIn, hasInstagram: filters.hasInstagram })}`),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => api<{ deleted: number }>("/contacts/delete", { method: "POST", body: { ids } }),
    onSuccess: () => {
      setSelected(new Set());
      client.invalidateQueries({ queryKey: ["contacts"] });
    },
  });

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  const items = list.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((c) => selected.has(c.id));
  const selectedWithLinkedIn = items.filter((c) => selected.has(c.id) && c.linkedinUrl).length;

  return (
    <>
      <PageHeader
        title="Contacts (Sheets)"
        subtitle={superAdmin ? "Contacts uploaded from your own sheets. Message them on LinkedIn with the LinkedIn Messenger extension." : "Contacts uploaded from your own sheets."}
        actions={
          superAdmin && (
          <>
          <button
            className="btn"
            onClick={() =>
              navigate(
                selected.size
                  ? `/instagram-outreach/new?contactIds=${[...selected].join(",")}`
                  : `/instagram-outreach/new${filters.listName ? `?list=${encodeURIComponent(filters.listName)}` : ""}`,
              )
            }
          >
            ◎ Message on Instagram
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              navigate(
                selected.size
                  ? `/linkedin-outreach/new?contactIds=${[...selected].join(",")}`
                  : `/linkedin-outreach/new${filters.listName ? `?list=${encodeURIComponent(filters.listName)}` : ""}`,
              )
            }
          >
            in Message on LinkedIn{selected.size ? ` (${selectedWithLinkedIn} selected)` : ""}
          </button>
          </>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Contacts" value={facets.data?.total} icon="☰" />
        <StatCard label="With LinkedIn URL" value={facets.data?.withLinkedIn} icon="in" tone="green" />
        <StatCard label="With Instagram URL" value={facets.data?.withInstagram} icon="◎" tone="red" />
        <StatCard label="With email" value={facets.data?.withEmail} icon="✉" tone="amber" />
        <StatCard label="With phone" value={facets.data?.withPhone} icon="✆" tone="slate" />
      </div>

      <UploadCard lists={facets.data?.lists.map((l) => l.value) ?? []} />

      <div className="card">
        <form
          className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            setSearchParams({ q, page: null });
          }}
        >
          <label className="block flex-1 space-y-1">
            <span className="label">Search</span>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, company, email, phone…" />
          </label>
          <label className="block space-y-1">
            <span className="label">List</span>
            <select className="input" value={filters.listName} onChange={(e) => setSearchParams({ list: e.target.value, page: null })}>
              <option value="">All lists</option>
              {facets.data?.lists.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.value} ({l.count})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="label">LinkedIn URL</span>
            <select className="input" value={filters.hasLinkedIn} onChange={(e) => setSearchParams({ hasLinkedIn: e.target.value, page: null })}>
              <option value="">Any</option>
              <option value="true">Has URL</option>
              <option value="false">No URL</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="label">Instagram URL</span>
            <select className="input" value={filters.hasInstagram} onChange={(e) => setSearchParams({ hasInstagram: e.target.value, page: null })}>
              <option value="">Any</option>
              <option value="true">Has URL</option>
              <option value="false">No URL</option>
            </select>
          </label>
          <button className="btn">Search</button>
          {selected.size > 0 && (
            <ConfirmButton label={`Delete ${selected.size} selected`} confirmLabel={`Delete ${selected.size}?`} onConfirm={() => remove.mutate([...selected])} />
          )}
        </form>
        {list.isPending && <Spinner />}
        {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
        {remove.error && <div className="p-4"><ErrorBox error={remove.error} /></div>}
        {list.data?.total === 0 && <EmptyState title="No contacts yet">Download the template, fill it in and upload it above.</EmptyState>}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      aria-label="Select all on this page"
                      onChange={() => {
                        const next = new Set(selected);
                        items.forEach((c) => (allOnPage ? next.delete(c.id) : next.add(c.id)));
                        setSelected(next);
                      }}
                    />
                  </th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Company</th>
                  <th className="px-4 py-2">LinkedIn</th>
                  <th className="px-4 py-2">Instagram</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Contact number</th>
                  <th className="px-4 py-2">List</th>
                  <th className="px-4 py-2">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((c) => (
                  <ContactRow key={c.id} c={c} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setSearchParams({ page: p })} />}
      </div>
    </>
  );
}
