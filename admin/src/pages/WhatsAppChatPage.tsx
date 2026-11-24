import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatRelative } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { WhatsAppTemplate } from "../lib/types";
import { Composer } from "./whatsapp/Composer";
import { MessageBubble } from "./whatsapp/MessageBubble";
import { SettingsPanel } from "./whatsapp/SettingsPanel";
import { day, time, type Chat, type ChatSettings, type Message, type QuickReply } from "./whatsapp/types";

// WhatsApp Chat: two-way chats through your own WhatsApp number (Meta Cloud API), with what the
// WhatsApp app and the Cloud API have in common. New messages, ticks and AI drafts arrive live.
// Free messages within 24 hours of the person's last message; after that, and for a new chat,
// only an approved template (WhatsApp's rule). The AI draft is sent only when you press Send.

type Filter = "all" | "unread" | "starred" | "archived";

function NewChat({ templates, phone: initialPhone, name: initialName, onDone, onCancel }: { templates: WhatsAppTemplate[]; phone?: string; name?: string; onDone: (chatId: string) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [name, setName] = useState(initialName ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const start = useMutation({
    mutationFn: () => api<{ chat: Chat }>("/whatsapp/chats", { method: "POST", body: { phone, name: name || null, templateId } }),
    onSuccess: (res) => onDone(res.chat.id),
  });
  return (
    <form
      className="space-y-3 border-b border-slate-200 p-3 dark:border-slate-800"
      onSubmit={(e) => {
        e.preventDefault();
        start.mutate();
      }}
    >
      <p className="text-sm font-medium">New chat</p>
      <input className="input" id="wa-new-phone" placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Mobile number" required />
      <input className="input" id="wa-new-name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      {templates.length === 0 ? (
        <p className="text-xs text-amber-600">
          WhatsApp allows only an approved template as the first message. Add one on the{" "}
          <Link to="/templates" className="underline">
            Templates
          </Link>{" "}
          page and mark it Approved.
        </p>
      ) : (
        <select className="input" id="wa-new-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {start.error && <ErrorBox error={start.error} />}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={!templateId || start.isPending}>
          {start.isPending ? "Sending…" : "Send template"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ForwardDialog({ message, chats, onClose }: { message: Message; chats: Chat[]; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const forward = useMutation({
    mutationFn: () => api<{ results: { chatId: string; ok: boolean; error?: string }[] }>(`/whatsapp/messages/${message.id}/forward`, { method: "POST", body: { chatIds: picked } }),
  });
  const open = chats.filter((c) => c.id !== message.chatId && c.windowOpenUntil && !c.blocked);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label="Forward message" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3 p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Forward to…</h2>
        <p className="text-xs text-slate-500">Only chats where the person wrote in the last 24 hours (WhatsApp's rule). Up to 5.</p>
        {open.length === 0 && <p className="text-sm text-slate-500">No chat is open for free messages right now.</p>}
        <ul className="max-h-64 overflow-y-auto">
          {open.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  disabled={!picked.includes(c.id) && picked.length >= 5}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
                />
                {c.name} <span className="text-xs text-slate-500">{c.phone}</span>
              </label>
            </li>
          ))}
        </ul>
        {forward.data && (
          <ul className="text-xs">
            {forward.data.results.map((r) => (
              <li key={r.chatId} className={r.ok ? "text-emerald-700" : "text-red-600"}>
                {chats.find((c) => c.id === r.chatId)?.name}: {r.ok ? "sent" : r.error}
              </li>
            ))}
          </ul>
        )}
        {forward.error && <ErrorBox error={forward.error} />}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={!picked.length || forward.isPending || !!forward.data} onClick={() => forward.mutate()}>
            {forward.isPending ? "Forwarding…" : "Forward"}
          </button>
          <button className="btn" onClick={onClose}>
            {forward.data ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactInfo({ chat, labels, onClose, onChange }: { chat: Chat; labels: string[]; onClose: () => void; onChange: () => void }) {
  const [name, setName] = useState(chat.customName ?? "");
  const [notes, setNotes] = useState(chat.notes ?? "");
  const [chatLabels, setChatLabels] = useState(chat.labels);
  const [newLabel, setNewLabel] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/whatsapp/chats/${chat.id}`, { method: "PATCH", body: { name: name || null, notes: notes || null, labels: chatLabels } }),
    onSuccess: onChange,
  });
  const block = useMutation({ mutationFn: () => api(`/whatsapp/chats/${chat.id}/block`, { method: "POST", body: { blocked: !chat.blocked } }), onSuccess: onChange });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/whatsapp/chats/${chat.id}`, { method: "DELETE" }),
    onSuccess: () => {
      onChange();
      setSearchParams({ chat: null });
    },
  });
  const all = [...new Set([...labels, ...chatLabels])];
  return (
    <aside className="flex min-h-0 w-full flex-col overflow-y-auto border-l border-slate-200 p-4 text-sm md:w-80 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Contact info</h3>
        <button className="btn px-2 py-1" onClick={onClose} aria-label="Close contact info">
          ✕
        </button>
      </div>
      <p className="text-lg font-medium">{chat.name}</p>
      <p className="text-slate-500">{chat.phone}</p>
      {chat.profileName && <p className="text-xs text-slate-500">WhatsApp name: {chat.profileName}</p>}
      {chat.leadId && <p className="mt-1 text-xs text-emerald-700">In your leads</p>}
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="block">
          Name
          <input className="input" id="wa-ci-name" value={name} maxLength={100} placeholder={chat.profileName ?? ""} onChange={(e) => setName(e.target.value)} />
        </label>
        <div>
          <p>Labels</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {all.map((l) => (
              <label key={l} className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${chatLabels.includes(l) ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/40" : "border-slate-200 dark:border-slate-700"}`}>
                <input type="checkbox" className="sr-only" checked={chatLabels.includes(l)} onChange={(e) => setChatLabels(e.target.checked ? [...chatLabels, l] : chatLabels.filter((x) => x !== l))} />
                {l}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            <input className="input" id="wa-ci-label" placeholder="New label, e.g. Hot lead" value={newLabel} maxLength={40} onChange={(e) => setNewLabel(e.target.value)} />
            <button
              type="button"
              className="btn px-2"
              onClick={() => {
                if (newLabel.trim()) setChatLabels([...new Set([...chatLabels, newLabel.trim()])]);
                setNewLabel("");
              }}
            >
              Add
            </button>
          </div>
        </div>
        <label className="block">
          Notes <span className="text-xs text-slate-500">(only you see these)</span>
          <textarea className="input" id="wa-ci-notes" rows={4} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {save.error && <ErrorBox error={save.error} />}
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : save.isSuccess ? "Saved ✓" : "Save"}
        </button>
      </form>
      <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        {block.error && <ErrorBox error={block.error} />}
        <button className="btn w-full" onClick={() => block.mutate()} disabled={block.isPending}>
          {chat.blocked ? "Unblock" : "Block"} {chat.name}
        </button>
        {confirmDelete ? (
          <div className="flex gap-2">
            <button className="btn btn-danger flex-1" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Yes, delete this chat here
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              No
            </button>
          </div>
        ) : (
          <button className="btn w-full text-red-600" onClick={() => setConfirmDelete(true)}>
            Delete chat
          </button>
        )}
        <p className="text-xs text-slate-500">Deleting removes the chat from this panel only; it stays on their phone. WhatsApp lets you block people who wrote in the last 24 hours.</p>
      </div>
    </aside>
  );
}

/** A short "ding" (no sound file needed). */
function ding() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.35);
  } catch {
    /* sound blocked until the page is clicked once */
  }
}

export function WhatsAppChatPage() {
  const client = useQueryClient();
  const params = useSearchParams();
  const chatId = params.get("chat") ?? "";
  const filter = (params.get("filter") ?? "all") as Filter;
  const label = params.get("label") ?? "";
  const [search, setSearch] = useState("");
  const [newChat, setNewChat] = useState<{ phone?: string; name?: string } | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [info, setInfo] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [inChat, setInChat] = useState<{ q: string; starred: boolean } | null>(null);
  const [useDraft, setUseDraft] = useState<string | null>(null);
  const [notifyPermission, setNotifyPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const bottom = useRef<HTMLDivElement>(null);

  const chats = useQuery({
    queryKey: ["wa-chats", search, filter, label],
    queryFn: () => api<{ items: Chat[] }>(`/whatsapp/chats${qs({ q: search, filter: filter === "all" ? "" : filter, label })}`).then((r) => r.items),
    refetchInterval: 60_000,
  });
  const allChats = useQuery({ queryKey: ["wa-chats", "all-for-notify"], queryFn: () => api<{ items: Chat[] }>("/whatsapp/chats").then((r) => r.items), refetchInterval: 60_000 });
  const labels = useQuery({ queryKey: ["wa-chats", "labels"], queryFn: () => api<{ items: string[] }>("/whatsapp/chat-labels").then((r) => r.items) });
  const settings = useQuery({ queryKey: ["wa-settings"], queryFn: () => api<{ settings: ChatSettings }>("/whatsapp/chat-settings").then((r) => r.settings) });
  const quickReplies = useQuery({ queryKey: ["wa-quick"], queryFn: () => api<{ items: QuickReply[] }>("/whatsapp/quick-replies").then((r) => r.items) });
  const chat = chats.data?.find((c) => c.id === chatId) ?? allChats.data?.find((c) => c.id === chatId) ?? null;
  const messages = useQuery({
    queryKey: ["wa-chat", chatId, inChat?.q ?? "", inChat?.starred ?? false],
    queryFn: () => api<{ items: Message[] }>(`/whatsapp/chats/${chatId}/messages${qs({ q: inChat?.q ?? "", starred: inChat?.starred ? "1" : "" })}`).then((r) => r.items),
    enabled: !!chatId,
    refetchInterval: 60_000,
  });
  const templates = useQuery({
    queryKey: ["wa-templates-approved"],
    queryFn: () => api<{ items: WhatsAppTemplate[] }>("/whatsapp/templates").then((r) => r.items.filter((t) => t.approvalStatus === "approved")),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["wa-chats"] });
    void client.invalidateQueries({ queryKey: ["wa-chat", chatId] });
  };

  // Notifications: a chat's unread count went up (not muted).
  const seen = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const list = allChats.data;
    if (!list) return;
    const before = seen.current;
    seen.current = new Map(list.map((c) => [c.id, c.unreadCount]));
    if (!before || !settings.data?.notify) return;
    for (const c of list) {
      if (c.unreadCount > (before.get(c.id) ?? 0) && !c.mutedUntil && !(c.id === chatId && document.hasFocus())) {
        ding();
        if (notifyPermission === "granted") {
          const n = new Notification(c.name, { body: c.lastMessageText ?? "New message", tag: c.id });
          n.onclick = () => {
            window.focus();
            setSearchParams({ chat: c.id });
          };
        }
        break;
      }
    }
  }, [allChats.data, settings.data?.notify, chatId, notifyPermission]);

  // Opening an unread chat: unread back to 0, blue ticks on the person's phone.
  const unread = chat?.unreadCount ?? 0;
  useEffect(() => {
    if (chatId && unread > 0) void api(`/whatsapp/chats/${chatId}/read`, { method: "POST" }).then(() => client.invalidateQueries({ queryKey: ["wa-chats"] }));
  }, [chatId, unread, client]);

  useEffect(() => {
    if (!inChat) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length, chatId, inChat]);

  useEffect(() => {
    setReplyTo(null);
    setInfo(false);
    setMenu(false);
    setInChat(null);
    setUseDraft(null);
  }, [chatId]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/whatsapp/chats/${chatId}`, { method: "PATCH", body }),
    onSuccess: refresh,
  });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) => api(path, { method: "POST", body: body ?? {} }),
    onSuccess: refresh,
  });
  const sendTemplate = useMutation({
    mutationFn: () => api(`/whatsapp/chats/${chatId}/template`, { method: "POST", body: { templateId: templateId || templates.data?.[0]?.id } }),
    onSuccess: refresh,
  });
  const redraft = useMutation({ mutationFn: () => api(`/whatsapp/chats/${chatId}/draft`, { method: "POST" }), onSuccess: refresh });

  const open = !!chat?.windowOpenUntil && !chat.blocked;
  const muteFor = (hours: number | null) => update.mutate({ mutedUntil: hours === null ? null : new Date(Date.now() + hours * 3600_000).toISOString() });
  let lastDay = "";

  return (
    <>
      <PageHeader
        title="WhatsApp Chat"
        subtitle="Chats with customers through your own WhatsApp number. New messages, ticks and AI drafts show up live."
        actions={
          <div className="flex gap-2">
            <button className="btn" onClick={() => setSettingsOpen(true)}>
              ⚙ Settings
            </button>
            <button className="btn btn-primary" onClick={() => setNewChat({})}>
              + New chat
            </button>
          </div>
        }
      />

      <div className="card flex h-[calc(100vh-12rem)] min-h-[34rem] overflow-hidden">
        {/* Chat list */}
        <aside className={`flex min-h-0 w-full flex-col border-slate-200 md:w-80 md:shrink-0 md:border-r dark:border-slate-800 ${chatId ? "hidden md:flex" : "flex"}`}>
          {newChat && templates.data && (
            <NewChat
              templates={templates.data}
              phone={newChat.phone}
              name={newChat.name}
              onCancel={() => setNewChat(null)}
              onDone={(id) => {
                setNewChat(null);
                void client.invalidateQueries({ queryKey: ["wa-chats"] });
                setSearchParams({ chat: id });
              }}
            />
          )}
          <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
            <input className="input" id="wa-search" placeholder="Search name or number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search chats" />
            <div className="flex flex-wrap gap-1">
              {(["all", "unread", "starred", "archived"] as const).map((f) => (
                <button key={f} className={`rounded-full px-2.5 py-0.5 text-xs ${filter === f ? "bg-emerald-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setSearchParams({ filter: f === "all" ? null : f })}>
                  {f === "all" ? "All" : f === "unread" ? "Unread" : f === "starred" ? "★ Starred" : "Archived"}
                </button>
              ))}
              {(labels.data?.length ?? 0) > 0 && (
                <select className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800" value={label} onChange={(e) => setSearchParams({ label: e.target.value || null })} aria-label="Label">
                  <option value="">All labels</option>
                  {labels.data!.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chats.isPending && <Spinner />}
            {chats.error && (
              <div className="p-3">
                <ErrorBox error={chats.error} />
              </div>
            )}
            {chats.data?.length === 0 && (
              <EmptyState title={filter === "all" && !label ? "No chats yet" : "Nothing here"}>
                {filter === "all" && !label && (
                  <>
                    Messages people send to your WhatsApp number appear here. Set up the webhook on the{" "}
                    <Link to="/sender" className="text-brand-600 underline">
                      My sender
                    </Link>{" "}
                    page, or start a chat with a template.
                  </>
                )}
              </EmptyState>
            )}
            <ul>
              {chats.data?.map((c) => (
                <li key={c.id}>
                  <button
                    className={`flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60 ${c.id === chatId ? "bg-brand-50/70 dark:bg-brand-700/20" : ""}`}
                    onClick={() => setSearchParams({ chat: c.id })}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" aria-hidden>
                      {c.name.replace(/^\+/, "").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">
                          {c.name}
                          {c.blocked && <span className="ml-1 text-xs text-red-600">(blocked)</span>}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">{formatRelative(c.lastMessageAt)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-slate-500">{c.lastMessageText ?? ""}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs">
                          {c.mutedUntil && <span title="Muted">🔕</span>}
                          {c.pinned && <span title="Pinned">📌</span>}
                          {c.unreadCount > 0 && <span className="rounded-full bg-emerald-600 px-2 font-medium text-white">{c.unreadCount}</span>}
                        </span>
                      </span>
                      {c.labels.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {c.labels.map((l) => (
                            <span key={l} className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {l}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Active chat */}
        <section className={`min-h-0 min-w-0 flex-1 flex-col ${chatId ? "flex" : "hidden md:flex"}`}>
          {!chat ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">Choose a chat on the left, or start a new one.</div>
          ) : (
            <>
              <header className="relative flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <button className="btn px-2 py-1 md:hidden" onClick={() => setSearchParams({ chat: null })} aria-label="Back to chats">
                  ←
                </button>
                <button className="min-w-0 flex-1 text-left" onClick={() => setInfo(true)} title="Contact info">
                  <p className="truncate font-medium">{chat.name}</p>
                  <p className="text-xs text-slate-500">
                    {chat.phone}
                    {chat.labels.length > 0 && ` · ${chat.labels.join(", ")}`}
                  </p>
                </button>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${open ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"}`}
                  title="WhatsApp allows free replies for 24 hours after the person's last message"
                >
                  {chat.blocked ? "Blocked" : open ? `Free reply until ${time(chat.windowOpenUntil!)}` : "24 h passed: template only"}
                </span>
                <button className="btn px-2 py-1" title="Search in this chat" onClick={() => setInChat(inChat ? null : { q: "", starred: false })}>
                  🔍
                </button>
                <button className="btn px-2 py-1" title="Chat menu" onClick={() => setMenu((v) => !v)}>
                  ⋮
                </button>
                {menu && (
                  <ul className="absolute right-4 top-full z-30 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800" onClick={() => setMenu(false)}>
                    {[
                      ["Contact info", () => setInfo(true)],
                      [chat.pinned ? "Unpin chat" : "Pin chat", () => update.mutate({ pinned: !chat.pinned })],
                      [chat.archived ? "Unarchive chat" : "Archive chat", () => update.mutate({ archived: !chat.archived })],
                      ["Mark as unread", () => update.mutate({ unread: true })],
                      ...(chat.mutedUntil
                        ? ([["Unmute", () => muteFor(null)]] as const)
                        : ([
                            ["Mute 8 hours", () => muteFor(8)],
                            ["Mute 1 week", () => muteFor(24 * 7)],
                            ["Mute always", () => muteFor(24 * 365 * 10)],
                          ] as const)),
                      ["Starred messages", () => setInChat({ q: "", starred: true })],
                      [chat.blocked ? "Unblock" : "Block", () => act.mutate({ path: `/whatsapp/chats/${chat.id}/block`, body: { blocked: !chat.blocked } })],
                    ].map(([labelText, fn]) => (
                      <li key={labelText as string}>
                        <button className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700" onClick={fn as () => void}>
                          {labelText as string}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </header>
              {(update.error || act.error) && (
                <div className="px-4 pt-2">
                  <ErrorBox error={update.error ?? act.error} />
                </div>
              )}
              {inChat && (
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
                  <input className="input" id="wa-in-chat" placeholder="Search messages in this chat" value={inChat.q} onChange={(e) => setInChat({ ...inChat, q: e.target.value })} autoFocus />
                  <label className="flex shrink-0 items-center gap-1 text-xs">
                    <input type="checkbox" checked={inChat.starred} onChange={(e) => setInChat({ ...inChat, starred: e.target.checked })} />★ only
                  </label>
                  <button className="btn px-2 py-1" onClick={() => setInChat(null)} aria-label="Close search">
                    ✕
                  </button>
                </div>
              )}

              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-3 dark:bg-slate-950/40">
                    {messages.isPending && <Spinner />}
                    {messages.data?.length === 0 && inChat && <p className="text-center text-sm text-slate-500">No messages match.</p>}
                    {messages.data?.map((m) => {
                      const d = day(m.createdAt);
                      const showDay = d !== lastDay;
                      lastDay = d;
                      return (
                        <div key={m.id}>
                          {showDay && <p className="my-2 text-center text-xs text-slate-500">{d}</p>}
                          <MessageBubble
                            m={m}
                            canSend={open}
                            onReply={setReplyTo}
                            onReact={(msg, emoji) => act.mutate({ path: `/whatsapp/messages/${msg.id}/react`, body: { emoji } })}
                            onStar={(msg) => act.mutate({ path: `/whatsapp/messages/${msg.id}/star`, body: { starred: !msg.starred } })}
                            onForward={setForwarding}
                            onHide={(msg) => act.mutate({ path: `/whatsapp/messages/${msg.id}/hide` })}
                            onMessageNumber={(phone, name) => setNewChat({ phone, name })}
                          />
                        </div>
                      );
                    })}
                    <div ref={bottom} />
                  </div>

                  {(chat.aiDraft || chat.aiNote) && open && (
                    <div className="border-t border-slate-200 bg-violet-50 px-4 py-2 text-sm dark:border-slate-800 dark:bg-violet-500/10">
                      <p className="text-xs font-medium text-violet-700 dark:text-violet-300">✦ AI draft {chat.aiNote && <span className="font-normal">· {chat.aiNote}</span>}</p>
                      {chat.aiDraft && <p className="mt-1 whitespace-pre-wrap">{chat.aiDraft}</p>}
                      <div className="mt-2 flex gap-2">
                        {chat.aiDraft && (
                          <button className="btn px-2 py-1 text-xs" onClick={() => setUseDraft(chat.aiDraft)}>
                            Use this
                          </button>
                        )}
                        <button className="btn px-2 py-1 text-xs" disabled={redraft.isPending} onClick={() => redraft.mutate()}>
                          {redraft.isPending ? "Writing…" : "Write again"}
                        </button>
                      </div>
                    </div>
                  )}

                  {open ? (
                    <Composer chatId={chat.id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} draft={useDraft} onSent={refresh} quickReplies={quickReplies.data ?? []} />
                  ) : (
                    <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-800">
                      {chat.blocked ? (
                        <p className="text-sm text-slate-600 dark:text-slate-300">You blocked this number. Unblock it (⋮ menu) to send messages.</p>
                      ) : (
                        <>
                          <p className="text-sm text-slate-600 dark:text-slate-300">
                            WhatsApp allows free messages only for 24 hours after the person's last message. Send an approved template; when they reply, you can chat freely again.
                          </p>
                          {sendTemplate.error && <ErrorBox error={sendTemplate.error} />}
                          {templates.data && templates.data.length > 0 ? (
                            <div className="flex gap-2">
                              <select className="input flex-1" id="wa-template" value={templateId || templates.data[0]!.id} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
                                {templates.data.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                              <button className="btn btn-primary" disabled={sendTemplate.isPending} onClick={() => sendTemplate.mutate()}>
                                {sendTemplate.isPending ? "Sending…" : "Send template"}
                              </button>
                            </div>
                          ) : templates.isPending ? null : (
                            <p className="text-sm text-amber-600">
                              No approved WhatsApp template yet: add one on the{" "}
                              <Link to="/templates" className="underline">
                                Templates
                              </Link>{" "}
                              page.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                {info && <ContactInfo key={chat.id} chat={chat} labels={labels.data ?? []} onClose={() => setInfo(false)} onChange={refresh} />}
              </div>
            </>
          )}
        </section>
      </div>

      {forwarding && <ForwardDialog message={forwarding} chats={allChats.data ?? []} onClose={() => setForwarding(null)} />}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          notifyAllowed={notifyPermission === "granted"}
          onAskNotify={() => void Notification.requestPermission().then(setNotifyPermission)}
        />
      )}
    </>
  );
}
