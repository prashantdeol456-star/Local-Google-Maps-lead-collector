import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatRelative } from "../lib/format";
import { Link } from "../lib/router";
import type { ApprovalStatus, WhatsAppPreview, WhatsAppTemplate } from "../lib/types";

const VARIABLES = ["name", "category", "city", "state", "country", "website", "phone"];
const STATUSES: ApprovalStatus[] = ["pending", "approved", "rejected", "paused", "disabled"];

const STATUS_STYLE: Record<ApprovalStatus, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  rejected: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  disabled: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export function ApprovalBadge({ status }: { status: ApprovalStatus | null }) {
  const s = status ?? "pending";
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[s]}`}>{s}</span>;
}

const STARTER = {
  name: "website_intro",
  language: "en",
  category: "marketing" as const,
  paramFormat: "positional" as const,
  body: "Hello {{name}}, we help {{category|businesses}} in {{city|your city}} get more enquiries with a fast, mobile-friendly website. Would you like a free review of your current site? Reply STOP to opt out.",
  externalTemplateId: "",
  approvalStatus: "pending" as ApprovalStatus,
};

/** The message for a lead, and the body exactly as it must be entered in WhatsApp Manager. */
export function WhatsAppTemplatePreview({ body, paramFormat }: { body: string; paramFormat: "positional" | "named" }) {
  const [debounced, setDebounced] = useState({ body, paramFormat });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ body, paramFormat }), 400);
    return () => clearTimeout(t);
  }, [body, paramFormat]);
  const preview = useQuery({
    queryKey: ["wa-template-preview", debounced],
    queryFn: () => api<WhatsAppPreview>("/whatsapp/templates/preview", { method: "POST", body: debounced }),
    enabled: !!debounced.body,
    retry: false,
  });
  if (preview.error) return <ErrorBox error={preview.error} />;
  if (!preview.data) return <p className="text-sm text-slate-500">Preview appears here.</p>;
  const p = preview.data;
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="mb-1 text-xs text-slate-500">Message for {p.lead}</p>
        <p className="whitespace-pre-wrap rounded-lg rounded-tl-none bg-emerald-50 p-3 text-slate-800 dark:bg-emerald-950/40 dark:text-slate-100">{p.text}</p>
        {p.missing.length > 0 && (
          <p className="mt-1 text-xs text-amber-600">
            No value for {p.missing.map((v) => `{{${v}}}`).join(", ")}: leads like this are skipped unless you add a fallback, e.g. {"{{city|your city}}"}.
          </p>
        )}
      </div>
      <div>
        <p className="label mb-1">Body in WhatsApp Manager</p>
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-xs dark:bg-slate-800/60">{p.providerBody}</pre>
        <p className="mt-1 text-xs text-slate-500">
          {p.params.length === 0
            ? "No parameters."
            : `Sent as ${p.params.length} parameter${p.params.length > 1 ? "s" : ""}: ${p.params.map((x, i) => `${x.name ?? i + 1} = "${x.value}"`).join(", ")}`}
        </p>
      </div>
    </div>
  );
}

function Editor({ template, onDone }: { template: WhatsAppTemplate | null; onDone: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: template?.name ?? STARTER.name,
    language: template?.language ?? STARTER.language,
    category: template?.category ?? STARTER.category,
    paramFormat: template?.paramFormat ?? STARTER.paramFormat,
    body: template?.body ?? STARTER.body,
    externalTemplateId: template?.externalTemplateId ?? "",
    approvalStatus: template?.approvalStatus ?? STARTER.approvalStatus,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, externalTemplateId: form.externalTemplateId.trim() || null };
      return template
        ? api(`/whatsapp/templates/${template.id}`, { method: "PATCH", body: payload })
        : api("/whatsapp/templates", { method: "POST", body: payload });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["wa-templates"] });
      onDone();
    },
  });

  function insert(variable: string) {
    const el = bodyRef.current;
    const token = `{{${variable}}}`;
    if (!el) return set("body", form.body + token);
    const { selectionStart: s, selectionEnd: e } = el;
    set("body", form.body.slice(0, s) + token + form.body.slice(e));
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
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          Create and submit the template in <strong>WhatsApp Manager</strong> first. Copy it here with the same name and language, writing a lead
          variable where Meta shows {"{{1}}"}, {"{{2}}"}… The preview shows the body exactly as Meta must have it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">Template name (as in WhatsApp Manager)</span>
            <input className="input font-mono" required pattern="[a-z0-9_]+" maxLength={512} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="label">Language code</span>
            <input className="input" required value={form.language} onChange={(e) => set("language", e.target.value)} placeholder="en, en_US, hi" />
          </label>
          <label className="block space-y-1">
            <span className="label">Category</span>
            <select className="input" value={form.category} onChange={(e) => set("category", e.target.value as typeof form.category)}>
              <option value="marketing">Marketing</option>
              <option value="utility">Utility</option>
              <option value="authentication">Authentication</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="label">Parameters</span>
            <select className="input" value={form.paramFormat} onChange={(e) => set("paramFormat", e.target.value as typeof form.paramFormat)}>
              <option value="positional">Numbered: {"{{1}}, {{2}}"}</option>
              <option value="named">Named: {"{{name}}, {{city}}"}</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="label">Template ID (optional)</span>
            <input className="input" inputMode="numeric" value={form.externalTemplateId} onChange={(e) => set("externalTemplateId", e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="label">Status in WhatsApp Manager</span>
            <select className="input" value={form.approvalStatus} onChange={(e) => set("approvalStatus", e.target.value as ApprovalStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="label">Body</span>
          <textarea ref={bodyRef} className="input min-h-40 font-mono text-sm" required maxLength={1024} value={form.body} onChange={(e) => set("body", e.target.value)} />
          <span className="block text-right text-xs text-slate-500">{form.body.length}/1024</span>
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
            Only <strong>Approved</strong> templates can be used in campaigns. Header and button variables are not supported; templates with a fixed
            header or buttons work.
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
      <section className="card h-fit p-5">
        <h2 className="mb-3 font-medium">Preview</h2>
        <WhatsAppTemplatePreview body={form.body} paramFormat={form.paramFormat} />
      </section>
    </div>
  );
}

export function WhatsAppTemplatesPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<WhatsAppTemplate | "new" | null>(null);
  const templates = useQuery({ queryKey: ["wa-templates"], queryFn: () => api<{ items: WhatsAppTemplate[] }>("/whatsapp/templates").then((r) => r.items) });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/whatsapp/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["wa-templates"] }),
  });

  if (editing) {
    return (
      <>
        <PageHeader title={editing === "new" ? "New WhatsApp template" : `Edit: ${editing.name}`} />
        <Editor template={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      </>
    );
  }

  return (
    <>
      <Link to="/whatsapp" className="mb-3 inline-block text-sm text-slate-500 hover:text-brand-600">
        ← WhatsApp campaigns
      </Link>
      <PageHeader
        title="WhatsApp templates"
        subtitle="Copies of your Meta-approved templates, with {{variables}} filled from each lead"
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
        {templates.data?.length === 0 && <EmptyState title="No WhatsApp templates yet">Add one after Meta approves it in WhatsApp Manager.</EmptyState>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {templates.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  <code>{t.name}</code> <span className="text-xs font-normal text-slate-500">{t.language} · {t.category}</span>
                </p>
                <p className="truncate text-sm text-slate-500">{t.body}</p>
              </div>
              <div className="flex items-center gap-2">
                <ApprovalBadge status={t.approvalStatus} />
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
