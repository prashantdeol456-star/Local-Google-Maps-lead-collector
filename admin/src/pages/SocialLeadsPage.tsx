import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner, StatCard } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber, safeHref } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { Page } from "../lib/types";

// Instagram profiles, Facebook Pages, groups and profiles saved with the Meta Helper extension
// from keyword searches. Public details only; group member lists are never collected.

interface SocialLead {
  id: string;
  platform: "instagram" | "facebook";
  kind: "profile" | "page" | "group";
  url: string;
  handle: string | null;
  name: string;
  bio: string | null;
  category: string | null;
  followers: number | null;
  audienceText: string | null;
  privacy: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  keyword: string | null;
  tag: string | null;
  createdAt: string;
}

interface Facets {
  total: number;
  kinds: { platform: string; kind: string; count: number }[];
  keywords: { value: string; count: number }[];
  tags: { value: string; count: number }[];
}

const PAGE_SIZE = 50;

const TYPES = [
  { id: "", label: "All", platform: "", kind: "" },
  { id: "ig", label: "Instagram profiles", platform: "instagram", kind: "profile" },
  { id: "fbpage", label: "Facebook Pages", platform: "facebook", kind: "page" },
  { id: "fbgroup", label: "Facebook groups", platform: "facebook", kind: "group" },
  { id: "fbprofile", label: "Facebook people", platform: "facebook", kind: "profile" },
] as const;

const KIND_LABEL = (l: Pick<SocialLead, "platform" | "kind">) =>
  l.platform === "instagram" ? "Instagram" : l.kind === "page" ? "FB Page" : l.kind === "group" ? "FB group" : "FB profile";

