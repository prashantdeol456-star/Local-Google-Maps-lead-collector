import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmailProviderCard } from "../components/EmailProviderCard";
import { WhatsAppProviderCard } from "../components/WhatsAppProviderCard";
import { AiNavigationCard } from "../components/AiNavigationCard";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatRelative } from "../lib/format";
import type { Admin, ApiToken } from "../lib/types";

export function SettingsPage({ admin }: { admin: Admin }) {
  const client = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<{ tokens: ApiToken[] }>("/auth/tokens").then((r) => r.tokens) });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tokens"] }),
  });

  return (
    <>
      <PageHeader title="Settings" />

      <section className="card mb-6">
        <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Account</h2>
        <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="label">Email</dt>
            <dd className="mt-1">{admin.email}</dd>
          </div>
          <div>
            <dt className="label">Name</dt>
            <dd className="mt-1">{admin.name ?? "—"}</dd>
          </div>
        </dl>
        <p className="px-5 pb-5 text-xs text-slate-500">
          To change a password, run <code>npm run admin:password -w backend</code> in the project folder. It signs out all
          existing logins of that admin.
        </p>
      </section>

      <EmailProviderCard defaultTo={admin.email} />
      <WhatsAppProviderCard />
      <AiNavigationCard />

      <section className="card">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-medium">Connected extensions</h2>
          <p className="text-xs text-slate-500">Chrome extensions logged in with your account. Revoking one logs it out immediately.</p>
        </div>
        {tokens.isPending && <Spinner />}
        {tokens.error && <div className="p-4"><ErrorBox error={tokens.error} /></div>}
        {revoke.error && <div className="p-4"><ErrorBox error={revoke.error} /></div>}
        {tokens.data?.length === 0 && <EmptyState title="No extensions connected" />}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {tokens.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-medium">
                  {t.name} <code className="ml-1 text-xs text-slate-500">{t.prefix}…</code>
                  {t.scope === "read" && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">read only</span>}
                </p>
                <p className="text-xs text-slate-500">
                  Connected {formatDate(t.createdAt)} · last used {formatRelative(t.lastUsedAt)} · {t.expiresAt ? `expires ${formatDate(t.expiresAt)}` : "no expiry"}
                </p>
              </div>
              <ConfirmButton label="Revoke" confirmLabel="Revoke access" className="btn btn-danger px-2 py-1 text-xs" onConfirm={() => revoke.mutate(t.id)} disabled={revoke.isPending} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
