import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { ConfirmButton, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";

// A customer's own email and WhatsApp sender. Campaigns start only once these are set; secrets
// are stored encrypted and never shown again: changing settings means entering them again.

export interface SenderView {
  email: { provider: string; from: string } | null;
  whatsapp: { provider: string; phoneNumberId: string | null } | null;
  webhooks: { email: string | null; whatsapp: string | null };
}

export function useSender(enabled = true) {
  return useQuery({ queryKey: ["senders"], queryFn: () => api<SenderView>("/senders"), enabled });
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="label">
        {label}
        {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Copyable({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{value}</code>
      <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(value)}>
        Copy
      </button>
    </div>
  );
}

function TestSend({ channel }: { channel: "email" | "whatsapp" }) {
  const [to, setTo] = useState("");
  const test = useMutation({ mutationFn: () => api<{ ok: boolean; provider: string }>("/senders/test", { method: "POST", body: { channel, to } }) });
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        test.mutate();
      }}
    >
      <input
        className="input w-64"
        required
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder={channel === "email" ? "your@email.com" : "+91 98765 43210"}
        aria-label="Send a test to"
      />
      <button className="btn" disabled={test.isPending}>
        {test.isPending ? "Sending…" : channel === "email" ? "Send test email" : "Send hello_world test"}
      </button>
      {test.data && <span className="text-sm text-emerald-600">Sent through {test.data.provider}.</span>}
      {test.error && <ErrorBox error={test.error} />}
    </form>
  );
}

function EmailCard({ view }: { view: SenderView }) {
  const client = useQueryClient();
  const [f, setF] = useState({
    provider: (view.email?.provider ?? "resend") as "resend" | "smtp",
    from: view.email?.from ?? "",
    replyTo: "",
    apiKey: "",
    webhookSecret: "",
    host: "",
    port: "587",
    user: "",
    password: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      api<SenderView>("/senders/email", {
        method: "PUT",
        body:
          f.provider === "resend"
            ? { provider: "resend", from: f.from, replyTo: f.replyTo || null, apiKey: f.apiKey, webhookSecret: f.webhookSecret || null }
            : { provider: "smtp", from: f.from, replyTo: f.replyTo || null, host: f.host, port: Number(f.port) || 587, user: f.user || null, password: f.password || null },
      }),
    onSuccess: (data) => {
      client.setQueryData(["senders"], data);
      setF({ ...f, apiKey: "", webhookSecret: "", password: "" });
    },
  });
  const clear = useMutation({ mutationFn: () => api<SenderView>("/senders/email", { method: "DELETE" }), onSuccess: (d) => client.setQueryData(["senders"], d) });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <section className="card mb-6 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Email sender</h2>
        {view.email ? (
          <span className="text-sm text-emerald-600">
            Connected: {view.email.provider} · {view.email.from}
          </span>
        ) : (
          <span className="text-sm text-amber-600">Not connected: email campaigns cannot start yet</span>
        )}
      </div>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service">
            <select className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value as "resend" | "smtp" })}>
              <option value="resend">Resend</option>
              <option value="smtp">SMTP (Gmail, Zoho, your host…)</option>
            </select>
          </Field>
          <Field label="From" hint='e.g. "Your Shop <hello@yourshop.in>"'>
            <input className="input" required value={f.from} onChange={set("from")} />
          </Field>
          <Field label="Reply-to" hint="optional">
            <input className="input" type="email" value={f.replyTo} onChange={set("replyTo")} />
          </Field>
          {f.provider === "resend" ? (
            <>
              <Field label="Resend API key" hint={view.email?.provider === "resend" ? "enter again to change" : undefined}>
                <input className="input" type="password" autoComplete="off" required value={f.apiKey} onChange={set("apiKey")} placeholder="re_…" />
              </Field>
              <Field label="Webhook signing secret" hint="optional, for delivery/open tracking">
                <input className="input" type="password" autoComplete="off" value={f.webhookSecret} onChange={set("webhookSecret")} placeholder="whsec_…" />
              </Field>
            </>
          ) : (
            <>
              <Field label="SMTP host">
                <input className="input" required value={f.host} onChange={set("host")} placeholder="smtp.gmail.com" />
              </Field>
              <Field label="Port" hint="587 (STARTTLS) or 465 (SSL)">
                <input className="input" type="number" min={1} max={65535} value={f.port} onChange={set("port")} />
              </Field>
              <Field label="User name">
                <input className="input" autoComplete="off" value={f.user} onChange={set("user")} />
              </Field>
              <Field label="Password / app password">
                <input className="input" type="password" autoComplete="off" value={f.password} onChange={set("password")} />
              </Field>
            </>
          )}
        </div>
        {save.error && <ErrorBox error={save.error} />}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save email sender"}
          </button>
          {view.email && <ConfirmButton label="Disconnect" confirmLabel="Disconnect email?" onConfirm={() => clear.mutate()} />}
        </div>
      </form>
      {view.email && <TestSend channel="email" />}
      {view.webhooks.email && (
        <div className="space-y-1 text-sm">
          <p className="label">Resend → Webhooks → endpoint URL</p>
          <Copyable value={view.webhooks.email} />
        </div>
      )}
      <p className="text-xs text-slate-500">Secrets are stored encrypted and never shown again. Saving replaces the previous settings.</p>
    </section>
  );
}

