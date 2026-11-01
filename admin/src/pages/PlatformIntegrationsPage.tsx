import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { Link } from "../lib/router";

// Super admin: every integration in one place. Razorpay, the Meta app and the LinkedIn app are
// entered here (stored encrypted, active immediately); the rest shows where it is set up.

type Source = "panel" | "env" | null;
interface Status {
  razorpay: { source: Source; keyId: string | null; mode: "test" | "live" | null; webhookSecretSet: boolean; webhookUrl: string };
  meta: { source: Source; appId: string | null; redirectUrl: string };
  linkedin: { source: Source; clientId: string | null; redirectUrl: string };
}

function Badge({ source }: { source: Source }) {
  if (source === "panel") return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Connected</span>;
  if (source === "env") return <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700">Connected (from Render settings)</span>;
  return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Not set up</span>;
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">{value}</code>
      <button type="button" className="btn h-8" onClick={() => void navigator.clipboard.writeText(value).then(() => setDone(true))}>
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Card({ title, source, children, steps }: { title: string; source: Source; children: ReactNode; steps: ReactNode[] }) {
  return (
    <section className="card grid gap-6 p-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Badge source={source} />
        </div>
        {children}
      </div>
      <ol className="list-decimal space-y-1.5 rounded-xl bg-[#f6f9f7] p-4 pl-8 text-sm text-slate-700 dark:bg-[#0d241b] dark:text-slate-300">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </section>
  );
}

interface Field {
  name: string;
  label: string;
  secret?: boolean;
  value?: string | null;
  placeholder?: string;
}

function KeysForm({ provider, fields, saved, extra }: { provider: "razorpay" | "meta" | "linkedin"; fields: Field[]; saved: boolean; extra?: ReactNode }) {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.secret ? "" : (f.value ?? "")])));
  const done = (data: Status) => {
    client.setQueryData(["platform-integrations"], data);
    setValues((v) => Object.fromEntries(Object.entries(v).map(([k, val]) => [k, fields.find((f) => f.name === k)?.secret ? "" : val])));
  };
  const save = useMutation({ mutationFn: () => api<Status>(`/platform-integrations/${provider}`, { method: "PUT", body: values }), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api<Status>(`/platform-integrations/${provider}`, { method: "DELETE" }), onSuccess: done });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="block space-y-1">
            <span className="label">{f.label}</span>
            <input
              className="input font-mono"
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              value={values[f.name] ?? ""}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              placeholder={f.secret && saved ? "Saved — leave empty to keep" : f.placeholder}
            />
          </label>
        ))}
      </div>
      {extra}
      {(save.error || remove.error) && <ErrorBox error={save.error ?? remove.error} />}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {saved && (
          <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove keys
          </button>
        )}
        {save.isSuccess && <span className="text-sm text-emerald-700">Saved and active now.</span>}
      </div>
      <p className="text-xs text-slate-500">Keys are stored encrypted and never shown again. Saved keys here replace the same settings in Render.</p>
    </form>
  );
}

function RazorpayTest() {
  const test = useMutation({ mutationFn: () => api<{ ok: boolean; mode: string }>("/platform-integrations/razorpay/test", { method: "POST" }) });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn" disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? "Checking…" : "Test connection"}
      </button>
      {test.data && <span className="text-sm text-emerald-700">Razorpay accepted the keys ({test.data.mode} mode).</span>}
      {test.error && <ErrorBox error={test.error} />}
    </div>
  );
}

const OTHERS: [string, string, ReactNode][] = [
  ["Customers' email & WhatsApp", "Each customer connects their own Resend/SMTP and Meta WhatsApp number.", <Link to="/sender" className="text-brand-600 hover:underline">My sender (customers)</Link>],
  ["AI Inbox (Claude / Gemini, Telegram)", "Each user enters their own AI key and Telegram bot.", <Link to="/inbox" className="text-brand-600 hover:underline">AI Inbox → Setup</Link>],
  ["Webhooks & n8n", "Send platform events to n8n or any webhook, and API tokens for it.", <Link to="/integrations" className="text-brand-600 hover:underline">Webhooks & n8n</Link>],
  ["Website, SEO & contact details", "Brand, phone, address, social links; sitemap for Google Search Console.", <Link to="/website" className="text-brand-600 hover:underline">Website</Link>],
  ["Chrome extensions", "Maps Data Collector and LinkedIn Helper downloads for customers.", <Link to="/extensions" className="text-brand-600 hover:underline">Extensions</Link>],
  ["Server (Render)", "DATABASE_URL, SESSION_SECRET, PUBLIC_BASE_URL and the super admin's own .env senders stay in Render → Environment.", <a href="https://dashboard.render.com" target="_blank" rel="noopener" className="text-brand-600 hover:underline">Render dashboard ↗</a>],
];

