import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatRelative } from "../lib/format";
import { useMe } from "../lib/me";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { WhatsAppTemplate } from "../lib/types";
import { ChatView, PlatformIcon } from "./InboxPage";
import { ContactStrip } from "./messages/ContactStrip";
import { ding, NewChat, WhatsAppConversation } from "./whatsapp/Conversation";

// All messages: WhatsApp, Facebook Messenger, Instagram, Telegram and LinkedIn chats in one list.
// Opening a chat shows that app's own chat screen (WhatsApp Chat or the AI Inbox), with the
// reply box, AI draft and the app's rules (24-hour reply window, templates…).

type Platform = "whatsapp" | "facebook" | "instagram" | "telegram" | "linkedin";
type Filter = "all" | "unread" | "needs_reply";

interface UnifiedChat {
  source: "whatsapp" | "inbox";
  id: string;
  platform: Platform;
  name: string;
  handle: string | null;
  lastMessageText: string | null;
  lastMessageFromMe: boolean;
  lastMessageAt: string;
  unreadCount: number;
  needsReply: boolean;
  draftReady: boolean;
  pinned: boolean;
  muted: boolean;
  replyUntil: string | null;
  labels: string[];
  contactId: string | null;
  notes: string | null;
}

interface Summary {
  unread: number;
  needsReply: number;
  counts: Record<string, { chats: number; unread: number }>;
  latest: { source: string; id: string; platform: Platform; name: string; text: string | null; at: string } | null;
}

