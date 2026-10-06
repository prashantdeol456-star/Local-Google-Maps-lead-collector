import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatRelative } from "../lib/format";
import type { EmailTemplate, RenderedPreview } from "../lib/types";

const VARIABLES = ["name", "category", "city", "state", "country", "website", "phone"];

const STARTER = {
  name: "Website improvement intro",
  subject: "Website improvement for {{name}}",
  body: "Hello {{name}} team,\n\nWe help {{category|businesses}} in {{city|your city}} get more enquiries through a faster, mobile-friendly website.\n\nWould you be open to a 10-minute call this week?\n\nRegards,\nYour Name\nYour Company",
};

/** Renders the template with sample (or real) lead data as you type. */
export function TemplatePreview({ subject, body }: { subject: string; body: string }) {
  const [debounced, setDebounced] = useState({ subject, body });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ subject, body }), 400);
    return () => clearTimeout(t);
  }, [subject, body]);
  const preview = useQuery({
    queryKey: ["template-preview", debounced],
    queryFn: () => api<RenderedPreview>("/templates/preview", { method: "POST", body: debounced }),
    enabled: !!(debounced.subject || debounced.body),
    retry: false,
  });
  if (preview.error) return <ErrorBox error={preview.error} />;
  if (!preview.data) return <p className="text-sm text-slate-500">Preview appears here.</p>;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-500">Preview for {preview.data.lead}</p>
      <p>
        <span className="label">Subject: </span>
        {preview.data.subject}
      </p>
      <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm dark:bg-slate-800/60">{preview.data.text}</pre>
    </div>
  );
}

function Editor({ template, onDone }: { template: EmailTemplate | null; onDone: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(template?.name ?? STARTER.name);
  const [subject, setSubject] = useState(template?.subject ?? STARTER.subject);
  const [body, setBody] = useState(template?.body ?? STARTER.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const save = useMutation({
    mutationFn: () =>
      template
        ? api(`/templates/${template.id}`, { method: "PATCH", body: { name, subject, body } })
        : api("/templates", { method: "POST", body: { name, subject, body } }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["templates"] });
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
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={submit} className="card space-y-4 p-5">
        <label className="block space-y-1">
          <span className="label">Template name</span>
          <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="label">Subject</span>
          <input className="input" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="label">Message (plain text)</span>
          <textarea ref={bodyRef} className="input min-h-64 font-mono text-sm" required maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
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
            Fallback for empty values: <code>{"{{city|your city}}"}</code>. An unsubscribe link is added automatically to every email.
          </p>
        </div>
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
        <TemplatePreview subject={subject} body={body} />
      </section>
    </div>
  );
}

export function TemplatesPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<EmailTemplate | "new" | null>(null);
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<{ items: EmailTemplate[] }>("/templates").then((r) => r.items) });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["templates"] }),
  });

  if (editing) {
    return (
      <>
        <PageHeader title={editing === "new" ? "New email template" : `Edit: ${editing.name}`} />
        <Editor template={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Email templates"
        subtitle="Reusable messages with {{variables}} filled from each lead"
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
        {templates.data?.length === 0 && <EmptyState title="No templates yet">Create one to start an email campaign.</EmptyState>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {templates.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="font-medium">{t.name}</p>
                <p className="truncate text-sm text-slate-500">{t.subject}</p>
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
