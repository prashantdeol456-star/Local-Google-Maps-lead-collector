import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorBox } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { setSearchParams } from "../../lib/router";

// All messages: the person behind the open chat. The chat is linked to a Contacts record (by
// phone, Instagram or LinkedIn by itself, or by you), with the same person's chats on other apps
// one click away. AI Inbox chats also get labels and notes here.

interface ContactInfo {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  designation: string | null;
}
interface LinkedChat {
  source: "whatsapp" | "inbox";
  id: string;
  platform: string;
  name: string;
}
interface ContactAnswer {
  contact: ContactInfo | null;
  chats: LinkedChat[];
  suggestions: ContactInfo[];
}

const APP: Record<string, string> = { whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram", telegram: "Telegram", linkedin: "LinkedIn" };
const keyOf = (c: Pick<LinkedChat, "source" | "id">) => `${c.source === "whatsapp" ? "wa" : "in"}:${c.id}`;

function Labels({ id, labels, notes, known }: { id: string; labels: string[]; notes: string | null; known: string[] }) {
  const client = useQueryClient();
  const [list, setList] = useState(labels);
  const [text, setText] = useState(notes ?? "");
  const [adding, setAdding] = useState("");
  useEffect(() => {
    setList(labels);
    setText(notes ?? "");
  }, [id, labels, notes]);
  const save = useMutation({
    mutationFn: (patch: { labels?: string[]; notes?: string | null }) => api<{ labels: string[]; notes: string | null }>(`/messages/chats/inbox/${id}`, { method: "PATCH", body: patch }),
    onSuccess: (r) => {
      setList(r.labels);
      void client.invalidateQueries({ queryKey: ["messages"] });
    },
  });
  const add = (l: string) => {
    const v = l.trim();
    if (!v || list.includes(v) || list.length >= 10) return;
    save.mutate({ labels: [...list, v] });
    setAdding("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {list.map((l) => (
          <span key={l} className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
            {l}
            <button className="text-slate-500 hover:text-red-600" aria-label={`Remove label ${l}`} onClick={() => save.mutate({ labels: list.filter((x) => x !== l) })}>
              ✕
            </button>
          </span>
        ))}
        <input
          className="input w-28 py-0.5 text-xs"
          list="chat-labels"
          placeholder="+ Label"
          value={adding}
          maxLength={30}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(adding);
            }
          }}
          onBlur={() => adding && add(adding)}
          aria-label="Add a label"
        />
        <datalist id="chat-labels">
          {known.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>
      <textarea
        className="input text-xs"
        rows={2}
        placeholder="Notes about this person (only you see them)"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== (notes ?? "") && save.mutate({ notes: text || null })}
        aria-label="Notes"
      />
      {save.error && <ErrorBox error={save.error} />}
    </div>
  );
}

export function ContactStrip({ source, id, chatName, inboxLabels, inboxNotes, knownLabels }: { source: "whatsapp" | "inbox"; id: string; chatName: string; inboxLabels: string[]; inboxNotes: string | null; knownLabels: string[] }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const answer = useQuery({ queryKey: ["messages", "contact", source, id], queryFn: () => api<ContactAnswer>(`/messages/chats/${source}/${id}/contact`) });
  const search = useQuery({
    queryKey: ["messages", "contact-search", q],
    queryFn: () => api<{ items: ContactInfo[] }>(`/messages/contacts${qs({ q })}`).then((r) => r.items),
    enabled: open && q.trim().length >= 2,
  });
  const done = (r: ContactAnswer) => {
    client.setQueryData(["messages", "contact", source, id], r);
    void client.invalidateQueries({ queryKey: ["messages", "chats"] });
    setOpen(false);
    setQ("");
  };
  const link = useMutation({ mutationFn: (contactId: string) => api<ContactAnswer>(`/messages/chats/${source}/${id}/contact`, { method: "POST", body: { contactId } }), onSuccess: done });
  const create = useMutation({ mutationFn: () => api<ContactAnswer>(`/messages/chats/${source}/${id}/contact`, { method: "POST", body: { create: { name: chatName } } }), onSuccess: done });
  const unlink = useMutation({ mutationFn: () => api<ContactAnswer>(`/messages/chats/${source}/${id}/contact`, { method: "DELETE" }), onSuccess: done });

  const a = answer.data;
  return (
    <details className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/60" open={open || undefined}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        👤{" "}
        {a?.contact ? (
          <>
            <strong>{a.contact.name}</strong>
            {a.contact.company && <span>· {a.contact.company}</span>}
            {a.chats.length > 0 && <span className="rounded bg-brand-50 px-1.5 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">also on {[...new Set(a.chats.map((c) => APP[c.platform] ?? c.platform))].join(", ")}</span>}
          </>
        ) : (
          <span>Not linked to a contact{a?.suggestions.length ? ` · ${a.suggestions.length} possible` : ""}</span>
        )}
        {source === "inbox" && inboxLabels.length > 0 && <span className="text-slate-500">· {inboxLabels.join(", ")}</span>}
      </summary>
      <div className="mt-2 space-y-3">
        {answer.error && <ErrorBox error={answer.error} />}
        {a?.contact && (
          <div className="space-y-2">
            <p className="text-xs text-slate-600 dark:text-slate-300">{[a.contact.designation, a.contact.phone, a.contact.email].filter(Boolean).join(" · ") || "No phone or email saved yet."}</p>
            {a.chats.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {a.chats.map((c) => (
                  <button key={keyOf(c)} className="btn px-2 py-0.5 text-xs" onClick={() => setSearchParams({ chat: keyOf(c) })}>
                    {APP[c.platform] ?? c.platform}: {c.name}
                  </button>
                ))}
                <button className="btn px-2 py-0.5 text-xs" onClick={() => setSearchParams({ contact: a.contact!.id, app: null, filter: null, label: null })}>
                  Show all their chats in the list
                </button>
              </div>
            )}
            <button className="text-xs text-red-600 hover:underline" onClick={() => unlink.mutate()}>
              Not this person (unlink)
            </button>
          </div>
        )}
        {a && !a.contact && (
          <div className="space-y-2">
            {a.suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                Is it:
                {a.suggestions.map((c) => (
                  <button key={c.id} className="btn px-2 py-0.5 text-xs" disabled={link.isPending} onClick={() => link.mutate(c.id)}>
                    {c.name}
                    {c.company ? ` (${c.company})` : ""}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                className="input flex-1 py-1 text-xs"
                placeholder="Find a contact: name, phone, email…"
                value={q}
                onFocus={() => setOpen(true)}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Find a contact"
              />
              <button className="btn px-2 py-1 text-xs" disabled={create.isPending} onClick={() => create.mutate()} title="Adds this person to Contacts (list “Chats”)">
                + New contact “{chatName}”
              </button>
            </div>
            {search.data && (
              <ul className="space-y-1">
                {search.data.length === 0 && <li className="text-xs text-slate-500">No contact matches.</li>}
                {search.data.map((c) => (
                  <li key={c.id}>
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => link.mutate(c.id)}>
                      Link to {c.name}
                      {[c.company, c.phone, c.email].filter(Boolean).length ? ` · ${[c.company, c.phone, c.email].filter(Boolean).join(" · ")}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(link.error || create.error || unlink.error) && <ErrorBox error={link.error ?? create.error ?? unlink.error} />}
        {source === "inbox" && <Labels id={id} labels={inboxLabels} notes={inboxNotes} known={knownLabels} />}
        {source === "whatsapp" && <p className="text-xs text-slate-500">Labels and notes of WhatsApp chats: open “Contact info” in the chat (⋮ menu).</p>}
      </div>
    </details>
  );
}