const LABEL: Record<Platform, string> = { whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram", telegram: "Telegram", linkedin: "LinkedIn" };
const NOTIFY_KEY = "messages-notify";

function AppIcon({ platform, size = "h-10 w-10" }: { platform: Platform; size?: string }) {
  if (platform !== "whatsapp") return <PlatformIcon platform={platform} size={size} />;
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-[#25D366] text-sm font-bold text-white`} title="WhatsApp" aria-hidden>
      ✆
    </span>
  );
}

/** How long a free reply is still allowed (WhatsApp, Messenger and Instagram: 24 hours). */
function ReplyWindow({ until }: { until: string | null }) {
  if (until === "always") return null;
  if (!until) return <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-500 dark:bg-slate-800">24 h passed</span>;
  const hours = Math.max(0, (new Date(until).getTime() - Date.now()) / 3600_000);
  const tone = hours < 3 ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
  return (
    <span className={`rounded px-1.5 text-[10px] ${tone}`} title="Time left to reply freely">
      {hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min left` : `${Math.floor(hours)} h left`}
    </span>
  );
}

const keyOf = (c: Pick<UnifiedChat, "source" | "id">) => `${c.source === "whatsapp" ? "wa" : "in"}:${c.id}`;

export function MessagesPage() {
  const client = useQueryClient();
  const me = useMe();
  const params = useSearchParams();
  const selected = params.get("chat") ?? "";
  const platform = (params.get("app") ?? "") as Platform | "";
  const filter = (params.get("filter") ?? "all") as Filter;
  const q = params.get("q") ?? "";
  const label = params.get("label") ?? "";
  const contact = params.get("contact") ?? "";
  const [search, setSearch] = useState(q);
  const [newChat, setNewChat] = useState<{ phone?: string; name?: string } | null>(null);
  const [notify, setNotify] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const [permission, setPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");

  const superAdmin = me?.role === "super_admin";
  const hasWhatsApp = superAdmin || !!me?.services.includes("whatsapp");
  const hasInbox = superAdmin || !!me?.services.includes("ai_inbox");
  const apps = (["whatsapp", "facebook", "instagram", "telegram", "linkedin"] as Platform[]).filter((p) => (p === "whatsapp" ? hasWhatsApp : hasInbox));

  const labels = useQuery({ queryKey: ["messages", "labels"], queryFn: () => api<{ items: string[] }>("/messages/labels").then((r) => r.items) });
  const list = useQuery({
    queryKey: ["messages", "chats", platform, filter, q, label, contact],
    queryFn: () => api<{ items: UnifiedChat[]; counts: Summary["counts"] }>(`/messages/chats${qs({ platform, filter: filter === "all" ? "" : filter, q, label, contactId: contact })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const summary = useQuery({ queryKey: ["messages", "summary"], queryFn: () => api<Summary>("/messages/summary"), refetchInterval: 30_000 });
  const templates = useQuery({
    queryKey: ["wa-templates-approved"],
    queryFn: () => api<{ items: WhatsAppTemplate[] }>("/whatsapp/templates").then((r) => r.items.filter((t) => t.approvalStatus === "approved")),
    enabled: !!newChat,
  });

  // A sound and a browser notification when new messages arrive (any app).
  const lastUnread = useRef<number | null>(null);
  useEffect(() => {
    const s = summary.data;
    if (!s) return;
    const before = lastUnread.current;
    lastUnread.current = s.unread;
    if (before === null || s.unread <= before || !notify || !s.latest) return;
    const latest = s.latest;
    if (keyOf({ source: latest.source as UnifiedChat["source"], id: latest.id }) === selected && document.hasFocus()) return;
    ding();
    if (permission === "granted") {
      const n = new Notification(`${latest.name} · ${LABEL[latest.platform]}`, { body: latest.text ?? "New message", tag: latest.id });
      n.onclick = () => {
        window.focus();
        setSearchParams({ chat: keyOf({ source: latest.source as UnifiedChat["source"], id: latest.id }) });
      };
    }
  }, [summary.data, notify, permission, selected]);

  const toggleNotify = () => {
    const next = !notify;
    setNotify(next);
    try {
      localStorage.setItem(NOTIFY_KEY, next ? "on" : "off");
    } catch {
      /* private window */
    }
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().then(setPermission);
  };

  const [kind, id] = selected.split(":") as ["wa" | "in" | undefined, string | undefined];
  const openChat = list.data?.items.find((c) => keyOf(c) === selected) ?? null;
  const counts = list.data?.counts ?? summary.data?.counts ?? {};
  const total = (p: Platform | "") => (p ? (counts[p]?.chats ?? 0) : Object.values(counts).reduce((a, c) => a + c.chats, 0));
  const unreadOf = (p: Platform | "") => (p ? (counts[p]?.unread ?? 0) : Object.values(counts).reduce((a, c) => a + c.unread, 0));

  return (
    <>
      <PageHeader
        title="All messages"
        subtitle="WhatsApp, Facebook, Instagram, Telegram and LinkedIn chats in one place. Newest on top; open a chat to reply."
        actions={
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={toggleNotify} title="Sound and browser notification for new messages">
              {notify ? "🔔 Notifications on" : "🔕 Notifications off"}
            </button>
            {hasWhatsApp && (
              <button className="btn btn-primary" onClick={() => setNewChat({})}>
                + New WhatsApp chat
              </button>
            )}
          </div>
        }
      />

      {!hasWhatsApp && !hasInbox ? (
        <EmptyState title="No chat apps on your account">Ask the administrator to switch on WhatsApp or the AI Inbox for you.</EmptyState>
      ) : (
        <div className="card flex h-[calc(100vh-12rem)] min-h-[34rem] overflow-hidden">
          <aside className={`flex min-h-0 w-full flex-col border-slate-200 md:w-96 md:shrink-0 md:border-r dark:border-slate-800 ${selected ? "hidden md:flex" : "flex"}`}>
            {newChat && templates.data && (
              <NewChat
                templates={templates.data}
                phone={newChat.phone}
                name={newChat.name}
                onCancel={() => setNewChat(null)}
                onDone={(chatId) => {
                  setNewChat(null);
                  void client.invalidateQueries({ queryKey: ["messages"] });
                  setSearchParams({ chat: `wa:${chatId}` });
                }}
              />
            )}
            <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
              <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="App">
                {(["", ...apps] as (Platform | "")[]).map((p) => (
                  <button
                    key={p || "all"}
                    role="tab"
                    aria-selected={platform === p}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs ${platform === p ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}
                    onClick={() => setSearchParams({ app: p || null, chat: null })}
                  >
                    {p ? LABEL[p] : "All"}
                    <span className="opacity-70">{total(p)}</span>
                    {unreadOf(p) > 0 && <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">{unreadOf(p)}</span>}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearchParams({ q: search || null });
                }}
              >
                <input className="input" placeholder="Search name, number or username" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search chats" />
                <button className="btn">Search</button>
              </form>
              <div className="flex gap-1">
                {(
                  [
                    ["all", "All"],
                    ["unread", "Unread"],
                    ["needs_reply", "Needs reply"],
                  ] as const
                ).map(([f, text]) => (
                  <button key={f} className={`rounded-full px-2.5 py-0.5 text-xs ${filter === f ? "bg-emerald-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setSearchParams({ filter: f === "all" ? null : f })}>
                    {text}
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
              {contact && (
                <p className="flex items-center justify-between rounded bg-brand-50 px-2 py-1 text-xs text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">
                  Showing one person&apos;s chats on every app
                  <button onClick={() => setSearchParams({ contact: null })} aria-label="Show all chats">
                    ✕
                  </button>
                </p>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {list.isPending && <Spinner />}
              {list.error && (
                <div className="p-3">
                  <ErrorBox error={list.error} />
                </div>
              )}
              {list.data?.items.length === 0 && (
                <EmptyState title={filter === "all" && !q ? "No chats yet" : "Nothing here"}>
                  {filter === "all" && !q && (
                    <>
                      Connect your apps:{" "}
                      {hasWhatsApp && (
                        <Link to="/sender" className="text-brand-600 underline">
                          WhatsApp (My sender)
                        </Link>
                      )}
                      {hasWhatsApp && hasInbox && ", "}
                      {hasInbox && (
                        <Link to="/inbox?tab=setup" className="text-brand-600 underline">
                          Telegram, Facebook, Instagram, LinkedIn (AI Inbox → Setup)
                        </Link>
                      )}
                      .
                    </>
                  )}
                </EmptyState>
              )}
              <ul>
                {list.data?.items.map((c) => {
                  const key = keyOf(c);
                  return (
                    <li key={key}>
                      <button
                        className={`flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60 ${key === selected ? "bg-brand-50/70 dark:bg-brand-700/20" : ""}`}
                        onClick={() => setSearchParams({ chat: key })}
                      >
                        <AppIcon platform={c.platform} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={`truncate ${c.unreadCount > 0 ? "font-semibold" : "font-medium"}`}>{c.name}</span>
                            <span className={`shrink-0 text-xs ${c.unreadCount > 0 ? "text-emerald-600" : "text-slate-500"}`}>{formatRelative(c.lastMessageAt)}</span>
                          </span>
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm text-slate-500">
                              {c.lastMessageFromMe && "You: "}
                              {c.lastMessageText ?? ""}
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-xs">
                              {c.muted && <span title="Muted">🔕</span>}
                              {c.pinned && <span title="Pinned">📌</span>}
                              {c.unreadCount > 0 && <span className="rounded-full bg-emerald-600 px-2 font-medium text-white">{c.unreadCount}</span>}
                            </span>
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                            <span>{LABEL[c.platform]}</span>
                            {c.handle && <span className="truncate">· {c.handle}</span>}
                            <ReplyWindow until={c.replyUntil} />
                            {c.draftReady && <span className="rounded bg-violet-50 px-1.5 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">✦ AI draft</span>}
                            {c.needsReply && !c.draftReady && <span className="rounded bg-amber-50 px-1.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Needs reply</span>}
                            {c.labels.map((l) => (
                              <span key={l} className="rounded bg-slate-100 px-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {l}
                              </span>
                            ))}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          <section className={`min-h-0 min-w-0 flex-1 flex-col ${selected ? "flex" : "hidden md:flex"}`}>
            {(kind === "wa" || kind === "in") && id && (
              <ContactStrip
                key={selected}
                source={kind === "wa" ? "whatsapp" : "inbox"}
                id={id}
                chatName={openChat?.name ?? ""}
                inboxLabels={openChat?.labels ?? []}
                inboxNotes={openChat?.notes ?? null}
                knownLabels={labels.data ?? []}
              />
            )}
            {kind === "wa" && id ? (
              <WhatsAppConversation key={selected} chatId={id} onBack={() => setSearchParams({ chat: null })} onNewChat={(phone, name) => setNewChat({ phone, name })} />
            ) : kind === "in" && id ? (
              <ChatView key={selected} id={id} onBack={() => setSearchParams({ chat: null })} />
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">
                Choose a chat on the left. Settings: {hasWhatsApp && <Link to="/whatsapp-chat" className="mx-1 text-brand-600 underline">WhatsApp Chat ⚙</Link>}
                {hasInbox && (
                  <Link to="/inbox?tab=setup" className="mx-1 text-brand-600 underline">
                    AI Inbox setup
                  </Link>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
