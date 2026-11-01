import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, getViewOwner, setViewOwner } from "../lib/api";
import type { LiveState } from "../lib/live";
import { Link, usePath } from "../lib/router";
import type { Admin, UserAccount } from "../lib/types";
import { guideSectionFor } from "../guide/content";
import { NAV_GROUPS } from "./nav";
import { rupees, type MyBilling } from "../lib/billing";

/** Pages a customer can use; the rest is for super admins until it is separated per user. */
const CUSTOMER_PAGES = new Set(["/", "/leads", "/linkedin", "/collections", "/extensions", "/email", "/whatsapp", "/templates", "/quick-send", "/opt-outs", "/contacts", "/sender", "/inbox", "/social", "/guide", "/billing"]);

/** Customer-only pages (super admins send with the .env senders, set up in Settings). */
const CUSTOMER_ONLY = new Set(["/sender", "/billing"]);



/** Pages that belong to a service the super admin can switch off per customer. */
const PAGE_SERVICE: Record<string, string> = {
  "/leads": "google_maps",
  "/collections": "google_maps",
  "/linkedin": "linkedin",
  "/contacts": "contacts",
  "/email": "email",
  "/whatsapp": "whatsapp",
  "/inbox": "ai_inbox",
  "/social": "social",
};

export function canOpen(admin: Admin, path: string): boolean {
  if (admin.role === "super_admin") return true;
  const top = `/${path.split("/")[1] ?? ""}`;
  const service = PAGE_SERVICE[top];
  return CUSTOMER_PAGES.has(top) && (!service || admin.services.includes(service));
}

/** Super admin: whose data the pages show (all users, or one). */
function ViewOwnerSelect() {
  const client = useQueryClient();
  const users = useQuery({ queryKey: ["users", "active-list"], queryFn: () => api<{ items: UserAccount[]; pendingCount: number }>("/users?status=active") });
  const current = getViewOwner() ?? "";
  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      <span className="hidden md:inline">Data:</span>
      <select
        className="input h-9 w-44 py-1 text-sm"
        value={current}
        onChange={(e) => {
          setViewOwner(e.target.value || null);
          client.clear(); // every page refetches for the chosen user
        }}
        aria-label="Whose data to show"
      >
        <option value="">All users</option>
        {users.data?.items.map((u) => (
          <option key={u.id} value={u.id}>
            {u.username ?? u.email}
            {u.role === "super_admin" ? " (super admin)" : ""}
          </option>
        ))}
      </select>
      {!!users.data?.pendingCount && (
        <Link to="/users?status=pending" className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white" title="Accounts waiting for approval">
          {users.data.pendingCount} new
        </Link>
      )}
    </label>
  );
}

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
  const credits = useQuery({
    queryKey: ["billing", "me"],
    queryFn: () => api<MyBilling>("/billing/me"),
    enabled: admin.role !== "super_admin",
    refetchInterval: 60_000,
  }).data?.credits;
  const contactUnread = useQuery({
    queryKey: ["site-messages", "unread"],
    queryFn: () => api<{ unread: number }>("/site/messages?status=new&pageSize=1"),
    enabled: admin.role === "super_admin",
    refetchInterval: 60_000,
  }).data?.unread;

  const sidebar = (
    <nav className="flex h-full flex-col border-r border-[#dfe8e3] bg-[#f4f8f6] text-[#2b4a3f] dark:border-[#1c3a2e] dark:bg-[#0b1f17] dark:text-slate-300">
      <div className="flex h-16 shrink-0 items-center gap-2 px-5 text-[#0f2a20] dark:text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-[#1fb57b] to-[#0d8a5c] text-sm font-bold">LP</span>
        <span className="font-bold tracking-tight">
          Lead Platform<sup className="text-[9px]">™</sup>
        </span>
      </div>
      <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => canOpen(admin, item.to) && !(admin.role === "super_admin" && CUSTOMER_ONLY.has(item.to)));
          if (!items.length) return null;
          return (
            <div key={group.title} className="mt-3 first:mt-1">
              <p className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#557366] dark:text-[#7fa294]">{group.title}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
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
                          className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm ${active ? "nav-active shadow-[inset_3px_0_0_#c4953a]" : "hover:bg-[#e4efe9] hover:text-[#0d4a36] dark:hover:bg-sidebar-hover dark:hover:text-white"}`}
                        >
                          <span className="w-4 text-center" aria-hidden>{item.icon}</span>
                          {item.label}
                          {item.to === "/contact-leads" && !!contactUnread && (
                            <span className="ml-auto rounded-full bg-gold-400 px-1.5 text-[11px] font-semibold text-[#1d1606]" title="New contact leads">
                              {contactUnread}
                            </span>
                          )}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="px-5 py-4 text-xs text-[#6b8379] dark:text-slate-500">© Lead Platform</p>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-60 print:pl-0">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block print:hidden">{sidebar}</aside>
      {/* Mobile sidebar */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60">{sidebar}</aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-16 print:hidden items-center gap-3 border-b border-[#e2e8e4] bg-white/90 px-4 backdrop-blur sm:px-6 dark:border-[#1c3a2e] dark:bg-[#0b1f17]/90">
        <button className="btn lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          ☰
        </button>
        {admin.role === "super_admin" && <ViewOwnerSelect />}
        {credits && (
          <Link
            to="/billing"
            className={`ml-auto hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline ${credits.leadsLeft === 0 ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}
            title="Free leads left and balance"
          >
            {credits.freeLeadsLeft > 0 ? `${credits.freeLeadsLeft.toLocaleString("en-IN")} free leads` : rupees(credits.balancePaise)} · {credits.leadsLeft.toLocaleString("en-IN")} leads left
          </Link>
        )}
        {path !== "/guide" && (
          <Link
            to={`/guide${guideSectionFor(path) ? `#${guideSectionFor(path)!.id}` : ""}`}
            className={`btn ${credits ? "sm:ml-0 ml-auto" : "ml-auto"} h-9 border-gold-400/70 bg-gold-100/60 text-[#5a4208] hover:border-gold-600 hover:text-[#3d2c04] dark:bg-gold-600/10 dark:text-gold-300`}
            title="How this page works, with screenshots"
          >
            📘 Guide
          </Link>
        )}
        <span className={`${path === "/guide" ? "ml-auto " : ""}flex items-center gap-2 text-xs text-slate-500`} title="Live updates from the backend">
          <span className={`h-2 w-2 rounded-full ${LIVE_LABEL[live].dot}`} />
          {LIVE_LABEL[live].text}
        </span>
        <span className="hidden text-sm text-slate-600 sm:inline dark:text-slate-300">
          {admin.email}
          {admin.role === "super_admin" && <span className="ml-1 text-xs text-brand-600">· super admin</span>}
        </span>
        <button className="btn" onClick={onLogout}>
          Log out
        </button>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
