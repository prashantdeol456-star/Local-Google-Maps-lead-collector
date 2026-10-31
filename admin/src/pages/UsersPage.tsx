import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api, qs, setViewOwner } from "../lib/api";
import { formatDate } from "../lib/format";
import { navigate, setSearchParams, useSearchParams } from "../lib/router";
import type { Admin, UserAccount } from "../lib/types";

// Super admin: accounts created through the registration form, approval and access.

type Status = "" | "pending" | "active" | "disabled";

const STATUS_STYLE: Record<UserAccount["status"], string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  disabled: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function PasswordReset({ user, onDone }: { user: UserAccount; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => api(`/users/${encodeURIComponent(user.id)}/password`, { method: "POST", body: { password } }),
    onSuccess: onDone,
  });
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        reset.mutate();
      }}
    >
      <input className="input w-56" type="text" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (10+ characters)" />
      <button className="btn btn-primary" disabled={reset.isPending}>
        Set password
      </button>
      <button type="button" className="btn" onClick={onDone}>
        Cancel
      </button>
      {reset.error && <ErrorBox error={reset.error} />}
    </form>
  );
}

export function UsersPage({ admin }: { admin: Admin }) {
  const client = useQueryClient();
  const params = useSearchParams();
  const status = (["pending", "active", "disabled"].includes(params.get("status") ?? "") ? params.get("status") : "") as Status;
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [resetting, setResetting] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["users", status, q],
    queryFn: () => api<{ items: UserAccount[]; pendingCount: number }>(`/users${qs({ status, q })}`),
    placeholderData: keepPreviousData,
  });
  const action = useMutation({
    mutationFn: ({ id, what }: { id: string; what: "approve" | "disable" | "enable" }) => api(`/users/${encodeURIComponent(id)}/${what}`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["users"] }),
  });

  const tab = (value: Status, label: string) => (
    <button
      key={value}
      className={`rounded-lg px-3 py-1.5 text-sm ${status === value ? "bg-brand-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
      onClick={() => setSearchParams({ status: value || null })}
    >
      {label}
      {value === "pending" && !!list.data?.pendingCount && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{list.data.pendingCount}</span>}
    </button>
  );

  function viewData(u: UserAccount) {
    setViewOwner(u.id);
    client.clear();
    navigate("/leads");
  }

  return (
    <>
      <PageHeader title="Users" subtitle="People who signed up with the registration form. Approve them to let them sign in; each user sees only their own leads." />
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex gap-1">
            {tab("", "All")}
            {tab("pending", "Waiting for approval")}
            {tab("active", "Active")}
            {tab("disabled", "Disabled")}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearchParams({ q: search.trim() || null });
            }}
          >
            <input className="input w-64" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Email, user id, phone" aria-label="Search users" />
          </form>
        </div>
        {list.isPending && <Spinner />}
        {list.error && (
          <div className="p-4">
            <ErrorBox error={list.error} />
          </div>
        )}
        {action.error && (
          <div className="p-4">
            <ErrorBox error={action.error} />
          </div>
        )}
        {list.data?.items.length === 0 && <EmptyState title={status === "pending" ? "No requests waiting" : "No users"}>New sign-ups appear here.</EmptyState>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {list.data?.items.map((u) => (
            <li key={u.id} className="px-5 py-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {u.username ?? u.email}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[u.status]}`}>{u.status}</span>
                    {u.role === "super_admin" && <span className="ml-1 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">super admin</span>}
                  </p>
                  <p className="text-slate-500">
                    {u.email}
                    {u.phone && ` · ${u.phone}`}
                  </p>
                  <p className="text-xs text-slate-500">
                    Signed up {formatDate(u.createdAt)}
                    {u.lastLoginAt && ` · last sign-in ${formatDate(u.lastLoginAt)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {u.status === "pending" && (
                    <button className="btn btn-primary" disabled={action.isPending} onClick={() => action.mutate({ id: u.id, what: "approve" })}>
                      Approve
                    </button>
                  )}
                  {u.status === "disabled" && (
                    <button className="btn" disabled={action.isPending} onClick={() => action.mutate({ id: u.id, what: "enable" })}>
                      Enable
                    </button>
                  )}
                  {u.status === "active" && u.role === "customer" && (
                    <button className="btn" onClick={() => viewData(u)} title="Show this user's leads">
                      View data
                    </button>
                  )}
                  {u.id !== admin.id && (
                    <button className="btn" onClick={() => setResetting(resetting === u.id ? null : u.id)}>
                      Reset password
                    </button>
                  )}
                  {u.id !== admin.id && u.status !== "disabled" && (
                    <ConfirmButton
                      label={u.status === "pending" ? "Reject" : "Disable"}
                      confirmLabel={u.status === "pending" ? "Reject request?" : "Disable account?"}
                      onConfirm={() => action.mutate({ id: u.id, what: "disable" })}
                      disabled={action.isPending}
                    />
                  )}
                </div>
              </div>
              {resetting === u.id && (
                <PasswordReset
                  user={u}
                  onDone={() => {
                    setResetting(null);
                    client.invalidateQueries({ queryKey: ["users"] });
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
