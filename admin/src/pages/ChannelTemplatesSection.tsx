import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatNumber, formatRelative } from "../lib/format";
import { Link } from "../lib/router";
import type { ChannelTemplate, ChannelTemplatePreview, ContactTemplateChannel } from "../lib/types";

// SMS and LinkedIn message templates, filled from a contact of an uploaded sheet.

const VARIABLES = ["first_name", "name", "company", "designation", "email", "phone"];

const INFO: Record<ContactTemplateChannel, { title: string; noun: string; limit: number; starter: { name: string; body: string }; hint: string }> = {
  sms: {
    title: "SMS templates",
    noun: "SMS",
    limit: 1600,
    starter: { name: "SMS intro", body: "Hi {{first_name}}, this is <Your Name> from <Your Company>. Can we talk about {{company|your team}}'s hiring needs this week? Reply STOP to opt out." },
    hint: "160 characters per SMS (70 with Hindi or emoji). In India, promotional SMS must use a DLT-registered template and sender ID. Sending SMS is not connected yet: these are templates only.",
  },
  linkedin: {
    title: "LinkedIn message templates",
    noun: "LinkedIn message",
    limit: 8000,
    starter: {
      name: "LinkedIn intro",
      body: "Hi {{first_name}},\n\nI came across your profile and saw you're {{designation|working}} at {{company|your company}}. I'd love to connect and share how we help teams like yours.\n\nWould you be open to a short chat this week?\n\nBest,\n<Your Name>",
    },
    hint: "Sent by the LinkedIn Messenger extension from your own LinkedIn account, to people you are connected with. Keep it short and personal.",
  },
  instagram: {
    title: "Instagram message templates",
    noun: "Instagram message",
    limit: 1000,
    starter: { name: "Instagram intro", body: "Hi {{first_name}}! Loved your page. We help businesses like yours get more customers online. Can I share a quick idea?" },
    hint: "Sent by the Meta Helper extension from your own Instagram account. People who don't follow you see it under Message requests. Keep it short, personal and without links in the first message.",
  },
};

function Preview({ channel, body }: { channel: ContactTemplateChannel; body: string }) {
  const [debounced, setDebounced] = useState(body);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(body), 400);
    return () => clearTimeout(t);
  }, [body]);
  const preview = useQuery({
    queryKey: ["channel-template-preview", channel, debounced],
    queryFn: () => api<ChannelTemplatePreview>("/channel-templates/preview", { method: "POST", body: { channel, body: debounced } }),
    enabled: !!debounced.trim(),
    retry: false,
  });
  if (preview.error) return <ErrorBox error={preview.error} />;
  if (!preview.data) return <p className="text-sm text-slate-500">Preview appears here.</p>;
  const d = preview.data;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-500">Preview for {d.contact}</p>
      <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm dark:bg-slate-800/60">{d.text}</pre>
      <p className="text-xs text-slate-500">
        {formatNumber(d.characters)} / {formatNumber(d.limit)} characters
        {d.sms && ` · ${d.sms.parts} SMS part${d.sms.parts === 1 ? "" : "s"} (${d.sms.encoding})`}
      </p>
    </div>
  );
}

function Editor({ channel, template, onDone }: { channel: ContactTemplateChannel; template: ChannelTemplate | null; onDone: () => void }) {
  const client = useQueryClient();
  const info = INFO[channel];
  const [name, setName] = useState(template?.name ?? info.starter.name);
  const [body, setBody] = useState(template?.body ?? info.starter.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const save = useMutation({
    mutationFn: () =>
      template
        ? api(`/channel-templates/${template.id}`, { method: "PATCH", body: { name, body } })
        : api("/channel-templates", { method: "POST", body: { channel, name, body } }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["channel-templates", channel] });
      onDone();
    },
  });

  function insert(variable: string) {
    const el = bodyRef.current;
    const token = `{{${variable}}}`;
    if (!el) return setBody(body + token);
    const { selectionStart: s, selectionEnd: e } = el;
    setBody(body.slice(0, s) + token + body.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <>
      <PageHeader title={template ? `Edit: ${template.name}` : `New ${info.noun} template`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={submit} className="card space-y-4 p-5">
          <label className="block space-y-1">
            <span className="label">Template name</span>
            <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="label">Message</span>
            <textarea
              ref={bodyRef}
              className={`input font-mono text-sm ${channel === "sms" ? "min-h-32" : "min-h-64"}`}
              required
              maxLength={info.limit}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div>
            <p className="label mb-1">Insert variable</p>
            <div className="flex flex-wrap gap-1">
              {VARIABLES.map((v) => (
                <button key={v} type="button" className="btn px-2 py-1 text-xs" onClick={() => insert(v)}>
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Filled from each contact&apos;s sheet row. Fallback for empty values: <code>{"{{company|your company}}"}</code>.
            </p>
          </div>
          <p className="text-xs text-slate-500">{info.hint}</p>
          {save.error && <ErrorBox error={save.error} />}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save template"}
            </button>
            <button type="button" className="btn" onClick={onDone}>
              Cancel
            </button>
          </div>
        </form>
        <section className="card p-5">
          <h2 className="mb-3 font-medium">Preview</h2>
          <Preview channel={channel} body={body} />
        </section>
      </div>
    </>
  );
}

export function ChannelTemplatesSection({ channel }: { channel: ContactTemplateChannel }) {
  const client = useQueryClient();
  const info = INFO[channel];
  const [editing, setEditing] = useState<ChannelTemplate | "new" | null>(null);
  const templates = useQuery({
    queryKey: ["channel-templates", channel],
    queryFn: () => api<{ items: ChannelTemplate[] }>(`/channel-templates?channel=${channel}`).then((r) => r.items),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/channel-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["channel-templates", channel] }),
  });

  if (editing) return <Editor channel={channel} template={editing === "new" ? null : editing} onDone={() => setEditing(null)} />;

  return (
    <>
      <PageHeader
        title={info.title}
        subtitle={
          channel === "instagram" ? (
            <>
              Used by <Link to="/instagram-outreach" className="text-brand-600 hover:underline">Instagram Outreach</Link> campaigns. Variables come from your contacts.
            </>
          ) : channel === "linkedin" ? (
            <>
              Used by <Link to="/linkedin-outreach" className="text-brand-600 hover:underline">LinkedIn Outreach</Link> campaigns. Variables come from your uploaded contacts.
            </>
          ) : (
            "Reusable SMS texts with {{variables}} from your uploaded contacts."
          )
        }
        actions={
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            + New template
          </button>
        }
      />
      <div className="card">
        {templates.isPending && <Spinner />}
        {templates.error && <div className="p-4"><ErrorBox error={templates.error} /></div>}
        {remove.error && <div className="p-4"><ErrorBox error={remove.error} /></div>}
        {templates.data?.length === 0 && <EmptyState title="No templates yet">Create your first {info.noun} template.</EmptyState>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {templates.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.name}</p>
                <p className="truncate text-sm text-slate-500">{t.body.replace(/\s+/g, " ")}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">edited {formatRelative(t.updatedAt)}</span>
                <button className="btn px-2 py-1 text-xs" onClick={() => setEditing(t)}>
                  Edit
                </button>
                <ConfirmButton label="Delete" className="btn btn-danger px-2 py-1 text-xs" onConfirm={() => remove.mutate(t.id)} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
