import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatRelative } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { WhatsAppTemplate } from "../lib/types";
import { ding, NewChat, WhatsAppConversation } from "./whatsapp/Conversation";
import { SettingsPanel } from "./whatsapp/SettingsPanel";
import type { Chat, ChatSettings } from "./whatsapp/types";

// WhatsApp Chat: two-way chats through your own WhatsApp number (Meta Cloud API), with what the
// WhatsApp app and the Cloud API have in common. New messages, ticks and AI drafts arrive live.
// Free messages within 24 hours of the person's last message; after that, and for a new chat,
// only an approved template (WhatsApp's rule). The AI draft is sent only when you press Send.

type Filter = "all" | "unread" | "starred" | "archived";

export function WhatsAppChatPage() {
  const client = useQueryClient();
  const params = useSearchParams();
  const chatId = params.get("chat") ?? "";
  const filter = (params.get("filter") ?? "all") as Filter;
  const label = params.get("label") ?? "";
  const [search, setSearch] = useState("");
  const [newChat, setNewChat] = useState<{ phone?: string; name?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifyPermission, setNotifyPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");

  const chats = useQuery({
    queryKey: ["wa-chats", search, filter, label],
    queryFn: () => api<{ items: Chat[] }>(`/whatsapp/chats${qs({ q: search, filter: filter === "all" ? "" : filter, label })}`).then((r) => r.items),
    refetchInterval: 60_000,
  });
  const allChats = useQuery({ queryKey: ["wa-chats", "all-for-notify"], queryFn: () => api<{ items: Chat[] }>("/whatsapp/chats").then((r) => r.items), refetchInterval: 60_000 });
  const labels = useQuery({ queryKey: ["wa-chats", "labels"], queryFn: () => api<{ items: string[] }>("/whatsapp/chat-labels").then((r) => r.items) });
  const settings = useQuery({ queryKey: ["wa-settings"], queryFn: () => api<{ settings: ChatSettings }>("/whatsapp/chat-settings").then((r) => r.settings) });
  const templates = useQuery({
    queryKey: ["wa-templates-approved"],
    queryFn: () => api<{ items: WhatsAppTemplate[] }>("/whatsapp/templates").then((r) => r.items.filter((t) => t.approvalStatus === "approved")),
  });

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
          {!chatId ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">Choose a chat on the left, or start a new one.</div>
          ) : (
            <WhatsAppConversation key={chatId} chatId={chatId} onBack={() => setSearchParams({ chat: null })} onNewChat={(phone, name) => setNewChat({ phone, name })} />
          )}
        </section>
      </div>

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
