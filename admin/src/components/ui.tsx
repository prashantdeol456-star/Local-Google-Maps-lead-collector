import { useState, type ReactNode } from "react";
import { ApiError } from "../lib/api";
import { formatNumber } from "../lib/format";
import type { JobStatus } from "../lib/types";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0f1f19] dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  blue: "bg-brand-50 text-brand-600 dark:bg-brand-700/20 dark:text-brand-100",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  red: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
};

export function StatCard({ label, value, hint, tone = "blue", icon }: { label: string; value: number | null | undefined; hint?: string; tone?: keyof typeof TONES; icon: string }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg ${TONES[tone]}`} aria-hidden>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
          {value === undefined ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-800" /> : formatNumber(value)}
        </p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<JobStatus, string> = {
  pending: TONES.slate,
  running: TONES.green,
  paused: TONES.amber,
  completed: TONES.blue,
  failed: TONES.red,
  stopped: TONES.slate,
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}>
      {status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {status}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" role="alert">
      {message}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
      <span className="text-slate-500">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ← Prev
        </button>
        <span className="tabular-nums text-slate-500">
          Page {page} / {pages}
        </span>
        <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}

/** A destructive button that asks for a second click to confirm. */
export function ConfirmButton({ label, confirmLabel = "Confirm?", onConfirm, disabled, className = "btn btn-danger" }: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex gap-1">
      <button type="button" className="btn btn-danger" onClick={() => { setArmed(false); onConfirm(); }}>
        {confirmLabel}
      </button>
      <button type="button" className="btn" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};

const DATE_PRESETS: { id: string; label: string; range: () => [string, string] }[] = [
  { id: "today", label: "Today", range: () => [daysAgo(0), daysAgo(0)] },
  { id: "yesterday", label: "Yesterday", range: () => [daysAgo(1), daysAgo(1)] },
  { id: "7d", label: "Last 7 days", range: () => [daysAgo(6), daysAgo(0)] },
  { id: "30d", label: "Last 30 days", range: () => [daysAgo(29), daysAgo(0)] },
  { id: "month", label: "This month", range: () => [`${daysAgo(0).slice(0, 8)}01`, daysAgo(0)] },
];

/** "Date added" filter: quick ranges or a custom from–to, kept in the URL as ?from=&to= (YYYY-MM-DD). */
export function DateRangeFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string | null, to: string | null) => void }) {
  const preset = DATE_PRESETS.find((p) => {
    const [f, t] = p.range();
    return f === from && t === to;
  })?.id;
  const [custom, setCustom] = useState(!preset && !!(from || to));
  const mode = custom ? "custom" : (preset ?? (from || to ? "custom" : ""));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input w-auto"
        aria-label="Date added"
        value={mode}
        onChange={(e) => {
          const id = e.target.value;
          if (id === "custom") return setCustom(true);
          setCustom(false);
          const range = DATE_PRESETS.find((p) => p.id === id)?.range();
          onChange(range?.[0] ?? null, range?.[1] ?? null);
        }}
      >
        <option value="">📅 Any date</option>
        {DATE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range…</option>
      </select>
      {mode === "custom" && (
        <>
          <input className="input w-auto" type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value || null, to || null)} />
          <span className="text-slate-400">–</span>
          <input className="input w-auto" type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => onChange(from || null, e.target.value || null)} />
        </>
      )}
    </div>
  );
}