export function PlatformIntegrationsPage() {
  const status = useQuery({ queryKey: ["platform-integrations"], queryFn: () => api<Status>("/platform-integrations") });
  if (status.error) return <ErrorBox error={status.error} />;
  if (!status.data) return <Spinner />;
  const s = status.data;
  return (
    <>
      <PageHeader title="Integrations" subtitle="Every outside service the platform uses. Keys entered here are encrypted and work immediately — no Render change or restart needed." />
      <div className="space-y-6">
        <Card
          title="Razorpay — online recharge"
          source={s.razorpay.source}
          steps={[
            <>Sign up at razorpay.com and complete KYC (needed for live payments; test mode works at once).</>,
            <>Dashboard → switch on <b>Test mode</b> → Account & Settings → <b>API Keys</b> → Generate Key. Copy the Key ID (rzp_test_…) and Key Secret here.</>,
            <>Account & Settings → <b>Webhooks</b> → Add New Webhook: paste the Webhook URL below, choose a secret, tick <b>payment.captured</b> and <b>payment.failed</b>. Enter the same secret here.</>,
            <>Save, then “Test connection”. Try a recharge from a customer account with Razorpay's test UPI/card.</>,
            <>Going live: generate live keys (rzp_live_…), add the webhook again in live mode, and save the live values here.</>,
          ]}
        >
          {s.razorpay.mode && (
            <p className="text-sm">
              Mode: <b className={s.razorpay.mode === "live" ? "text-emerald-700" : "text-amber-700"}>{s.razorpay.mode === "live" ? "Live — real payments" : "Test — no real money"}</b>
              {!s.razorpay.webhookSecretSet && <span className="ml-2 text-amber-700">· Webhook secret missing (payments still work from the browser)</span>}
            </p>
          )}
          <KeysForm
            provider="razorpay"
            saved={s.razorpay.source === "panel"}
            fields={[
              { name: "keyId", label: "Key ID", value: s.razorpay.keyId, placeholder: "rzp_test_…" },
              { name: "keySecret", label: "Key Secret", secret: true },
              { name: "webhookSecret", label: "Webhook secret", secret: true },
            ]}
            extra={
              <div className="space-y-1">
                <span className="label">Webhook URL (paste in Razorpay)</span>
                <Copy value={s.razorpay.webhookUrl} />
              </div>
            }
          />
          {s.razorpay.source && <RazorpayTest />}
        </Card>

        <Card
          title="Facebook & Instagram app (Meta)"
          source={s.meta.source}
          steps={[
            <>developers.facebook.com → My Apps → Create app (type Business) and add <b>Facebook Login for Business</b>.</>,
            <>Facebook Login → Settings → Valid OAuth Redirect URIs: paste the Redirect URL below.</>,
            <>App settings → Basic: copy the <b>App ID</b> and <b>App Secret</b> here and Save.</>,
            <>Customers can then click Connect on Social Accounts; their Page and Instagram chats appear in the AI Inbox.</>,
          ]}
        >
          <KeysForm
            provider="meta"
            saved={s.meta.source === "panel"}
            fields={[
              { name: "appId", label: "App ID", value: s.meta.appId, placeholder: "1234567890" },
              { name: "appSecret", label: "App Secret", secret: true },
            ]}
            extra={
              <div className="space-y-1">
                <span className="label">Redirect URL</span>
                <Copy value={s.meta.redirectUrl} />
              </div>
            }
          />
        </Card>

        <Card
          title="LinkedIn app"
          source={s.linkedin.source}
          steps={[
            <>linkedin.com/developers → Create app (needs a LinkedIn company page).</>,
            <>Products: add <b>Sign In with LinkedIn using OpenID Connect</b> and <b>Share on LinkedIn</b>.</>,
            <>Auth → Authorized redirect URLs: paste the Redirect URL below.</>,
            <>Copy the <b>Client ID</b> and <b>Client Secret</b> here and Save.</>,
          ]}
        >
          <KeysForm
            provider="linkedin"
            saved={s.linkedin.source === "panel"}
            fields={[
              { name: "clientId", label: "Client ID", value: s.linkedin.clientId, placeholder: "86abc…" },
              { name: "clientSecret", label: "Client Secret", secret: true },
            ]}
            extra={
              <div className="space-y-1">
                <span className="label">Redirect URL</span>
                <Copy value={s.linkedin.redirectUrl} />
              </div>
            }
          />
        </Card>

        <section className="card">
          <h2 className="border-b border-slate-200 px-5 py-3 font-semibold dark:border-slate-800">Other integrations</h2>
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {OTHERS.map(([name, what, where]) => (
                <tr key={name}>
                  <td className="td font-semibold">{name}</td>
                  <td className="td text-slate-600 dark:text-slate-300">{what}</td>
                  <td className="td whitespace-nowrap">{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