export function SocialLeadsPage() {
  const client = useQueryClient();
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const type = TYPES.find((t) => t.id === (params.get("type") ?? "")) ?? TYPES[0];
  const keyword = params.get("keyword") ?? "";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listName, setListName] = useState("");

  const filters = { platform: type.platform, kind: type.kind, keyword, q };
  const list = useQuery({
    queryKey: ["social-leads", page, filters],
    queryFn: () => api<Page<SocialLead>>(`/social-leads${qs({ page, pageSize: PAGE_SIZE, ...filters })}`),
    placeholderData: keepPreviousData,
  });
  const facets = useQuery({ queryKey: ["social-leads", "facets"], queryFn: () => api<Facets>("/social-leads/facets") });
  const count = (platform: string, kind: string) => facets.data?.kinds.find((k) => k.platform === platform && k.kind === kind)?.count;

  const remove = useMutation({
    mutationFn: (ids: string[]) => api("/social-leads/delete", { method: "POST", body: { ids } }),
    onSuccess: () => {
      setSelected(new Set());
      client.invalidateQueries({ queryKey: ["social-leads"] });
    },
  });
  const toContacts = useMutation({
    mutationFn: (ids: string[]) => api<{ added: number; alreadyContacts: number }>("/social-leads/to-contacts", { method: "POST", body: { ids, listName: listName.trim() || null } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["contacts"] }),
  });

  const items = list.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((l) => selected.has(l.id));
  const selectedIg = items.filter((l) => selected.has(l.id) && l.platform === "instagram").map((l) => l.id);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <>
      <PageHeader
        title="Social Leads"
        subtitle="Instagram profiles and Facebook Pages, groups and people saved with the Meta Helper extension from your keyword searches."
        actions={
          <a className="btn" href={`/api/social-leads/export.csv${qs(filters)}`} download>
            ⬇ Export CSV
          </a>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Instagram profiles" value={facets.data ? (count("instagram", "profile") ?? 0) : undefined} icon="◎" tone="red" />
        <StatCard label="Facebook Pages" value={facets.data ? (count("facebook", "page") ?? 0) : undefined} icon="f" />
        <StatCard label="Facebook groups" value={facets.data ? (count("facebook", "group") ?? 0) : undefined} icon="⧉" tone="green" />
        <StatCard label="Facebook people" value={facets.data ? (count("facebook", "profile") ?? 0) : undefined} icon="☺" tone="slate" />
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        How to collect: build and load the <strong>Meta Helper</strong> extension (<code>npm run build:meta</code>, then <code>meta-helper/dist</code> in{" "}
        <code>chrome://extensions</code>). In its side panel choose what to search, type a keyword, press <em>Search</em>, then <em>Add all on this page</em>. To
        message Instagram profiles, select them here and press <em>Add to contacts</em>, then create a campaign under{" "}
        <Link to="/instagram-outreach" className="text-brand-600 hover:underline">
          Instagram Outreach
        </Link>
        .
      </div>

      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="flex flex-wrap gap-1">
            {TYPES.map((t) => (
              <button key={t.id || "all"} className={`btn px-3 py-1 text-sm ${type.id === t.id ? "btn-primary" : ""}`} onClick={() => setSearchParams({ type: t.id, page: null })}>
                {t.label}
              </button>
            ))}
          </div>
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearchParams({ q: search, page: null });
            }}
          >
            <input className="input" placeholder="Name, username, bio, category…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
            <button className="btn">Search</button>
          </form>
          <select className="input w-auto" value={keyword} onChange={(e) => setSearchParams({ keyword: e.target.value, page: null })} aria-label="Keyword">
            <option value="">All keywords</option>
            {facets.data?.keywords.map((k) => (
              <option key={k.value} value={k.value}>
                {k.value} ({k.count})
              </option>
            ))}
          </select>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-brand-50/50 p-3 text-sm dark:border-slate-800 dark:bg-brand-700/10">
            <span>{selected.size} selected</span>
            {selectedIg.length > 0 && (
              <>
                <input className="input w-48 py-1" placeholder="Contact list name (optional)" value={listName} onChange={(e) => setListName(e.target.value)} />
                <button className="btn btn-primary" disabled={toContacts.isPending} onClick={() => toContacts.mutate(selectedIg)}>
                  Add {selectedIg.length} Instagram profile{selectedIg.length === 1 ? "" : "s"} to contacts
                </button>
              </>
            )}
            <ConfirmButton label="Delete selected" className="btn btn-danger" onConfirm={() => remove.mutate([...selected])} />
            {toContacts.data && (
              <span className="text-emerald-700 dark:text-emerald-400">
                Added {toContacts.data.added} to contacts{toContacts.data.alreadyContacts ? ` (${toContacts.data.alreadyContacts} were already contacts)` : ""}.{" "}
                <Link to="/instagram-outreach/new" className="underline">
                  Create an Instagram campaign
                </Link>
              </span>
            )}
          </div>
        )}
        {toContacts.error && <div className="p-3"><ErrorBox error={toContacts.error} /></div>}

        {list.isPending && <Spinner />}
        {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
        {list.data?.total === 0 && <EmptyState title="Nothing saved yet">Use the Meta Helper extension to search and save profiles, Pages and groups.</EmptyState>}
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
                        items.forEach((l) => (allOnPage ? next.delete(l.id) : next.add(l.id)));
                        setSelected(next);
                      }}
                    />
                  </th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Followers / members</th>
                  <th className="px-4 py-2">Details</th>
                  <th className="px-4 py-2">Keyword</th>
                  <th className="px-4 py-2">Saved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((l) => (
                  <tr key={l.id} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} />
                    </td>
                    <td className="px-4 py-2">
                      <a href={safeHref(l.url)} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-600 hover:underline">
                        {l.name}
                      </a>
                      {l.handle && <p className="text-xs text-slate-500">@{l.handle}</p>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {KIND_LABEL(l)}
                      {l.privacy && <span className="ml-1 text-xs text-slate-500">({l.privacy})</span>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{l.audienceText ?? (l.followers !== null ? formatNumber(l.followers) : "—")}</td>
                    <td className="max-w-md px-4 py-2 text-xs text-slate-600 dark:text-slate-300">
                      {[l.category, l.location, l.email, l.phone].filter(Boolean).join(" · ")}
                      {l.bio && <p className="line-clamp-2 text-slate-500">{l.bio}</p>}
                      {l.website && (
                        <a href={safeHref(l.website)} target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:underline">
                          {l.website.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">{l.keyword ?? "—"}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-500">{formatDate(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setSearchParams({ page: p })} />}
      </div>
    </>
  );
}
