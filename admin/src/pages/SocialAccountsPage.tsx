import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatRelative, safeHref } from "../lib/format";
import { setSearchParams, useSearchParams } from "../lib/router";

// Facebook Pages, Instagram professional accounts and LinkedIn profiles connected with each
// platform's own login (OAuth). Passwords are typed only on facebook.com / linkedin.com.

type Platform = "facebook_page" | "instagram" | "linkedin";

interface SocialAccount {
  id: string;
  platform: Platform;
  externalId: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  tokenExpiresAt: string | null;
  scopes: string[];
  status: "connected" | "expired" | "error";
  lastError: string | null;
  linkedPageId: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

interface Providers {
  meta: { configured: boolean; redirectUri: string; scopes: string[]; graphVersion: string | null };
  linkedin: { configured: boolean; redirectUri: string; scopes: string[] };
}

const PLATFORM: Record<Platform, { label: string; icon: string; tone: string }> = {
  facebook_page: { label: "Facebook Page", icon: "f", tone: "bg-[#1877F2] text-white" },
  instagram: { label: "Instagram", icon: "◎", tone: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white" },
  linkedin: { label: "LinkedIn", icon: "in", tone: "bg-[#0A66C2] text-white" },
};

const STATUS_TONE: Record<SocialAccount["status"], string> = {
  connected: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  expired: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  error: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
};

function profileUrl(a: SocialAccount): string | undefined {
  if (a.platform === "facebook_page") return `https://www.facebook.com/${a.externalId}`;
  if (a.platform === "instagram" && a.username) return `https://www.instagram.com/${a.username}/`;
  return undefined;
}

function AccountRow({ a, onChanged }: { a: SocialAccount; onChanged: () => void }) {
  const check = useMutation({ mutationFn: () => api(`/social/accounts/${a.id}/check`, { method: "POST" }), onSettled: onChanged });
  const remove = useMutation({ mutationFn: () => api(`/social/accounts/${a.id}`, { method: "DELETE" }), onSettled: onChanged });
  const p = PLATFORM[a.platform];
  const href = safeHref(profileUrl(a) ?? null);
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      {a.pictureUrl && safeHref(a.pictureUrl) ? (
        <img src={safeHref(a.pictureUrl)} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${p.tone}`} aria-hidden>
          {p.icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer noopener" className="hover:underline">
              {a.name}
            </a>
          ) : (
            a.name
          )}
          {a.username && <span className="ml-2 text-sm font-normal text-slate-500">{a.platform === "instagram" ? `@${a.username}` : a.username}</span>}
        </p>
        <p className="text-xs text-slate-500">
          {p.label}
          {a.tokenExpiresAt ? ` · login valid until ${formatDate(a.tokenExpiresAt)}` : " · login does not expire"}
          {a.lastCheckedAt && ` · checked ${formatRelative(a.lastCheckedAt)}`}
        </p>
        {a.lastError && <p className="text-xs text-red-600 dark:text-red-400">{a.lastError}</p>}
      </div>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[a.status]}`}>{a.status}</span>
      <button className="btn px-2 py-1 text-xs" disabled={check.isPending} onClick={() => check.mutate()}>
        {check.isPending ? "Checking…" : "Check"}
      </button>
      <ConfirmButton label="Disconnect" className="btn btn-danger px-2 py-1 text-xs" onConfirm={() => remove.mutate()} />
    </li>
  );
}

function SetupSteps({ provider, info }: { provider: "meta" | "linkedin"; info: Providers["meta"] | Providers["linkedin"] }) {
  if (provider === "meta") {
    return (
      <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600 dark:text-slate-300">
        <li>
          On <strong>developers.facebook.com → My Apps → Create app</strong>, add the use case to manage everything on your Page (and Instagram), with{" "}
          <em>Facebook Login for Business</em>.
        </li>
        <li>
          In Facebook Login settings, add this <strong>Valid OAuth Redirect URI</strong>: <code className="break-all">{info.redirectUri}</code>
        </li>
        <li>
          Copy <strong>App ID</strong> and <strong>App secret</strong> (App settings → Basic) into <code>backend/.env</code> as <code>META_APP_ID</code> and{" "}
          <code>META_APP_SECRET</code>, then restart the backend.
        </li>
        <li>Instagram must be a Business or Creator account, linked to your Facebook Page (Instagram app → Settings → Account type).</li>
        <li>While the app is in Development mode, only people with a role on the app (you) can connect. That is enough for your own accounts.</li>
      </ol>
    );
  }
  return (
    <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600 dark:text-slate-300">
      <li>
        On <strong>linkedin.com/developers → Create app</strong> (it needs a LinkedIn Company Page to attach to).
      </li>
      <li>
        Under <strong>Products</strong>, add <em>Sign In with LinkedIn using OpenID Connect</em> and <em>Share on LinkedIn</em>.
      </li>
      <li>
        Under <strong>Auth → Authorized redirect URLs</strong>, add: <code className="break-all">{info.redirectUri}</code>
      </li>
      <li>
        Copy <strong>Client ID</strong> and <strong>Client Secret</strong> into <code>backend/.env</code> as <code>LINKEDIN_CLIENT_ID</code> and{" "}
        <code>LINKEDIN_CLIENT_SECRET</code>, then restart the backend.
      </li>
    </ol>
  );
}

function ConnectCard({ provider, info }: { provider: "meta" | "linkedin"; info: Providers["meta"] | Providers["linkedin"] }) {
  const start = useMutation({
    mutationFn: () => api<{ url: string }>(`/social/connect/${provider}`, { method: "POST" }),
    onSuccess: ({ url }) => {
      window.location.href = url; // the platform's own login page
    },
  });
  const isMeta = provider === "meta";
  // The platform sends the browser back to the redirect URI: open the admin panel on that host so the session continues.
  const redirectOrigin = new URL(info.redirectUri).origin;
  const wrongHost = redirectOrigin !== window.location.origin;
  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold ${PLATFORM[isMeta ? "facebook_page" : "linkedin"].tone}`} aria-hidden>
          {isMeta ? "f" : "in"}
        </span>
        <div>
          <h2 className="font-medium">{isMeta ? "Facebook & Instagram" : "LinkedIn"}</h2>
          <p className="text-sm text-slate-500">
            {isMeta
              ? "One login connects every Facebook Page you manage and the Instagram Business/Creator account linked to each."
              : "Connects your LinkedIn profile (name, photo, email) and lets the platform post as you."}
          </p>
        </div>
      </div>
      {info.configured ? (
        <>
          <button className="btn btn-primary" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? "Opening…" : isMeta ? "Connect with Facebook" : "Connect with LinkedIn"}
          </button>
          {wrongHost && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              After login you will land on <code>{redirectOrigin}</code>. Open the admin panel there ({redirectOrigin}/admin) so you stay logged in.
            </p>
          )}
          {start.error && <ErrorBox error={start.error} />}
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500">Permissions asked and setup</summary>
            <p className="mt-2 text-xs text-slate-500">Permissions: {info.scopes.join(", ")}</p>
            <div className="mt-2">
              <SetupSteps provider={provider} info={info} />
            </div>
          </details>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Not set up yet. One-time steps:</p>
          <SetupSteps provider={provider} info={info} />
        </div>
      )}
    </section>
  );
}

export function SocialAccountsPage() {
  const client = useQueryClient();
  const params = useSearchParams();
  const connected = params.get("connected");
  const error = params.get("error");
  const providers = useQuery({ queryKey: ["social", "providers"], queryFn: () => api<Providers>("/social/providers") });
  const accounts = useQuery({ queryKey: ["social", "accounts"], queryFn: () => api<{ items: SocialAccount[] }>("/social/accounts").then((r) => r.items) });
  const refresh = () => client.invalidateQueries({ queryKey: ["social", "accounts"] });

  return (
    <>
      <PageHeader title="Social Accounts" subtitle="Connect Facebook, Instagram and LinkedIn with their own login. Your passwords are never typed or stored here." />

      {connected && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" role="status">
          Connected {connected} account{connected === "1" ? "" : "s"}.
          <button className="btn px-2 py-1 text-xs" onClick={() => setSearchParams({ connected: null, provider: null })}>
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" role="alert">
          {error}
          <button className="btn px-2 py-1 text-xs" onClick={() => setSearchParams({ error: null })}>
            ✕
          </button>
        </div>
      )}

      <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        🔒 Never paste a Facebook, Instagram or LinkedIn password anywhere in this panel. <em>Connect</em> opens the platform&apos;s own login page. This panel only
        receives an access token, stores it encrypted, and you can disconnect at any time. To revoke access on the platform too, remove the app in Facebook
        Settings → Business integrations, or in LinkedIn Settings → Data privacy → Permitted services.
      </div>

      {providers.error && <ErrorBox error={providers.error} />}
      {providers.data && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <ConnectCard provider="meta" info={providers.data.meta} />
          <ConnectCard provider="linkedin" info={providers.data.linkedin} />
        </div>
      )}

      <section className="card">
        <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Connected accounts</h2>
        {accounts.isPending && <Spinner />}
        {accounts.error && <div className="p-4"><ErrorBox error={accounts.error} /></div>}
        {accounts.data?.length === 0 && <EmptyState title="Nothing connected yet">Use the Connect buttons above.</EmptyState>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {accounts.data?.map((a) => (
            <AccountRow key={a.id} a={a} onChanged={refresh} />
          ))}
        </ul>
      </section>

      <p className="mt-6 text-sm text-slate-500">
        Coming next on top of these connections: scheduling and publishing posts, and an inbox for Page messages, Instagram DMs and comments.
      </p>
    </>
  );
}
