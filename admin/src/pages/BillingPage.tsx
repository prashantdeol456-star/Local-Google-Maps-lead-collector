import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { ENTRY_LABEL, PAYMENT_LABEL, PAYMENT_STYLE, payWithRazorpay, rupees, type MyBilling, type OrderInfo } from "../lib/billing";
import { formatDate } from "../lib/format";

// A customer's lead credits: free leads left, balance, online recharge and history.

const PRESETS = [100, 500, 1000, 2000];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#0f1f19] dark:text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function BillingPage() {
  const client = useQueryClient();
  const billing = useQuery({ queryKey: ["billing", "me"], queryFn: () => api<MyBilling>("/billing/me") });
  const [amount, setAmount] = useState("500");
  const [paid, setPaid] = useState<string | null>(null);

  const recharge = useMutation({
    mutationFn: async (amountInr: number) => {
      const order = await api<OrderInfo>("/billing/orders", { method: "POST", body: { amountInr } });
      const signed = await payWithRazorpay(order);
      if (!signed) return null; // closed by the user
      return api<MyBilling>("/billing/verify", { method: "POST", body: signed });
    },
    onSuccess: (data, amountInr) => {
      if (!data) return;
      client.setQueryData(["billing", "me"], data);
      setPaid(`₹${amountInr.toLocaleString("en-IN")} added to your balance.`);
    },
  });

  if (billing.error) return <ErrorBox error={billing.error} />;
  if (!billing.data) return <Spinner />;
  const { credits: c, razorpay, limits, entries, payments } = billing.data;
  const value = Number(amount);
  const valid = Number.isFinite(value) && value * 100 >= limits.minPaise && value * 100 <= limits.maxPaise;

  return (
    <>
      <PageHeader title="Billing" subtitle={`Your first ${c.freeLeads.toLocaleString("en-IN")} new leads are free, then ${rupees(c.pricePerLeadPaise)} per new lead. Leads you already have are free.`} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Free leads left" value={c.freeLeadsLeft.toLocaleString("en-IN")} hint={`${c.freeLeadsUsed.toLocaleString("en-IN")} of ${c.freeLeads.toLocaleString("en-IN")} used`} />
        <Stat label="Balance" value={rupees(c.balancePaise)} hint={`${rupees(c.pricePerLeadPaise)} per new lead`} />
        <Stat label="New leads you can save" value={c.leadsLeft.toLocaleString("en-IN")} hint="free leads + what your balance pays for" />
        <Stat label="Total recharged" value={rupees(payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amountPaise, 0))} hint="online payments" />
      </div>

      {c.leadsLeft === 0 && (
        <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300">
          New leads are not being saved: your free leads are used up and your balance is empty. Recharge below — the extension keeps the waiting leads and sends them
          automatically afterwards.
        </p>
      )}

      <section className="card mb-6 space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Recharge</h2>
          {razorpay.enabled && razorpay.mode === "test" && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Test mode — no real money</span>}
        </div>
        {!razorpay.enabled ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">Online recharge is not set up yet. Contact the administrator to add credit to your account.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              {PRESETS.map((p) => (
                <button key={p} type="button" className={`btn ${amount === String(p) ? "nav-active border-gold-400" : ""}`} onClick={() => setAmount(String(p))}>
                  ₹{p.toLocaleString("en-IN")}
                </button>
              ))}
              <label className="space-y-1">
                <span className="label block">Other amount (₹)</span>
                <input className="input w-36" type="number" min={limits.minPaise / 100} max={limits.maxPaise / 100} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {valid ? (
                <>
                  ₹{value.toLocaleString("en-IN")} pays for <b>{Math.floor((value * 100) / c.pricePerLeadPaise).toLocaleString("en-IN")}</b> new leads.
                </>
              ) : (
                `Enter between ${rupees(limits.minPaise)} and ${rupees(limits.maxPaise)}.`
              )}
            </p>
            {recharge.error && <ErrorBox error={recharge.error} />}
            {paid && <p className="text-sm font-semibold text-emerald-700">{paid}</p>}
            <button className="btn btn-gold" disabled={!valid || recharge.isPending} onClick={() => (setPaid(null), recharge.mutate(value))}>
              {recharge.isPending ? "Waiting for payment…" : `Pay ₹${valid ? value.toLocaleString("en-IN") : "—"} (UPI, card, netbanking)`}
            </button>
            <p className="text-xs text-slate-500">Payments are processed by Razorpay; we never see your card or UPI details. The balance updates as soon as the payment is confirmed.</p>
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="border-b border-slate-200 px-5 py-3 font-semibold dark:border-slate-800">Balance history</h2>
          {entries.length === 0 ? (
            <EmptyState title="No changes yet">Recharges, admin credits and paid leads appear here.</EmptyState>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  <th className="th">What</th>
                  <th className="th text-right">Amount</th>
                  <th className="th text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="td whitespace-nowrap text-slate-500">{formatDate(e.createdAt)}</td>
                    <td className="td">
                      {ENTRY_LABEL[e.type]}
                      {e.note && <span className="block text-xs text-slate-500">{e.note}</span>}
                    </td>
                    <td className={`td text-right font-semibold ${e.amountPaise > 0 ? "text-emerald-700" : "text-slate-700 dark:text-slate-300"}`}>
                      {e.amountPaise > 0 ? "+" : "−"}
                      {rupees(Math.abs(e.amountPaise))}
                    </td>
                    <td className="td text-right">{rupees(e.balanceAfterPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2 className="border-b border-slate-200 px-5 py-3 font-semibold dark:border-slate-800">Payments</h2>
          {payments.length === 0 ? (
            <EmptyState title="No payments yet" />
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="td whitespace-nowrap text-slate-500">{formatDate(p.paidAt ?? p.createdAt)}</td>
                    <td className="td text-right font-semibold">{rupees(p.amountPaise)}</td>
                    <td className="td">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAYMENT_STYLE[p.status]}`}>{PAYMENT_LABEL[p.status]}</span>
                      {p.method && <span className="ml-2 text-xs text-slate-500">{p.method}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
