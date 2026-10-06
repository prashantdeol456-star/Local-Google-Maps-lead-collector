import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import type { LeadPreferences, Suppression } from "../lib/types";
import { ErrorBox } from "./ui";

export const SOURCE_LABEL: Record<string, string> = {
  unsubscribe_link: "Unsubscribe link",
  spam_complaint: "Spam report",
  stop_reply: "Replied STOP",
  whatsapp_stop: "Stopped in WhatsApp",
  whatsapp_error: "WhatsApp: stopped marketing",
  do_not_contact: "Do not contact",
  admin: "Recorded by admin",
  import: "Added to list",
};

/** A button that opens a one-line form asking for a reason (or a note) before acting. */
export function ReasonAction({
  label,
  prompt,
  placeholder,
  danger,
  pending,
  onSubmit,
}: {
  label: string;
  prompt: string;
  placeholder: string;
  danger?: boolean;
  pending: boolean;
  onSubmit: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button type="button" className={`btn px-2 py-1 text-xs ${danger ? "btn-danger" : ""}`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <form
      className="mt-2 w-full space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
      }}
    >
      <label className="block space-y-1">
        <span className="label">{prompt}</span>
        <input className="input" required minLength={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus />
      </label>
      <div className="flex gap-2">
        <button className={`btn px-2 py-1 text-xs ${danger ? "btn-danger" : "btn-primary"}`} disabled={pending}>
          {label}
        </button>
        <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({ title, status, tone, children }: { title: string; status: string; tone: "ok" | "off" | "muted"; children: ReactNode }) {
  const color =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
      : tone === "off"
        ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <div className="space-y-2 px-5 py-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${color}`}>{status}</span>
      </div>
      {children}
    </div>
  );
}

function SuppressionNote({ entries }: { entries: Suppression[] }) {
  return (
    <>
      {entries.map((s) => (
        <p key={s.id} className="text-xs text-slate-500">
          <code>{s.address}</code> blocked since {formatDate(s.createdAt)} · {SOURCE_LABEL[s.source] ?? s.source}: {s.reason}
        </p>
      ))}
    </>
  );
}

/** Email and do-not-contact settings of one lead (WhatsApp consent has its own card). */
export function PreferencesCard({ leadId, hasEmail }: { leadId: string; hasEmail: boolean }) {
  const client = useQueryClient();
  const key = ["preferences", leadId];
  const prefs = useQuery({ queryKey: key, queryFn: () => api<LeadPreferences>(`/leads/${encodeURIComponent(leadId)}/preferences`) });
  const act = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: "POST" | "DELETE"; body: Record<string, string> }) =>
      api<LeadPreferences>(`/leads/${encodeURIComponent(leadId)}/${path}`, { method, body }),
    onSuccess: (data) => {
      client.setQueryData(key, data);
      client.invalidateQueries({ queryKey: ["communications", leadId] });
    },
  });

  const d = prefs.data;
  const pref = d?.preference;
  const dnc = !!pref?.optedOut;
  const emailOff = dnc || pref?.emailAllowed === false || (d?.suppressions.email.length ?? 0) > 0;

  return (
    <section className="card mt-6">
      <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">Communication preferences</h2>
        <p className="text-xs text-slate-500">Opt-outs are also kept by email address and phone number, so they still apply if this business is collected again.</p>
      </div>
      {prefs.error && <div className="p-4"><ErrorBox error={prefs.error} /></div>}
      {act.error && <div className="p-4"><ErrorBox error={act.error} /></div>}
      {d && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <Row title="Do not contact" status={dnc ? "On" : "Off"} tone={dnc ? "off" : "muted"}>
            {dnc ? (
              <>
                <p className="text-xs text-red-600">
                  No marketing on any channel since {formatDate(pref?.optedOutAt ?? null)}: {pref?.optOutReason}
                </p>
                <ReasonAction
                  key="dnc-clear"
                  label="Clear do-not-contact"
                  prompt="Why can they be contacted again?"
                  placeholder="e.g. Called us back and asked for details"
                  pending={act.isPending}
                  onSubmit={(note) => act.mutate({ path: "do-not-contact", method: "DELETE", body: { note } })}
                />
              </>
            ) : (
              <ReasonAction
                key="dnc-set"
                label="Mark do-not-contact"
                prompt="Reason"
                placeholder="e.g. Asked not to be contacted at all"
                danger
                pending={act.isPending}
                onSubmit={(reason) => act.mutate({ path: "do-not-contact", method: "POST", body: { reason } })}
              />
            )}
          </Row>

          <Row title="Email" status={!hasEmail && !emailOff ? "No address" : emailOff ? "Opted out" : "Allowed"} tone={!hasEmail && !emailOff ? "muted" : emailOff ? "off" : "ok"}>
            <SuppressionNote entries={d.suppressions.email} />
            {!dnc &&
              (hasEmail || emailOff) &&
              (emailOff ? (
                <ReasonAction
                  key="email-in"
                  label="Allow email again"
                  prompt="Only if they asked: how?"
                  placeholder="e.g. Emailed us asking for the brochure"
                  pending={act.isPending}
                  onSubmit={(note) => act.mutate({ path: "email-opt-in", method: "POST", body: { note } })}
                />
              ) : (
                <ReasonAction
                  key="email-out"
                  label="Record email opt-out"
                  prompt="Reason"
                  placeholder="e.g. Asked on the phone not to email"
                  danger
                  pending={act.isPending}
                  onSubmit={(reason) => act.mutate({ path: "email-opt-out", method: "POST", body: { reason } })}
                />
              ))}
          </Row>

          {d.suppressions.whatsapp.length > 0 && (
            <Row title="WhatsApp numbers" status="Blocked" tone="off">
              <SuppressionNote entries={d.suppressions.whatsapp} />
            </Row>
          )}
        </div>
      )}
    </section>
  );
}
