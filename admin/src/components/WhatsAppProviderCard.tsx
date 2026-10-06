import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { ErrorBox, Spinner } from "./ui";

interface Info {
  provider: "log" | "meta";
  sendsRealMessages: boolean;
  sender: string;
  capabilities: Record<string, boolean>;
  details: Record<string, string | null>;
  webhook: { url: string | null; verifyTokenSet: boolean; appSecretSet: boolean };
}

export function WhatsAppProviderCard() {
  const info = useQuery({ queryKey: ["whatsapp-provider"], queryFn: () => api<Info>("/whatsapp/provider") });
  const [to, setTo] = useState("");
  const [templateName, setTemplateName] = useState("hello_world");
  const [language, setLanguage] = useState("en_US");
  const [params, setParams] = useState("");
  const test = useMutation({
    mutationFn: () =>
      api<{ externalMessageId: string; sentReal: boolean; to: string }>("/whatsapp/send-test", {
        method: "POST",
        body: {
          to,
          templateName: templateName.trim(),
          language: language.trim(),
          params: params
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((value) => ({ value })),
        },
      }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    test.mutate();
  }

  return (
    <section className="card mb-6">
      <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">WhatsApp provider</h2>
        <p className="text-xs text-slate-500">Configured in backend/.env (WHATSAPP_PROVIDER, META_WA_…). Secrets are never shown here.</p>
      </div>
      {info.isPending && <Spinner />}
      {info.error && <div className="p-4"><ErrorBox error={info.error} /></div>}
      {info.data && (
        <div className="space-y-5 p-5 text-sm">
          {!info.data.sendsRealMessages && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Development mode: WhatsApp messages are only recorded, nothing is delivered. Set <code>WHATSAPP_PROVIDER=meta</code> with your Cloud API
              credentials to send real messages.
            </p>
          )}
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            WhatsApp only allows business-initiated messages with <strong>templates approved by Meta</strong>, and only to people who have{" "}
            <strong>opted in</strong> to hear from you. Phone numbers found on Google Maps are not an opt-in; campaigns only send to leads
            with an opt-in recorded on their page.
          </p>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="label">Provider</dt>
              <dd className="mt-1 font-medium">{info.data.provider === "meta" ? "Meta WhatsApp Cloud API" : "Development (no sending)"}</dd>
            </div>
            {Object.entries(info.data.details)
              .filter(([k]) => k !== "note")
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="label">{k}</dt>
                  <dd className="mt-1 break-all">{v ?? "—"}</dd>
                </div>
              ))}
          </dl>

          {info.data.provider === "meta" && (
            <div className="space-y-1 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
              <p className="label">Webhook (delivery, read and replies)</p>
              {info.data.webhook.url ? (
                <ol className="list-decimal space-y-0.5 pl-5 text-slate-600 dark:text-slate-300">
                  <li>
                    In your Meta app → WhatsApp → Configuration → Webhook, set Callback URL: <code className="break-all">{info.data.webhook.url}</code>
                  </li>
                  <li>
                    Verify token: the value of <code>META_WA_VERIFY_TOKEN</code> {info.data.webhook.verifyTokenSet ? "(set)" : <span className="text-amber-600">(not set yet)</span>}
                  </li>
                  <li>
                    Subscribe to the <code>messages</code> and <code>user_preferences</code> fields. Signatures are checked with{" "}
                    <code>META_WA_APP_SECRET</code>{" "}
                    {info.data.webhook.appSecretSet ? "(set)" : <span className="text-amber-600">(not set yet)</span>}.
                  </li>
                </ol>
              ) : (
                <p className="text-amber-600">Set PUBLIC_BASE_URL to get the webhook address.</p>
              )}
            </div>
          )}

          <form onSubmit={submit} className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 dark:border-slate-800">
            <p className="label sm:col-span-2">Send an approved template to your own number</p>
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">Mobile number (with country code)</span>
              <input className="input" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="+91 98765 43210" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">Template name</span>
              <input className="input" required value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">Language code</span>
              <input className="input" required value={language} onChange={(e) => setLanguage(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">Body values, one per line (for {"{{1}}"}, {"{{2}}"}…)</span>
              <textarea className="input min-h-16" value={params} onChange={(e) => setParams(e.target.value)} />
            </label>
            <div className="sm:col-span-2">
              <button className="btn btn-primary" disabled={test.isPending}>
                {test.isPending ? "Sending…" : "Send test message"}
              </button>
            </div>
          </form>
          {test.error && <ErrorBox error={test.error} />}
          {test.data && (
            <p className="text-emerald-700 dark:text-emerald-400" role="status">
              {test.data.sentReal
                ? `Accepted by WhatsApp for ${test.data.to} (id ${test.data.externalMessageId}). Delivery is confirmed by webhook.`
                : `Recorded by the development provider for ${test.data.to}; nothing was delivered.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
