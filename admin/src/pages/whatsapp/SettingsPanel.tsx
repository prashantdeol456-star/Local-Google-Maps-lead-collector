import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorBox, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import type { BusinessProfile, ChatSettings, QuickReply } from "./types";

// WhatsApp Chat settings: business profile (what people see about your number), greeting and
// away messages, quick replies, and browser notifications.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Profile() {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["wa-profile"], queryFn: () => api<{ profile: BusinessProfile }>("/whatsapp/business-profile").then((r) => r.profile), retry: false });
  const [form, setForm] = useState({ about: "", description: "", address: "", email: "", website: "" });
  useEffect(() => {
    if (profile.data)
      setForm({
        about: profile.data.about ?? "",
        description: profile.data.description ?? "",
        address: profile.data.address ?? "",
        email: profile.data.email ?? "",
        website: profile.data.websites[0] ?? "",
      });
  }, [profile.data]);
  const save = useMutation({
    mutationFn: () =>
      api("/whatsapp/business-profile", {
        method: "PATCH",
        body: {
          ...(form.about.trim() ? { about: form.about.trim() } : {}),
          description: form.description.trim(),
          address: form.address.trim(),
          ...(form.email.trim() ? { email: form.email.trim() } : {}),
          websites: form.website.trim() ? [form.website.trim()] : [],
        },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["wa-profile"] }),
  });
  if (profile.isPending) return <Spinner />;
  if (profile.error) return <ErrorBox error={profile.error} />;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {profile.data?.profilePictureUrl && <img src={profile.data.profilePictureUrl} alt="Profile" className="h-16 w-16 rounded-full object-cover" referrerPolicy="no-referrer" />}
      <label className="block text-sm">
        About <span className="text-xs text-slate-500">(up to 139 characters)</span>
        <input className="input" id="wa-p-about" maxLength={139} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} />
      </label>
      <label className="block text-sm">
        Description
        <textarea className="input" id="wa-p-desc" rows={3} maxLength={512} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <label className="block text-sm">
        Address
        <input className="input" id="wa-p-address" maxLength={256} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </label>
      <label className="block text-sm">
        Email
        <input className="input" id="wa-p-email" type="email" maxLength={128} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label className="block text-sm">
        Website
        <input className="input" id="wa-p-web" type="url" placeholder="https://…" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      </label>
      {save.error && <ErrorBox error={save.error} />}
      <button className="btn btn-primary" disabled={save.isPending}>
        {save.isPending ? "Saving…" : save.isSuccess ? "Saved ✓" : "Save profile"}
      </button>
      <p className="text-xs text-slate-500">The profile photo is changed in WhatsApp Manager.</p>
    </form>
  );
}

