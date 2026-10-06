import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ConfirmButton, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { formatDate, formatNumber, hostOf, safeHref } from "../lib/format";
import { Link, navigate } from "../lib/router";
import type { Attempt, CommunicationPreference, EmailEvent, Lead, LeadPreferences, WhatsAppEvent } from "../lib/types";
import { PreferencesCard } from "../components/PreferencesCard";
import { Badge } from "./EmailPage";

const EDITABLE = [
  ["name", "Name"],
  ["category", "Category"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["website", "Website"],
  ["address", "Address"],
  ["city", "City"],
  ["state", "State"],
  ["country", "Country"],
  ["postalCode", "Postal code"],
] as const;
type EditableField = (typeof EDITABLE)[number][0];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 break-words text-sm">{children ?? "—"}</dd>
    </div>
  );
}

function EditForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<EditableField, string>>(
    Object.fromEntries(EDITABLE.map(([k]) => [k, lead[k] ?? ""])) as Record<EditableField, string>,
  );
  const save = useMutation({
    mutationFn: (patch: Partial<Record<EditableField, string | null>>) =>
      api<{ lead: Lead }>(`/leads/${encodeURIComponent(lead.id)}`, { method: "PATCH", body: patch }),
    onSuccess: ({ lead: updated }) => {
      client.setQueryData(["lead", lead.id], updated);
      client.invalidateQueries({ queryKey: ["leads"] });
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    // Send only changed fields; an emptied field becomes null.
    const patch: Partial<Record<EditableField, string | null>> = {};
    for (const [k] of EDITABLE) {
      const next = values[k].trim();
      if (next !== (lead[k] ?? "")) patch[k] = next === "" && k !== "name" ? null : next;
    }
    if (Object.keys(patch).length === 0) return onDone();
    save.mutate(patch);
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {EDITABLE.map(([key, label]) => (
          <label key={key} className={`block space-y-1 ${key === "address" ? "sm:col-span-2" : ""}`}>
            <span className="label">{label}</span>
            <input
              className="input"
              type={key === "email" ? "email" : "text"}
              required={key === "name"}
              value={values[key]}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {save.error && <ErrorBox error={save.error} />}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Edited phone, website, name and address are also used to recognise this lead in future collections.
      </p>
    </form>
  );
}

export function LeadDetailPage({ id }: { id: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const lead = useQuery({ queryKey: ["lead", id], queryFn: () => api<{ lead: Lead }>(`/leads/${encodeURIComponent(id)}`).then((r) => r.lead) });
  const remove = useMutation({
    mutationFn: () => api(`/leads/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["leads"] });
      navigate("/leads");
    },
  });

  if (lead.isPending) return <Spinner />;
  if (lead.error) {
    return (
      <>
        <PageHeader title="Lead" />
        <ErrorBox error={lead.error instanceof ApiError && lead.error.status === 404 ? new Error("This lead does not exist (it may have been deleted).") : lead.error} />
        <Link to="/leads" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          ← Back to leads
        </Link>
      </>
    );
  }

  const l = lead.data;
  const website = safeHref(l.website);
  const maps = safeHref(l.mapsUrl);

  return (
    <>
      <Link to="/leads" className="mb-3 inline-block text-sm text-slate-500 hover:text-brand-600">
        ← Leads
      </Link>
      <PageHeader
        title={l.name}
        subtitle={[l.category, l.city, l.rating !== null ? `★ ${l.rating} (${formatNumber(l.reviewCount)} reviews)` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            {maps && (
              <a className="btn" href={maps} target="_blank" rel="noopener noreferrer">
                Open in Maps ↗
              </a>
            )}
            {!editing && (
              <button className="btn btn-primary" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <ConfirmButton label="Delete" confirmLabel="Delete lead" onConfirm={() => remove.mutate()} disabled={remove.isPending} />
          </>
        }
      />
      {remove.error && <ErrorBox error={remove.error} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Contact details</h2>
          {editing ? (
            <EditForm lead={l} onDone={() => setEditing(false)} />
          ) : (
            <dl className="grid gap-5 p-5 sm:grid-cols-2">
              <Field label="Phone">{l.phone && <a className="text-brand-600 hover:underline" href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>{l.phone}</a>}</Field>
              <Field label="Email">{l.email && <a className="text-brand-600 hover:underline" href={`mailto:${l.email}`}>{l.email}</a>}</Field>
              <Field label="Website">
                {website ? (
                  <a className="text-brand-600 hover:underline" href={website} target="_blank" rel="noopener noreferrer nofollow">
                    {hostOf(l.website)}
                  </a>
                ) : (
                  l.website
                )}
              </Field>
              <Field label="Category">{l.category}</Field>
              <div className="sm:col-span-2">
                <Field label="Address">{l.address}</Field>
              </div>
              <Field label="City">{l.city}</Field>
              <Field label="State">{l.state}</Field>
              <Field label="Country">{l.country}</Field>
              <Field label="Postal code">{l.postalCode}</Field>
            </dl>
          )}
        </section>

        <section className="card">
          <h2 className="border-b border-slate-200 px-5 py-3 font-medium dark:border-slate-800">Source</h2>
          <dl className="space-y-4 p-5">
            <Field label="Search keyword">{l.searchKeyword}</Field>
            <Field label="Source">{l.source}</Field>
            <Field label="Google place ID">{l.placeId && <code className="text-xs">{l.placeId}</code>}</Field>
            <Field label="Coordinates">{l.latitude !== null && l.longitude !== null ? `${l.latitude}, ${l.longitude}` : null}</Field>
            <Field label="First seen">{formatDate(l.firstSeenAt)}</Field>
            <Field label="Last seen">{formatDate(l.lastSeenAt)}</Field>
            <Field label="Last edited">{formatDate(l.updatedAt)}</Field>
          </dl>
        </section>
      </div>

      <PreferencesCard leadId={l.id} hasEmail={!!l.email} />
      <WhatsAppConsent leadId={l.id} hasPhone={!!l.phone} />
      <CommunicationHistory leadId={l.id} />
    </>
  );
}

interface Communications {
  attempts: Attempt[];
  events: EmailEvent[];
  preference: CommunicationPreference | null;
  whatsappEvents: WhatsAppEvent[];
}

function useCommunications(leadId: string) {
  return useQuery({
    queryKey: ["communications", leadId],
    queryFn: () => api<Communications>(`/leads/${encodeURIComponent(leadId)}/communications`),
  });
}

/** WhatsApp consent: campaigns only reach leads whose opt-in has been recorded here. */
function WhatsAppConsent({ leadId, hasPhone }: { leadId: string; hasPhone: boolean }) {
  const client = useQueryClient();
  const history = useCommunications(leadId);
  // Same query as the Communication preferences card (shared cache).
  const blocked = useQuery({
    queryKey: ["preferences", leadId],
    queryFn: () => api<LeadPreferences>(`/leads/${encodeURIComponent(leadId)}/preferences`),
  }).data?.suppressions.whatsapp;
  const [source, setSource] = useState("");
  const [open, setOpen] = useState(false);
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["communications", leadId] });
    client.invalidateQueries({ queryKey: ["preferences", leadId] });
  };
  const record = useMutation({
    mutationFn: () => api(`/leads/${encodeURIComponent(leadId)}/whatsapp-opt-in`, { method: "POST", body: { source } }),
    onSuccess: () => {
      setOpen(false);
      setSource("");
      refresh();
    },
  });
  const withdraw = useMutation({
    mutationFn: () => api(`/leads/${encodeURIComponent(leadId)}/whatsapp-opt-in`, { method: "DELETE", body: { reason: "Withdrawn by admin" } }),
    onSuccess: refresh,
  });
  const pref = history.data?.preference;
  const allowed = !!pref && pref.whatsappAllowed && !!pref.whatsappOptInAt && !pref.optedOut;
  // Newest first: the most recent opt-out (STOP reply, stopped in WhatsApp, recorded by admin…).
  const lastOptOut = history.data?.whatsappEvents.find((e) => e.type === "opted_out");
  const withdrawn = !allowed && (!!pref?.whatsappOptInAt || !!lastOptOut || !!pref?.optedOut);

  return (
    <section className="card mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">WhatsApp consent</h2>
        {allowed ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Opted in</span>
        ) : withdrawn ? (
          <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">Opted out</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">No opt-in</span>
        )}
      </div>
      <div className="space-y-3 p-5 text-sm">
        {history.error && <ErrorBox error={history.error} />}
        {pref?.whatsappOptInAt && (
          <p>
            {allowed ? "Opted in" : "Had opted in"} on {formatDate(pref.whatsappOptInAt)}: <span className="text-slate-600 dark:text-slate-300">{pref.whatsappOptInSource}</span>
          </p>
        )}
        {withdrawn && lastOptOut && (
          <p className="text-red-600">
            Opted out on {formatDate(lastOptOut.occurredAt)}: {lastOptOut.metadata?.reason ?? "no reason recorded"}. Record a new opt-in only if they asked to receive
            messages again.
          </p>
        )}
        {!pref?.whatsappOptInAt && !withdrawn && (
          <p className="text-slate-500">
            This lead gets no WhatsApp campaign messages until you record that they agreed to receive them. A number listed on Google Maps is not
            an opt-in.
          </p>
        )}
        {!allowed && blocked && blocked.length > 0 && (
          <p className="text-xs text-red-600">
            {blocked.map((b) => `${b.address} opted out on ${formatDate(b.createdAt)} (${b.reason})`).join("; ")}. Record an opt-in only if they asked to receive
            WhatsApp messages again; it lifts this block.
          </p>
        )}
        {record.error && <ErrorBox error={record.error} />}
        {withdraw.error && <ErrorBox error={withdraw.error} />}
        {allowed ? (
          <ConfirmButton label="Record opt-out" confirmLabel="They no longer want WhatsApp" className="btn px-2 py-1 text-xs" onConfirm={() => withdraw.mutate()} disabled={withdraw.isPending} />
        ) : pref?.optedOut ? (
          <p className="text-xs text-slate-500">Do-not-contact is on (see Communication preferences): no WhatsApp opt-in can be recorded.</p>
        ) : open ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              record.mutate();
            }}
          >
            <label className="block space-y-1">
              <span className="label">How did they agree?</span>
              <input
                className="input"
                required
                minLength={3}
                maxLength={300}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Asked us to send details on WhatsApp during a call on 6 Oct"
              />
            </label>
            <div className="flex gap-2">
              <button className="btn btn-primary px-2 py-1 text-xs" disabled={record.isPending}>
                Save opt-in
              </button>
              <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn px-2 py-1 text-xs" disabled={!hasPhone} title={hasPhone ? undefined : "Add a phone number first"} onClick={() => setOpen(true)}>
            {withdrawn ? "Record a new opt-in" : "Record opt-in"}
          </button>
        )}
      </div>
    </section>
  );
}

function CommunicationHistory({ leadId }: { leadId: string }) {
  const history = useCommunications(leadId);
  const pref = history.data?.preference;
  const waEvents = history.data?.whatsappEvents ?? [];
  const waEventsFor = (attemptId: string) => waEvents.filter((e) => e.attemptId === attemptId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const otherWa = waEvents.filter((e) => !e.attemptId);
  const eventsFor = (attemptId: string) =>
    (history.data?.events ?? []).filter((e) => e.attemptId === attemptId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return (
    <section className="card mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h2 className="font-medium">Communication history</h2>
        {pref && !pref.emailAllowed && (
          <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
            Unsubscribed from email {pref.optedOutAt ? `on ${formatDate(pref.optedOutAt)}` : ""}
          </span>
        )}
      </div>
      {history.error && <div className="p-4"><ErrorBox error={history.error} /></div>}
      {history.data?.attempts.length === 0 && <p className="px-5 py-6 text-sm text-slate-500">No emails or WhatsApp messages yet.</p>}
      <ol className="divide-y divide-slate-100 dark:divide-slate-800">
        {history.data?.attempts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
            <div className="min-w-0">
              {a.channel === "whatsapp" ? (
                <p>
                  <span aria-hidden>✆ </span>
                  <span className="font-medium">WhatsApp</span>
                  {a.renderedBody && <span className="mt-1 block whitespace-pre-wrap text-slate-600 dark:text-slate-300">{a.renderedBody}</span>}
                </p>
              ) : (
                <p>
                  <span aria-hidden>✉ </span>
                  <span className="font-medium">{a.renderedSubject ?? "(not sent yet)"}</span>
                </p>
              )}
              <p className="text-xs text-slate-500">
                {a.campaignId ? (
                  <Link to={`/${a.channel === "whatsapp" ? "whatsapp" : "email"}/${a.campaignId}`} className="hover:text-brand-600">
                    {a.campaignName}
                  </Link>
                ) : (
                  "—"
                )}{" "}
                · to {a.toAddress}
              </p>
              {a.error && <p className="text-xs text-red-600">{a.error}</p>}
              {a.channel === "whatsapp" ? <WhatsAppTimeline events={waEventsFor(a.id)} /> : <EventTimeline events={eventsFor(a.id)} />}
              {a.sentAt && a.channel === "email" && <LogReply attemptId={a.id} leadId={leadId} />}
            </div>
            <div className="flex items-center gap-2">
              <time className="text-xs text-slate-500">{formatDate(a.sentAt ?? a.createdAt)}</time>
              <Badge status={a.status} />
            </div>
          </li>
        ))}
      </ol>
      {otherWa.length > 0 && (
        <div className="border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-800">
          <p className="label mb-1">Other WhatsApp activity</p>
          <WhatsAppTimeline events={otherWa} />
        </div>
      )}
    </section>
  );
}

const WA_EVENT_LABEL: Record<WhatsAppEvent["type"], string> = {
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  received: "Message received",
  opted_out: "Opted out of WhatsApp",
  marketing_resumed: "Resumed marketing messages in WhatsApp (opt-in not restored automatically)",
};

function WhatsAppTimeline({ events }: { events: WhatsAppEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
      {events.map((e) => (
        <li key={e.id} className="text-xs">
          <span className={`font-medium ${e.type === "failed" || e.type === "opted_out" ? "text-red-600" : ""}`}>{WA_EVENT_LABEL[e.type]}</span>
          <span className="text-slate-500"> · {formatDate(e.occurredAt)}</span>
          {e.metadata?.error && <span className="block text-red-600">{e.metadata.error}</span>}
          {e.metadata?.reason && <span className="block text-slate-500">{e.metadata.reason}</span>}
          {e.type === "received" && (
            <span className="mt-0.5 block whitespace-pre-wrap rounded bg-emerald-50 p-2 text-slate-700 dark:bg-emerald-950/40 dark:text-slate-200">
              {e.text ?? `(${e.metadata?.messageType ?? "non-text"} message: open WhatsApp to see it)`}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const EVENT_LABEL: Record<EmailEvent["type"], string> = {
  sent: "Sent",
  delivered: "Delivered",
  delivery_delayed: "Delivery delayed",
  opened: "Opened (approx.)",
  clicked: "Clicked",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  replied: "Replied",
  unsubscribed: "Unsubscribed",
};

function EventTimeline({ events }: { events: EmailEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
      {events.map((e) => {
        const m = e.metadata as { link?: string; message?: string; bounce?: { message?: string } } | null;
        return (
          <li key={e.id} className="text-xs">
            <span className="font-medium">{EVENT_LABEL[e.type]}</span>
            <span className="text-slate-500"> · {formatDate(e.occurredAt)}</span>
            {m?.link && <span className="block break-all text-slate-500">{m.link}</span>}
            {m?.bounce?.message && <span className="block text-red-600">{m.bounce.message}</span>}
            {m?.message && <span className="mt-0.5 block whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{m.message}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Records a reply the admin received (automatic reply detection needs inbound email / IMAP). */
function LogReply({ attemptId, leadId }: { attemptId: string; leadId: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/email/attempts/${attemptId}/reply`, { method: "POST", body: { message } }),
    onSuccess: () => {
      setOpen(false);
      setMessage("");
      client.invalidateQueries({ queryKey: ["communications", leadId] });
    },
  });
  if (!open) {
    return (
      <button type="button" className="mt-2 text-xs text-brand-600 hover:underline" onClick={() => setOpen(true)}>
        + Log a reply
      </button>
    );
  }
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <textarea className="input min-h-20 text-sm" required maxLength={10000} placeholder="Paste or summarise their reply" value={message} onChange={(e) => setMessage(e.target.value)} />
      {save.error && <ErrorBox error={save.error} />}
      <div className="flex gap-2">
        <button className="btn btn-primary px-2 py-1 text-xs" disabled={save.isPending}>
          Save reply
        </button>
        <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
