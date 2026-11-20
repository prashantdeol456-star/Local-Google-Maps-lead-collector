import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, ErrorBox, PageHeader, Pagination, Spinner, StatCard } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber, safeHref } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { Page } from "../lib/types";

// Businesses collected from Justdial by the Maps Data Collector extension (Justdial mode), with
// the same business's Google Maps details next to Justdial's own.

interface JustdialDetail {
  docid: string;
  jdUrl: string | null;
  jdPhone: string | null;
  jdRating: number | null;
  jdReviewCount: number | null;
  categories: string | null;
  area: string | null;
  established: string | null;
  hours: string | null;
  photos: string[];
  mapsMatched: boolean;
  mapsName: string | null;
  mapsPhone: string | null;
  mapsWebsite: string | null;
  mapsRating: number | null;
  mapsReviewCount: number | null;
  mapsUrl: string | null;
  emailCheckedAt: string | null;
}

interface JustdialLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  searchKeyword: string | null;
  source: string;
  createdAt: string;
  justdial: JustdialDetail | null;
}

interface Facets {
  total: number;
  withPhone: number;
  withEmail: number;
  withMaps: number;
  keywords: { value: string; count: number }[];
}

const PAGE_SIZE = 50;

const HAS = [
  { id: "", label: "All" },
  { id: "phone", label: "With phone" },
  { id: "email", label: "With email" },
  { id: "website", label: "With website" },
  { id: "maps", label: "Found on Google Maps" },
] as const;

function Stars({ rating, count, label }: { rating: number | null | undefined; count: number | null | undefined; label: string }) {
  if (rating == null) return <span className="text-slate-400">—</span>;
  return (
    <span title={label} className="whitespace-nowrap tabular-nums">
      ★ {rating.toFixed(1)}
      {count != null && <span className="text-xs text-slate-500"> ({formatNumber(count)})</span>}
    </span>
  );
}

