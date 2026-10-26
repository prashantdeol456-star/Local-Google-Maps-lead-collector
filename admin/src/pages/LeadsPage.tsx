import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatNumber, hostOf, safeHref } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { Facets, Lead, Page } from "../lib/types";

const SORTABLE = ["name", "category", "city", "rating", "reviewCount", "createdAt"] as const;
type SortField = (typeof SORTABLE)[number];
const PAGE_SIZES = [25, 50, 100];

function SortHeader({ field, label, sort, order }: { field: SortField; label: string; sort: string; order: string }) {
  const active = sort === field;
  const next = active && order === "desc" ? "asc" : "desc";
  return (
    <th className="th" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined}>
      <button className="inline-flex items-center gap-1 uppercase hover:text-slate-800 dark:hover:text-white" onClick={() => setSearchParams({ sort: field, order: next, page: null })}>
        {label}
        <span className={active ? "text-brand-600" : "text-slate-300 dark:text-slate-600"}>{active && order === "asc" ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}

function FacetSelect({ label, param, value, options }: { label: string; param: string; value: string; options: { value: string; count: number }[] | undefined }) {
  return (
    <select className="input w-auto min-w-36" aria-label={label} value={value} onChange={(e) => setSearchParams({ [param]: e.target.value, page: null })}>
      <option value="">All {label.toLowerCase()}</option>
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value} ({o.count})
        </option>
      ))}
      {/* Keep a value from the URL selectable even if it is no longer a facet */}
      {value && !options?.some((o) => o.value === value) && <option value={value}>{value}</option>}
    </select>
  );
}

/** Filters beyond search and the dropdowns, kept in the URL so links and exports keep them. */
const EXTRA_FILTERS = ["hasPhone", "hasEmail", "hasWebsite", "minRating", "minReviews", "from", "to"] as const;
const FILTER_PARAMS = ["q", "city", "state", "category", "keyword", ...EXTRA_FILTERS] as const;

function YesNoSelect({ label, param, value }: { label: string; param: string; value: string }) {
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <select className="input w-auto min-w-32" value={value} onChange={(e) => setSearchParams({ [param]: e.target.value, page: null })}>
        <option value="">Any</option>
        <option value="yes">Has {label.toLowerCase()}</option>
        <option value="no">No {label.toLowerCase()}</option>
      </select>
    </label>
  );
}

