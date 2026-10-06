import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorBox, Spinner } from "./ui";

interface AiStatus {
  enabled: boolean;
  provider: "off" | "anthropic";
  model: string | null;
  maxStepsPerJob: number;
  apiKey: string | null;
}

/** Optional AI navigation for the collector: status only (configured in backend/.env). */
export function AiNavigationCard() {
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api<AiStatus>("/ai/status") });
  const s = status.data;
  return (
    <section className="card mb-6">
      <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">AI navigation (optional)</h2>
        <p className="text-xs text-slate-500">Configured in backend/.env (AI_PROVIDER, ANTHROPIC_API_KEY, AI_MODEL). The key never leaves the backend.</p>
      </div>
      {status.isPending && <Spinner />}
      {status.error && <div className="p-4"><ErrorBox error={status.error} /></div>}
      {s && (
        <div className="space-y-4 p-5 text-sm">
          {s.enabled ? (
            <dl className="grid gap-4 sm:grid-cols-4">
              {[
                ["Provider", "Anthropic (Claude)"],
                ["Model", s.model],
                ["API key", s.apiKey],
                ["Steps per job", String(s.maxStepsPerJob)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="label">{k}</dt>
                  <dd className="mt-1 break-all">{v ?? "—"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              Off. The collector works without AI. To allow it, set <code>AI_PROVIDER=anthropic</code> and <code>ANTHROPIC_API_KEY</code> in backend/.env and
              restart the backend; then tick “AI assist” in the extension for the searches where you want it.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
            <li>Used only when the normal collector cannot find the results list, and only if “AI assist” is ticked for that search.</li>
            <li>The AI picks one step at a time from a fixed list (click a listed control, scroll, go back, reopen the job’s own search, stop). It never gets selectors, code or text to type.</li>
            <li>Sign-in, consent and CAPTCHA pages always pause the job for you; the AI is never asked about them.</li>
            <li>Page text is treated as untrusted. Emails and phone numbers are masked before anything is sent.</li>
            <li>Every step is logged on the collection. Duplicates, normalization, storage and exports never use AI.</li>
          </ul>
        </div>
      )}
    </section>
  );
}
