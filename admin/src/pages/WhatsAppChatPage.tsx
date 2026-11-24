import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatRelative } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { WhatsAppTemplate } from "../lib/types";

// WhatsApp Chat: two-way chats through your own WhatsApp number (Meta Cloud API). New messages
// and ticks arrive live. Free replies within 24 hours of the person's last message; after that,
// and for a new chat, only an approved template (WhatsApp's rule). The AI writes a draft of the
// next reply; it is sent only when you press Send.

interface Chat {
  id: string;
  phone: string;
  name: string;
  profileName: string | null;
  customName: string | null;
  leadId: string | null;
  lastMessageAt: string;
  lastMessageText: string | null;
  unreadCount: number;
  windowOpenUntil: string | null;
  aiDraft: string | null;
  aiNote: string | null;
}

interface Message {
  id: string;
  chatId: string;
  wamid: string | null;
  direction: "in" | "out";
  type: string;
  body: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  status: string;
  error: string | null;
  templateName: string | null;
  createdAt: string;
}

const MAX_FILE = 5 * 1024 * 1024;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

function Ticks({ m }: { m: Message }) {
  if (m.direction === "in") return null;
  if (m.status === "failed") return <span className="text-red-600" title={m.error ?? "Not delivered"}>⚠</span>;
  if (m.status === "sending") return <span title="Sending">🕓</span>;
  if (m.status === "sent") return <span title="Sent">✓</span>;
  if (m.status === "delivered") return <span title="Delivered">✓✓</span>;
  return <span className="text-sky-500" title="Read">✓✓</span>;
}