export function JustdialLeadsPage() {
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const keyword = params.get("keyword") ?? "";
  const has = params.get("has") ?? "";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [photosOf, setPhotosOf] = useState<JustdialLead | null>(null);

  const filters = { keyword, has, q };
  const list = useQuery({
    queryKey: ["justdial", page, filters],
    queryFn: () => api<Page<JustdialLead>>(`/justdial/leads${qs({ page, pageSize: PAGE_SIZE, ...filters })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const facets = useQuery({ queryKey: ["justdial", "facets"], queryFn: () => api<Facets>("/justdial/facets"), refetchInterval: 30_000 });

  const items = list.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((l) => selected.has(l.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <>
      <PageHeader
        title="Justdial Leads"
        subtitle="Businesses collected from Justdial, with the same business's Google Maps details next to them."
        actions={
          <a className="btn" href={`/api/justdial/export.csv${qs(filters)}`} download>
            ⬇ Export CSV
          </a>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Businesses" value={facets.data?.total} icon="⌂" />
        <StatCard label="With phone" value={facets.data?.withPhone} icon="✆" tone="green" />
        <StatCard label="With email" value={facets.data?.withEmail} icon="✉" tone="slate" />
        <StatCard label="Found on Google Maps" value={facets.data?.withMaps} icon="⌖" tone="red" />
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        How to collect: open the <strong>Maps Data Collector</strong> side panel, choose <em>Justdial</em>, type a keyword and a city, and press{" "}
        <em>START</em>. It runs in a tab behind yours: the Justdial list page by page, each business page, and the same business on Google Maps. Emails are
        looked up on each business's own website afterwards. To send emails, select rows and press <em>Email campaign</em>, or choose a template in the
        side panel so it happens by itself.
      </div>

      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="flex flex-wrap gap-1">
            {HAS.map((h) => (
              <button key={h.id || "all"} className={`btn px-3 py-1 text-sm ${has === h.id ? "btn-primary" : ""}`} onClick={() => setSearchParams({ has: h.id, page: null })}>
                {h.label}
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
            <input className="input" placeholder="Name, phone, email, address, category…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
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
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-brand-50/60 px-4 py-2 text-sm dark:border-slate-800 dark:bg-brand-700/10">
            <span>{selected.size} selected</span>
            <Link className="btn btn-primary" to={`/email/new?leadIds=${[...selected].join(",")}`}>
              ✉ Email campaign
            </Link>
            <Link className="btn btn-primary" to={`/whatsapp/new?leadIds=${[...selected].join(",")}`}>
              ✆ WhatsApp campaign
            </Link>
            <button className="btn" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {list.isPending && <Spinner />}
        {list.error && (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        )}
        {list.data?.total === 0 && <EmptyState title="No Justdial leads yet">Choose Justdial in the Maps Data Collector side panel and start a search.</EmptyState>}

        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allOnPage}
                      onChange={() => {
                        const next = new Set(selected);
                        for (const l of items) allOnPage ? next.delete(l.id) : next.add(l.id);
                        setSelected(next);
                      }}
                    />
                  </th>
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email / website</th>
                  <th className="px-3 py-2">Address</th>
                  <th className="px-3 py-2">Justdial</th>
                  <th className="px-3 py-2">Google Maps</th>
                  <th className="px-3 py-2">Photos</th>
                  <th className="px-3 py-2">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((l) => {
                  const d = l.justdial;
                  return (
                    <tr key={l.id} className="align-top">
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                      </td>
                      <td className="max-w-64 px-3 py-2">
                        <p className="font-medium">{l.name}</p>
                        {d?.categories && <p className="text-xs text-slate-500">{d.categories}</p>}
                        <p className="text-xs text-slate-500">
                          {[d?.area, d?.established && `since ${d.established}`, d?.hours].filter(Boolean).join(" · ")}
                        </p>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <p className="tabular-nums">{l.phone ?? "—"}</p>
                        {d?.jdPhone && d.jdPhone !== l.phone && <p className="text-xs text-slate-500" title="Number shown by Justdial (often a Justdial virtual number)">JD: {d.jdPhone}</p>}
                      </td>
                      <td className="max-w-56 px-3 py-2">
                        <p className="truncate">{l.email ?? (d?.emailCheckedAt ? "—" : <span className="text-xs text-slate-400">checking website…</span>)}</p>
                        {l.website && (
                          <a href={safeHref(l.website)} target="_blank" rel="noreferrer" className="block truncate text-xs text-brand-600 hover:underline">
                            {l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                          </a>
                        )}
                      </td>
                      <td className="max-w-64 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                        {l.address ?? "—"}
                        {(l.city || l.postalCode) && <p className="text-slate-500">{[l.city, l.state, l.postalCode].filter(Boolean).join(", ")}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Stars rating={d?.jdRating} count={d?.jdReviewCount} label="Justdial rating (ratings)" />
                        {d?.jdUrl && (
                          <a href={safeHref(d.jdUrl)} target="_blank" rel="noreferrer" className="block text-xs text-brand-600 hover:underline">
                            Open on Justdial
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {d?.mapsMatched ? (
                          <>
                            <Stars rating={d.mapsRating} count={d.mapsReviewCount} label="Google Maps rating (reviews)" />
                            {d.mapsName && d.mapsName.toLowerCase() !== l.name.toLowerCase() && <p className="text-xs text-slate-500">as “{d.mapsName}”</p>}
                            {d.mapsUrl && (
                              <a href={safeHref(d.mapsUrl)} target="_blank" rel="noreferrer" className="block text-xs text-brand-600 hover:underline">
                                Open on Maps
                              </a>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">not found</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {d && d.photos.length > 0 ? (
                          <button className="flex items-center gap-2 text-xs text-brand-600 hover:underline" onClick={() => setPhotosOf(l)}>
                            <img src={d.photos[0]} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-10 w-10 rounded object-cover" />
                            {d.photos.length}
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500" title={formatDate(l.createdAt)}>
                        {formatDate(l.createdAt)}
                        {l.searchKeyword && <p>{l.searchKeyword}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setSearchParams({ page: p })} />}
      </div>

      {photosOf?.justdial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label={`Photos of ${photosOf.name}`} onClick={() => setPhotosOf(null)}>
          <div className="card max-h-[85vh] w-full max-w-3xl overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">{photosOf.name}</h2>
              <button className="btn" onClick={() => setPhotosOf(null)}>
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {photosOf.justdial.photos.map((src) => (
                <a key={src} href={safeHref(src)} target="_blank" rel="noreferrer">
                  <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full rounded object-cover" />
                </a>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Photos stay on Justdial; only their links are saved.</p>
          </div>
        </div>
      )}
    </>
  );
}