export function LeadsPage() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const city = params.get("city") ?? "";
  const category = params.get("category") ?? "";
  const keyword = params.get("keyword") ?? "";
  const state = params.get("state") ?? "";
  const extra = Object.fromEntries(EXTRA_FILTERS.map((k) => [k, params.get(k) ?? ""])) as Record<(typeof EXTRA_FILTERS)[number], string>;
  const extraCount = EXTRA_FILTERS.filter((k) => extra[k]).length;
  const [showMore, setShowMore] = useState(extraCount > 0);
  const sort = (SORTABLE as readonly string[]).includes(params.get("sort") ?? "") ? params.get("sort")! : "createdAt";
  const order = params.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = PAGE_SIZES.includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 25;

  // Search box updates the URL after the user stops typing.
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setSearchParams({ q: search.trim(), page: null }), 300);
    return () => clearTimeout(t);
  }, [search, q]);

  const filters = { q, city, state, category, keyword, ...extra };
  const query = qs({ ...filters, sort, order, page, pageSize });
  const leads = useQuery({
    queryKey: ["leads", query],
    queryFn: () => api<Page<Lead>>(`/leads${query}`),
    placeholderData: keepPreviousData,
  });
  const facets = useQuery({ queryKey: ["facets"], queryFn: () => api<Facets>("/leads/facets") });

  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/leads/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["leads"] }),
  });

  const filtered = Object.values(filters).some(Boolean);

  // Row selection for "export selected"; cleared whenever the list changes.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [query]);
  const pageIds = leads.data?.items.map((l) => l.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const exportFiltered = qs({ ...filters, sort, order });
  const exportSelected = qs({ ids: [...selected].join(",") });

  return (
    <>
      <PageHeader
        title="Google Maps Leads"
        subtitle={leads.data ? `${formatNumber(leads.data.total)} ${filtered ? "matching" : "total"}` : " "}
        actions={
          selected.size > 0 ? (
            <>
              <span className="self-center text-sm text-slate-500">{selected.size} selected</span>
              <a className="btn btn-primary" href={`/api/export/csv${exportSelected}`} download>
                Export selected CSV
              </a>
              <a className="btn btn-primary" href={`/api/export/xlsx${exportSelected}`} download>
                Export selected XLSX
              </a>
              <Link className="btn btn-primary" to={`/email/new?leadIds=${[...selected].join(",")}`}>
                ✉ Email selected
              </Link>
              <Link className="btn btn-primary" to={`/whatsapp/new?leadIds=${[...selected].join(",")}`}>
                ✆ WhatsApp selected
              </Link>
              <button className="btn" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </>
          ) : (
            <>
              <a className="btn" href={`/api/export/csv${exportFiltered}`} download title={filtered ? "Exports all leads matching the filters" : "Exports all leads"}>
                ⬇ Export CSV
              </a>
              <a className="btn" href={`/api/export/xlsx${exportFiltered}`} download title={filtered ? "Exports all leads matching the filters" : "Exports all leads"}>
                ⬇ Export XLSX
              </a>
            </>
          )
        }
      />

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <input
            className="input max-w-xs"
            type="search"
            placeholder="Search name, phone, website, address…"
            aria-label="Search leads"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <FacetSelect label="Cities" param="city" value={city} options={facets.data?.cities} />
          <FacetSelect label="States" param="state" value={state} options={facets.data?.states} />
          <FacetSelect label="Categories" param="category" value={category} options={facets.data?.categories} />
          <FacetSelect label="Keywords" param="keyword" value={keyword} options={facets.data?.keywords} />
          <button className={`btn ${extraCount ? "btn-primary" : ""}`} aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
            ⚙ More filters{extraCount ? ` (${extraCount})` : ""}
          </button>
          {filtered && (
            <button className="btn" onClick={() => setSearchParams({ ...Object.fromEntries(FILTER_PARAMS.map((k) => [k, null])), page: null })}>
              Clear filters
            </button>
          )}
          <select
            className="input ml-auto w-auto"
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => setSearchParams({ pageSize: e.target.value, page: null })}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>

        {showMore && (
          <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <YesNoSelect label="Phone" param="hasPhone" value={extra.hasPhone} />
            <YesNoSelect label="Email" param="hasEmail" value={extra.hasEmail} />
            <YesNoSelect label="Website" param="hasWebsite" value={extra.hasWebsite} />
            <label className="block space-y-1">
              <span className="label">Rating</span>
              <select className="input w-auto min-w-28" value={extra.minRating} onChange={(e) => setSearchParams({ minRating: e.target.value, page: null })}>
                <option value="">Any</option>
                {["3", "3.5", "4", "4.5"].map((r) => (
                  <option key={r} value={r}>
                    ★ {r}+
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="label">Min. reviews</span>
              <input
                className="input w-28"
                type="number"
                min={0}
                placeholder="Any"
                defaultValue={extra.minReviews}
                key={extra.minReviews}
                onBlur={(e) => setSearchParams({ minReviews: e.target.value.trim(), page: null })}
                onKeyDown={(e) => e.key === "Enter" && setSearchParams({ minReviews: e.currentTarget.value.trim(), page: null })}
              />
            </label>
            <label className="block space-y-1">
              <span className="label">Added from</span>
              <input className="input w-auto" type="date" value={extra.from} max={extra.to || undefined} onChange={(e) => setSearchParams({ from: e.target.value, page: null })} />
            </label>
            <label className="block space-y-1">
              <span className="label">Added to</span>
              <input className="input w-auto" type="date" value={extra.to} min={extra.from || undefined} onChange={(e) => setSearchParams({ to: e.target.value, page: null })} />
            </label>
            <p className="basis-full text-xs text-slate-500">Exports use the same filters.</p>
          </div>
        )}

        {leads.error && (
          <div className="p-4">
            <ErrorBox error={leads.error} />
          </div>
        )}
        {remove.error && (
          <div className="p-4">
            <ErrorBox error={remove.error} />
          </div>
        )}
        {leads.isPending && <Spinner />}

        {leads.data && leads.data.items.length === 0 && (
          <EmptyState title={filtered ? "No leads match these filters" : "No leads yet"}>
            {!filtered && "Collected leads appear here as soon as the extension saves them."}
          </EmptyState>
        )}

        {leads.data && leads.data.items.length > 0 && (
          <div className={`overflow-x-auto ${leads.isPlaceholderData ? "opacity-60" : ""}`}>
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th className="th w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all leads on this page"
                      checked={allOnPage}
                      onChange={() => setSelected(allOnPage ? new Set() : new Set(pageIds))}
                    />
                  </th>
                  <SortHeader field="name" label="Name" sort={sort} order={order} />
                  <SortHeader field="category" label="Category" sort={sort} order={order} />
                  <th className="th">Phone</th>
                  <th className="th">Email</th>
                  <th className="th">Website</th>
                  <th className="th">Address</th>
                  <SortHeader field="city" label="City" sort={sort} order={order} />
                  <th className="th">State</th>
                  <SortHeader field="rating" label="Rating" sort={sort} order={order} />
                  <th className="th">Source</th>
                  <SortHeader field="createdAt" label="Created" sort={sort} order={order} />
                  <th className="th">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {leads.data.items.map((l) => (
                  <tr key={l.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${selected.has(l.id) ? "bg-brand-50 dark:bg-brand-700/10" : ""}`}>
                    <td className="td">
                      <input type="checkbox" aria-label={`Select ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                    </td>
                    <td className="td max-w-56">
                      <Link to={`/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-600 dark:text-white">
                        {l.name}
                      </Link>
                    </td>
                    <td className="td whitespace-nowrap text-slate-600 dark:text-slate-300">{l.category ?? "—"}</td>
                    <td className="td whitespace-nowrap tabular-nums">{l.phone ?? "—"}</td>
                    <td className="td">{l.email ?? "—"}</td>
                    <td className="td">
                      {safeHref(l.website) ? (
                        <a href={safeHref(l.website)} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-600 hover:underline">
                          {hostOf(l.website)}
                        </a>
                      ) : (
                        (l.website ?? "—")
                      )}
                    </td>
                    <td className="td max-w-64 text-slate-600 dark:text-slate-300">
                      <span className="line-clamp-2">{l.address ?? "—"}</span>
                    </td>
                    <td className="td whitespace-nowrap">{l.city ?? "—"}</td>
                    <td className="td whitespace-nowrap">{l.state ?? "—"}</td>
                    <td className="td whitespace-nowrap tabular-nums">
                      {l.rating !== null ? `★ ${l.rating}` : "—"}
                      {l.reviewCount !== null && <span className="text-xs text-slate-500"> ({formatNumber(l.reviewCount)})</span>}
                    </td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">{l.source}</td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">{formatDate(l.createdAt)}</td>
                    <td className="td whitespace-nowrap text-right">
                      <ConfirmButton
                        label="Delete"
                        confirmLabel="Delete"
                        className="btn btn-danger px-2 py-1 text-xs"
                        disabled={remove.isPending}
                        onConfirm={() => remove.mutate(l.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {leads.data && leads.data.total > 0 && (
          <Pagination page={page} pageSize={pageSize} total={leads.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />
        )}
      </div>
    </>
  );
}