function AutoMessages({ notifyAllowed, onAskNotify }: { notifyAllowed: boolean; onAskNotify: () => void }) {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["wa-settings"], queryFn: () => api<{ settings: ChatSettings }>("/whatsapp/chat-settings").then((r) => r.settings) });
  const [form, setForm] = useState<ChatSettings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: (s: ChatSettings) => api("/whatsapp/chat-settings", { method: "PATCH", body: s }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["wa-settings"] }),
  });
  if (!form) return <Spinner />;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} />
        Notify me (sound + browser notification) for new messages
      </label>
      {form.notify && !notifyAllowed && (
        <button type="button" className="btn px-2 py-1 text-xs" onClick={onAskNotify}>
          Allow browser notifications
        </button>
      )}
      <fieldset className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={form.greetingOn} onChange={(e) => setForm({ ...form, greetingOn: e.target.checked })} />
          Greeting message
        </label>
        <p className="text-xs text-slate-500">Sent by itself to new chats, and to people who have not written for 14 days.</p>
        <textarea className="input" id="wa-greet" rows={2} maxLength={1000} value={form.greetingText ?? ""} onChange={(e) => setForm({ ...form, greetingText: e.target.value })} />
      </fieldset>
      <fieldset className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={form.awayOn} onChange={(e) => setForm({ ...form, awayOn: e.target.checked })} />
          Away message
        </label>
        <p className="text-xs text-slate-500">Sent by itself outside your working hours (at most once in 12 hours per chat).</p>
        <textarea className="input" id="wa-away" rows={2} maxLength={1000} value={form.awayText ?? ""} onChange={(e) => setForm({ ...form, awayText: e.target.value })} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Working hours
          <input className="input w-24" id="wa-start" type="time" value={form.workStart} onChange={(e) => setForm({ ...form, workStart: e.target.value })} />
          to
          <input className="input w-24" id="wa-end" type="time" value={form.workEnd} onChange={(e) => setForm({ ...form, workEnd: e.target.value })} />
        </div>
        <div className="flex flex-wrap gap-1">
          {DAYS.map((d, i) => (
            <label key={d} className={`cursor-pointer rounded border px-2 py-1 text-xs ${form.workDays.includes(i) ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/40" : "border-slate-200 dark:border-slate-700"}`}>
              <input
                type="checkbox"
                className="sr-only"
                checked={form.workDays.includes(i)}
                onChange={(e) => setForm({ ...form, workDays: e.target.checked ? [...form.workDays, i] : form.workDays.filter((x) => x !== i) })}
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      {save.error && <ErrorBox error={save.error} />}
      <button className="btn btn-primary" disabled={save.isPending}>
        {save.isPending ? "Saving…" : save.isSuccess ? "Saved ✓" : "Save"}
      </button>
    </form>
  );
}

function QuickReplies() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["wa-quick"], queryFn: () => api<{ items: QuickReply[] }>("/whatsapp/quick-replies").then((r) => r.items) });
  const [shortcut, setShortcut] = useState("");
  const [text, setText] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: ["wa-quick"] });
  const add = useMutation({
    mutationFn: () => api("/whatsapp/quick-replies", { method: "POST", body: { shortcut, text } }),
    onSuccess: () => {
      setShortcut("");
      setText("");
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/whatsapp/quick-replies/${id}`, { method: "DELETE" }), onSuccess: () => void refresh() });
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">In a chat, type “/” and the shortcut to insert the text.</p>
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {list.data?.map((q) => (
          <li key={q.id} className="flex items-start gap-2 py-2">
            <span className="font-medium">/{q.shortcut}</span>
            <span className="flex-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{q.text}</span>
            <button className="text-xs text-red-600" onClick={() => remove.mutate(q.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <input className="input" id="wa-qr-short" placeholder="Shortcut, e.g. fees" value={shortcut} maxLength={26} onChange={(e) => setShortcut(e.target.value)} required />
        <textarea className="input" id="wa-qr-text" rows={2} placeholder="Text" value={text} maxLength={4096} onChange={(e) => setText(e.target.value)} required />
        {add.error && <ErrorBox error={add.error} />}
        <button className="btn btn-primary" disabled={add.isPending}>
          Add quick reply
        </button>
      </form>
    </div>
  );
}

export function SettingsPanel({ onClose, notifyAllowed, onAskNotify }: { onClose: () => void; notifyAllowed: boolean; onAskNotify: () => void }) {
  const [tab, setTab] = useState<"auto" | "quick" | "profile">("auto");
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-label="WhatsApp Chat settings" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">WhatsApp Chat settings</h2>
          <button className="btn px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="mb-4 flex gap-1">
          {(
            [
              ["auto", "Notifications & auto messages"],
              ["quick", "Quick replies"],
              ["profile", "Business profile"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`btn px-3 py-1 text-sm ${tab === id ? "btn-primary" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab === "auto" && <AutoMessages notifyAllowed={notifyAllowed} onAskNotify={onAskNotify} />}
        {tab === "quick" && <QuickReplies />}
        {tab === "profile" && <Profile />}
      </div>
    </div>
  );
}