function WhatsAppCard({ view }: { view: SenderView }) {
  const client = useQueryClient();
  const [f, setF] = useState({ accessToken: "", phoneNumberId: view.whatsapp?.phoneNumberId ?? "", appSecret: "", verifyToken: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      api<SenderView>("/senders/whatsapp", {
        method: "PUT",
        body: { provider: "meta", accessToken: f.accessToken, phoneNumberId: f.phoneNumberId, appSecret: f.appSecret || null, verifyToken: f.verifyToken || null },
      }),
    onSuccess: (data) => {
      client.setQueryData(["senders"], data);
      setF({ ...f, accessToken: "", appSecret: "" });
    },
  });
  const clear = useMutation({ mutationFn: () => api<SenderView>("/senders/whatsapp", { method: "DELETE" }), onSuccess: (d) => client.setQueryData(["senders"], d) });

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">WhatsApp sender (Meta WhatsApp Cloud API)</h2>
        {view.whatsapp ? (
          <span className="text-sm text-emerald-600">Connected: phone number ID {view.whatsapp.phoneNumberId ?? view.whatsapp.provider}</span>
        ) : (
          <span className="text-sm text-amber-600">Not connected: WhatsApp campaigns cannot start yet</span>
        )}
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Access token" hint="permanent system-user token">
            <input className="input" type="password" autoComplete="off" required value={f.accessToken} onChange={set("accessToken")} placeholder="EAA…" />
          </Field>
          <Field label="Phone number ID">
            <input className="input" required inputMode="numeric" value={f.phoneNumberId} onChange={set("phoneNumberId")} />
          </Field>
          <Field label="App secret" hint="optional, verifies webhooks">
            <input className="input" type="password" autoComplete="off" value={f.appSecret} onChange={set("appSecret")} />
          </Field>
          <Field label="Webhook verify token" hint="optional, 8+ characters you choose">
            <input className="input" autoComplete="off" value={f.verifyToken} onChange={set("verifyToken")} />
          </Field>
        </div>
        {save.error && <ErrorBox error={save.error} />}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save WhatsApp sender"}
          </button>
          {view.whatsapp && <ConfirmButton label="Disconnect" confirmLabel="Disconnect WhatsApp?" onConfirm={() => clear.mutate()} />}
        </div>
      </form>
      {view.whatsapp && <TestSend channel="whatsapp" />}
      {view.webhooks.whatsapp && (
        <div className="space-y-1 text-sm">
          <p className="label">Meta app → WhatsApp → Configuration → Callback URL (use your verify token)</p>
          <Copyable value={view.webhooks.whatsapp} />
        </div>
      )}
    </section>
  );
}

export function SenderPage() {
  const sender = useSender();
  return (
    <>
      <PageHeader title="My sender" subtitle="Your own email and WhatsApp accounts. Your campaigns are sent from these, and their costs and limits are yours." />
      {sender.isPending && <Spinner />}
      {sender.error && <ErrorBox error={sender.error} />}
      {sender.data && (
        <>
          <EmailCard view={sender.data} />
          <WhatsAppCard view={sender.data} />
        </>
      )}
    </>
  );
}
