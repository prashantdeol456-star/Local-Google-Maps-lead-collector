import { useState, type ReactNode } from "react";
import type { LiveState } from "../lib/live";
import { Link, usePath } from "../lib/router";
import type { Admin } from "../lib/types";

const NAV: { to: string; label: string; icon: string; soon?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: "▦" },
  { to: "/leads", label: "Google Maps Leads", icon: "☰" },
  { to: "/linkedin", label: "LinkedIn Leads", icon: "in" },
  { to: "/contacts", label: "Contacts (Sheets)", icon: "▤" },
  { to: "/collections", label: "Collections", icon: "⌖" },
  { to: "/email", label: "Email", icon: "✉" },
  { to: "/whatsapp", label: "WhatsApp", icon: "✆" },
  { to: "/linkedin-outreach", label: "LinkedIn Outreach", icon: "➤" },
  { to: "/templates", label: "Templates", icon: "❏" },
  { to: "/campaign-logs", label: "Campaign Logs", icon: "≡" },
  { to: "/opt-outs", label: "Opt-outs", icon: "⊘" },
  { to: "/social", label: "Social Accounts", icon: "◎" },
  { to: "/integrations", label: "Integrations", icon: "⇄" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

function isActive(path: string, to: string) {
  return to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
}

const LIVE_LABEL: Record<LiveState, { text: string; dot: string }> = {
  live: { text: "Live", dot: "bg-emerald-500" },
  connecting: { text: "Connecting…", dot: "bg-amber-400" },
  offline: { text: "Offline", dot: "bg-red-500" },
};

export function Layout({ admin, live, onLogout, children }: { admin: Admin; live: LiveState; onLogout: () => void; children: ReactNode }) {
  const path = usePath();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <nav className="flex h-full flex-col bg-sidebar text-slate-300">
      <div className="flex h-16 items-center gap-2 px-5 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold">LP</span>
        <span className="font-semibold">Lead Platform</span>
      </div>
      <ul className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => {
          const active = isActive(path, item.to);
          return (
            <li key={item.to}>
              {item.soon ? (
                <span className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500" title="Available in a later phase">
                  <span className="w-4 text-center" aria-hidden>{item.icon}</span>
                  {item.label}
                  <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
                </span>
              ) : (
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-brand-600 text-white" : "hover:bg-sidebar-hover hover:text-white"}`}
                >
                  <span className="w-4 text-center" aria-hidden>{item.icon}</span>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className="px-5 py-4 text-xs text-slate-500">Local · SQLite</p>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">{sidebar}</aside>
      {/* Mobile sidebar */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60">{sidebar}</aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-900/90">
        <button className="btn lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          ☰
        </button>
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-500" title="Live updates from the backend">
          <span className={`h-2 w-2 rounded-full ${LIVE_LABEL[live].dot}`} />
          {LIVE_LABEL[live].text}
        </span>
        <span className="hidden text-sm text-slate-600 sm:inline dark:text-slate-300">{admin.email}</span>
        <button className="btn" onClick={onLogout}>
          Log out
        </button>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
