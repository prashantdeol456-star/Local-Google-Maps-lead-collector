import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type FormEvent } from "react";
import { DateRangeFilter, EmptyState, ErrorBox, PageHeader, Pagination, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { ENTRY_LABEL, PAYMENT_LABEL, PAYMENT_STYLE, rupees, type CreditEntry, type Credits, type Payment } from "../lib/billing";
import { formatDate } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";

// Super admin: money received (Razorpay), every customer's credits, manual credit/debit, ledger.

interface Totals {
  today: { paise: number; count: number };
  thisMonth: { paise: number; count: number };
  allTime: { paise: number; count: number };
  filteredPaise: number;
}
interface Account {
  id: string;
  email: string;
  username: string | null;
  status: string;
  credits: Credits;
  paidPaise: number;
}

const PAGE = 25;

function Total({ label, t }: { label: string; t: { paise: number; count: number } }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#0f1f19] dark:text-white">{rupees(t.paise)}</p>
      <p className="text-xs text-slate-500">{t.count} payments</p>
    </div>
  );
}

function PaymentsTab() {
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const list = useQuery({
    queryKey: ["billing", "payments", status, from, to, page],
    queryFn: () => api<{ items: Payment[]; total: number; totals: Totals }>(`/billing/payments${qs({ status, from, to, page, pageSize: PAGE })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const totals = list.data?.totals;
  return (
    <>
      {totals && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Total label="Received today" t={totals.today} />
          <Total label="This month" t={totals.thisMonth} />
          <Total label="All time" t={totals.allTime} />
        </div>
      )}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
          <select className="input w-auto" aria-label="Status" value={status} onChange={(e) => setSearchParams({ status: e.target.value || null, page: null })}>
            <option value="">All statuses</option>
            <option value="paid">Paid</option>
            <option value="created">Not completed</option>
            <option value="failed">Failed</option>
          </select>
          <DateRangeFilter from={from} to={to} onChange={(f, t) => setSearchParams({ from: f, to: t, page: null })} />
          {totals && (from || to || status) && <span className="ml-auto text-sm text-slate-600 dark:text-slate-300">Paid in this view: <b>{rupees(totals.filteredPaise)}</b></span>}
        </div>
        {list.isPending && <Spinner />}
        {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
        {list.data?.items.length === 0 && <EmptyState title="No payments">Online recharges by customers appear here.</EmptyState>}
        {!!list.data?.items.length && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Customer</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Status</th>
                  <th className="th">Method</th>
                  <th className="th">Razorpay ids</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="td whitespace-nowrap text-slate-500">{formatDate(p.paidAt ?? p.createdAt)}</td>
                    <td className="td">{p.user ? (p.user.username ?? p.user.email) : "—"}</td>
                    <td className="td text-right font-semibold">{rupees(p.amountPaise)}</td>
                    <td className="td">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAYMENT_STYLE[p.status]}`}>{PAYMENT_LABEL[p.status]}</span>
                      {p.failureReason && <span className="block text-xs text-red-600">{p.failureReason}</span>}
                    </td>
                    <td className="td">{p.method ?? "—"}</td>
                    <td className="td font-mono text-xs text-slate-500">
                      {p.orderId}
                      {p.paymentId && <span className="block">{p.paymentId}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > PAGE && <Pagination page={page} pageSize={PAGE} total={list.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />}
      </div>
    </>
  );
}

function AdjustForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const client = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/billing/accounts/${encodeURIComponent(account.id)}/adjust`, { method: "POST", body: { amountInr: Number(amount), note } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["billing"] });
      onDone();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 bg-gold-100/40 px-4 py-3 dark:bg-gold-600/10">
      <label className="space-y-1">
        <span className="label block">Amount ₹ (minus to remove)</span>
        <input className="input w-36" type="number" step="0.5" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
      </label>
      <label className="min-w-60 flex-1 space-y-1">
        <span className="label block">Reason (kept in the ledger)</span>
        <input className="input" required minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Paid by bank transfer / bonus / correction" />
      </label>
      <button className="btn btn-primary" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
      <button type="button" className="btn" onClick={onDone}>
        Cancel
      </button>
      {save.error && <div className="basis-full"><ErrorBox error={save.error} /></div>}
    </form>
  );
}

function AccountsTab() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [search, setSearch] = useState(q);
  const [editing, setEditing] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["billing", "accounts", q, page],
    queryFn: () => api<{ items: Account[]; total: number }>(`/billing/accounts${qs({ q, page, pageSize: PAGE })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="card">
      <form className="border-b border-slate-200 p-4 dark:border-slate-800" onSubmit={(e) => (e.preventDefault(), setSearchParams({ q: search.trim() || null, page: null }))}>
        <input className="input max-w-xs" type="search" placeholder="Search email or user id…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </form>
      {list.isPending && <Spinner />}
      {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
      {list.data?.items.length === 0 && <EmptyState title="No customers" />}
      {!!list.data?.items.length && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="th">Customer</th>
                <th className="th text-right">Free leads used</th>
                <th className="th text-right">Balance</th>
                <th className="th text-right">Leads left</th>
                <th className="th text-right">Paid online</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.data.items.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td className="td">
                      <b>{a.username ?? a.email}</b>
                      <span className="block text-xs text-slate-500">
                        {a.email} · {a.status}
                      </span>
                    </td>
                    <td className="td text-right">
                      {a.credits.freeLeadsUsed.toLocaleString("en-IN")} / {a.credits.freeLeads.toLocaleString("en-IN")}
                    </td>
                    <td className="td text-right font-semibold">{rupees(a.credits.balancePaise)}</td>
                    <td className={`td text-right ${a.credits.leadsLeft === 0 ? "font-semibold text-red-600" : ""}`}>{a.credits.leadsLeft.toLocaleString("en-IN")}</td>
                    <td className="td text-right">{rupees(a.paidPaise)}</td>
                    <td className="td whitespace-nowrap text-right">
                      <button className="btn h-8" onClick={() => setEditing(editing === a.id ? null : a.id)}>
                        ± Credit
                      </button>{" "}
                      <Link className="btn h-8" to={`/payments?tab=ledger&userId=${a.id}`}>
                        Ledger
                      </Link>
                    </td>
                  </tr>
                  {editing === a.id && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <AdjustForm account={a} onDone={() => setEditing(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && list.data.total > PAGE && <Pagination page={page} pageSize={PAGE} total={list.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />}
    </div>
  );
}

function LedgerTab() {
  const params = useSearchParams();
  const userId = params.get("userId") ?? "";
  const type = params.get("type") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const list = useQuery({
    queryKey: ["billing", "entries", userId, type, from, to, page],
    queryFn: () => api<{ items: CreditEntry[]; total: number }>(`/billing/entries${qs({ userId, type, from, to, page, pageSize: PAGE })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
        <select className="input w-auto" aria-label="Type" value={type} onChange={(e) => setSearchParams({ type: e.target.value || null, page: null })}>
          <option value="">All changes</option>
          {Object.entries(ENTRY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <DateRangeFilter from={from} to={to} onChange={(f, t) => setSearchParams({ from: f, to: t, page: null })} />
        {userId && (
          <button className="btn" onClick={() => setSearchParams({ userId: null, page: null })}>
            Showing one customer ✕
          </button>
        )}
      </div>
      {list.isPending && <Spinner />}
      {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
      {list.data?.items.length === 0 && <EmptyState title="No entries" />}
      {!!list.data?.items.length && (
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className="th">Date</th>
              <th className="th">What</th>
              <th className="th text-right">Amount</th>
              <th className="th text-right">Balance after</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.data.items.map((e) => (
              <tr key={e.id}>
                <td className="td whitespace-nowrap text-slate-500">{formatDate(e.createdAt)}</td>
                <td className="td">
                  {ENTRY_LABEL[e.type]}
                  {e.note && <span className="block text-xs text-slate-500">{e.note}</span>}
                </td>
                <td className={`td text-right font-semibold ${e.amountPaise > 0 ? "text-emerald-700" : ""}`}>
                  {e.amountPaise > 0 ? "+" : "−"}
                  {rupees(Math.abs(e.amountPaise))}
                </td>
                <td className="td text-right">{rupees(e.balanceAfterPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.data && list.data.total > PAGE && <Pagination page={page} pageSize={PAGE} total={list.data.total} onPage={(p) => setSearchParams({ page: p }, { replace: false })} />}
    </div>
  );
}

const TABS = [
  ["payments", "Payments received"],
  ["accounts", "Customer balances"],
  ["ledger", "Ledger"],
] as const;

export function PaymentsPage() {
  const params = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab")! : "payments";
  return (
    <>
      <PageHeader title="Payments" subtitle="Money received through Razorpay, each customer's free leads and balance, and every credit change." />
      <div className="mb-4 inline-flex rounded-lg border border-[#cfd8d3] bg-white p-1 dark:border-[#24463a] dark:bg-[#0b1f17]">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold ${tab === k ? "nav-active" : "text-slate-600 hover:text-brand-700 dark:text-slate-300"}`}
            onClick={() => setSearchParams({ tab: k === "payments" ? null : k, page: null, status: null, from: null, to: null, q: null, type: null, userId: null })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "payments" && <PaymentsTab />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "ledger" && <LedgerTab />}
    </>
  );
}