function Media({ m }: { m: Message }) {
  if (!m.mediaMime && !m.mediaId) return null;
  if (!m.mediaId) return <p className="text-xs italic text-slate-500">{m.error ?? "Saving the file…"}</p>;
  const src = `/api/whatsapp/media/${m.mediaId}`;
  if (m.type === "image" || m.type === "sticker")
    return (
      <a href={src} target="_blank" rel="noreferrer">
        <img src={src} alt={m.body ?? "Photo"} className="max-h-72 rounded" loading="lazy" />
      </a>
    );
  if (m.type === "audio") return <audio controls src={src} className="max-w-full" />;
  if (m.type === "video") return <video controls src={src} className="max-h-72 rounded" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded bg-black/5 px-3 py-2 text-sm hover:underline dark:bg-white/10">
      📄 {m.mediaName ?? "Document"}
      {m.mediaSize != null && <span className="text-xs text-slate-500">({Math.ceil(m.mediaSize / 1024)} KB)</span>}
    </a>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function NewChat({ templates, onDone, onCancel }: { templates: WhatsAppTemplate[]; onDone: (chatId: string) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
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
          WhatsApp allows only an approved template as the first message. Add one on the <Link to="/templates" className="underline">Templates</Link> page and mark it Approved.
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

export function WhatsAppChatPage() {
  const client = useQueryClient();
  const params = useSearchParams();
  const chatId = params.get("chat") ?? "";
  const [search, setSearch] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const chats = useQuery({
    queryKey: ["wa-chats", search],
    queryFn: () => api<{ items: Chat[] }>(`/whatsapp/chats${qs({ q: search })}`).then((r) => r.items),
    refetchInterval: 60_000,
  });
  const chat = chats.data?.find((c) => c.id === chatId) ?? null;
  const messages = useQuery({
    queryKey: ["wa-chat", chatId],
    queryFn: () => api<{ items: Message[] }>(`/whatsapp/chats/${chatId}/messages`).then((r) => r.items),
    enabled: !!chatId,
    refetchInterval: 60_000,
  });
  const templates = useQuery({
    queryKey: ["wa-templates-approved"],
    queryFn: () => api<{ items: WhatsAppTemplate[] }>("/whatsapp/templates").then((r) => r.items.filter((t) => t.approvalStatus === "approved")),
  });

  const refresh = () => client.invalidateQueries({ queryKey: ["wa-chats"] }).then(() => client.invalidateQueries({ queryKey: ["wa-chat", chatId] }));

  // Opening an unread chat: unread back to 0, blue ticks on the person's phone.
  const unread = chat?.unreadCount ?? 0;
  useEffect(() => {
    if (chatId && unread > 0) void api(`/whatsapp/chats/${chatId}/read`, { method: "POST" }).then(() => client.invalidateQueries({ queryKey: ["wa-chats"] }));
  }, [chatId, unread, client]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length, chatId]);

  useEffect(() => {
    setText("");
    setFileError(null);
  }, [chatId]);

  const sendText = useMutation({
    mutationFn: () => api(`/whatsapp/chats/${chatId}/text`, { method: "POST", body: { text } }),
    onSuccess: () => {
      setText("");
      void refresh();
    },
  });
  const sendTemplate = useMutation({
    mutationFn: () => api(`/whatsapp/chats/${chatId}/template`, { method: "POST", body: { templateId: templateId || templates.data?.[0]?.id } }),
    onSuccess: () => void refresh(),
  });
  const sendFile = useMutation({
    mutationFn: async (file: File) =>
      api(`/whatsapp/chats/${chatId}/file`, {
        method: "POST",
        body: { fileName: file.name, mime: file.type || "application/octet-stream", data: await readAsBase64(file), caption: text.trim() || null },
      }),
    onSuccess: () => {
      setText("");
      void refresh();
    },
  });
  const redraft = useMutation({
    mutationFn: () => api<{ draft: string | null; note: string | null }>(`/whatsapp/chats/${chatId}/draft`, { method: "POST" }),
    onSuccess: () => void refresh(),
  });

  const open = !!chat?.windowOpenUntil;
  let lastDay = "";

  return (
    <>
      <PageHeader
        title="WhatsApp Chat"
        subtitle="Chats with customers through your own WhatsApp number. New messages and blue ticks show up live."
        actions={
          <button className="btn btn-primary" onClick={() => setNewChat(true)}>
            + New chat
          </button>
        }
      />

      <div className="card grid h-[calc(100vh-12rem)] min-h-[32rem] grid-cols-1 overflow-hidden md:grid-cols-[20rem_1fr]">
        {/* Chat list */}
        <aside className={`flex min-h-0 flex-col border-slate-200 md:border-r dark:border-slate-800 ${chatId ? "hidden md:flex" : "flex"}`}>
          {newChat && templates.data && (
            <NewChat
              templates={templates.data ?? []}
              onCancel={() => setNewChat(false)}
              onDone={(id) => {
                setNewChat(false);
                void client.invalidateQueries({ queryKey: ["wa-chats"] });
                setSearchParams({ chat: id });
              }}
            />
          )}
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <input className="input" id="wa-search" placeholder="Search name or number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search chats" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chats.isPending && <Spinner />}
            {chats.error && (
              <div className="p-3">
                <ErrorBox error={chats.error} />
              </div>
            )}
            {chats.data?.length === 0 && (
              <EmptyState title="No chats yet">
                Messages people send to your WhatsApp number appear here. Set up the webhook on the{" "}
                <Link to="/sender" className="text-brand-600 underline">
                  My sender
                </Link>{" "}
                page, or start a chat with a template.
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
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="shrink-0 text-xs text-slate-500">{formatRelative(c.lastMessageAt)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-slate-500">{c.lastMessageText ?? ""}</span>
                        {c.unreadCount > 0 && <span className="shrink-0 rounded-full bg-emerald-600 px-2 text-xs font-medium text-white">{c.unreadCount}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Active chat */}
        <section className={`min-h-0 flex-col ${chatId ? "flex" : "hidden md:flex"}`}>
          {!chat ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">Choose a chat on the left, or start a new one.</div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <button className="btn px-2 py-1 md:hidden" onClick={() => setSearchParams({ chat: null })} aria-label="Back to chats">
                  ←
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{chat.name}</p>
                  <p className="text-xs text-slate-500">
                    {chat.phone}
                    {chat.profileName && chat.customName && ` · WhatsApp name: ${chat.profileName}`}
                    {chat.leadId && " · in your leads"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${open ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"}`}
                  title="WhatsApp allows free replies for 24 hours after the person's last message"
                >
                  {open ? `Free reply until ${time(chat.windowOpenUntil!)}` : "24 h passed: template only"}
                </span>
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-3 dark:bg-slate-950/40">
                {messages.isPending && <Spinner />}
                {messages.data?.map((m) => {
                  const d = day(m.createdAt);
                  const showDay = d !== lastDay;
                  lastDay = d;
                  return (
                    <div key={m.id}>
                      {showDay && <p className="my-2 text-center text-xs text-slate-500">{d}</p>}
                      <div className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] space-y-1 rounded-lg px-3 py-2 text-sm shadow-sm ${
                            m.direction === "out" ? "bg-emerald-100 text-slate-900 dark:bg-emerald-900/60 dark:text-emerald-50" : "bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                          }`}
                        >
                          {m.templateName && <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Template: {m.templateName}</p>}
                          <Media m={m} />
                          {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                          {!m.body && !m.mediaMime && <p className="italic text-slate-500">[{m.type}]</p>}
                          <p className="flex items-center justify-end gap-1 text-[11px] text-slate-500">
                            {time(m.createdAt)} <Ticks m={m} />
                          </p>
                          {m.status === "failed" && m.error && <p className="text-xs text-red-600">{m.error}</p>}
                        </div>
                      </div>
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
                      <button className="btn px-2 py-1 text-xs" onClick={() => setText(chat.aiDraft!)}>
                        Use this
                      </button>
                    )}
                    <button className="btn px-2 py-1 text-xs" disabled={redraft.isPending} onClick={() => redraft.mutate()}>
                      {redraft.isPending ? "Writing…" : "Write again"}
                    </button>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-200 p-3 dark:border-slate-800">
                {(sendText.error || sendFile.error || sendTemplate.error || redraft.error) && (
                  <div className="mb-2">
                    <ErrorBox error={sendText.error ?? sendFile.error ?? sendTemplate.error ?? redraft.error} />
                  </div>
                )}
                {fileError && <p className="mb-2 text-sm text-red-600">{fileError}</p>}
                {open ? (
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (text.trim()) sendText.mutate();
                    }}
                  >
                    <input
                      ref={fileInput}
                      type="file"
                      id="wa-file"
                      className="hidden"
                      accept="image/jpeg,image/png,application/pdf,audio/*,video/mp4,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        if (file.size > MAX_FILE) return setFileError("Files up to 5 MB can be sent");
                        setFileError(null);
                        sendFile.mutate(file);
                      }}
                    />
                    <button type="button" className="btn px-3" title="Send a photo or file (up to 5 MB); the text box becomes its caption" onClick={() => fileInput.current?.click()} disabled={sendFile.isPending}>
                      📎
                    </button>
                    <textarea
                      id="wa-text"
                      className="input min-h-[2.75rem] flex-1 resize-y"
                      rows={1}
                      placeholder="Type a message"
                      value={text}
                      maxLength={4096}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (text.trim()) sendText.mutate();
                        }
                      }}
                    />
                    <button className="btn btn-primary" disabled={!text.trim() || sendText.isPending}>
                      {sendText.isPending || sendFile.isPending ? "Sending…" : "Send"}
                    </button>
                  </form>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      WhatsApp allows free messages only for 24 hours after the person's last message. Send an approved template; when they reply, you can chat freely again.
                    </p>
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
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
