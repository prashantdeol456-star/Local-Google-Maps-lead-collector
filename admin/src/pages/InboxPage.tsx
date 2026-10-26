import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { formatDate, formatRelative } from "../lib/format";
import { Link, setSearchParams, useSearchParams } from "../lib/router";

// AI Inbox: chats from Telegram, Facebook, Instagram and LinkedIn in one place. The AI answers
// what it can (smart mode), and keeps the rest as drafts for you.

type Platform = "telegram" | "facebook" | "instagram" | "linkedin";
type Mode = "smart" | "auto" | "draft" | "off";
type ChatStatus = "needs_reply" | "draft_ready" | "replied" | "handled" | "no_reply";

interface Conversation {
  id: string;
  platform: Platform;
  participantName: string;
  participantUsername: string | null;
  participantId: string | null;
  replyMode: Mode | null;
  status: ChatStatus;
  lastIntent: string | null;
  summary: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string;
}
interface ListItem extends Conversation {
  lastMessage: { direction: "in" | "out"; text: string; author: string; sentAt: string } | null;
  pendingDraft: { id: string; text: string; confidence: number | null; needsHuman: boolean; decision: string | null } | null;
}
interface Message {
  id: string;
  direction: "in" | "out";
  text: string;
  author: string;
  sentAt: string;
}
interface Draft {
  id: string;
  status: string;
  text: string;
  intent: string | null;
  summary: string | null;
  language: string | null;
  confidence: number | null;
  needsHuman: boolean;
  decision: string | null;
  error: string | null;
  createdAt: string;
}
interface Detail {
  conversation: Conversation;
  effectiveMode: Mode;
  canReplyHere: boolean;
  messages: Message[];
  drafts: Draft[];
}
interface Settings {
  enabled: boolean;
  businessProfile: string;
  faqs: string;
  style: string;
  neverSay: string;
  modes: Record<Platform, Mode>;
  minConfidence: number;
  maxAutoPerChatPerDay: number;
}
interface Status {
  ai: { configured: boolean; model: string | null };
  telegram: { configured: boolean };
  facebook: { configured: boolean; accounts: { id: string; name: string; status: string; lastError: string | null }[] };
  instagram: { configured: boolean; accounts: { id: string; name: string; status: string; lastError: string | null }[] };
  linkedin: { configured: boolean };
  counts: Partial<Record<ChatStatus, number>>;
}

const PLATFORM: Record<Platform, { label: string; icon: string; tone: string }> = {
  telegram: { label: "Telegram", icon: "✈", tone: "bg-[#229ED9] text-white" },
  facebook: { label: "Facebook", icon: "f", tone: "bg-[#1877F2] text-white" },
  instagram: { label: "Instagram", icon: "◎", tone: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white" },
  linkedin: { label: "LinkedIn", icon: "in", tone: "bg-[#0A66C2] text-white" },
};

const STATUS: Record<ChatStatus, { label: string; tone: string }> = {
  needs_reply: { label: "Needs reply", tone: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" },
  draft_ready: { label: "Draft ready", tone: "bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100" },
  replied: { label: "Replied", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" },
  handled: { label: "Done", tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  no_reply: { label: "No reply needed", tone: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

const MODE_LABEL: Record<Mode, string> = {
  smart: "Smart: auto-send when sure, else draft",
  auto: "Always auto-send",
  draft: "Drafts only (you approve)",
  off: "Off (no AI replies)",
};

const AUTHOR_LABEL: Record<string, string> = { ai_auto: "AI · sent automatically", ai_approved: "AI · approved by you", admin: "You", elsewhere: "You (in the app)", customer: "" };

function PlatformIcon({ platform, size = "h-8 w-8" }: { platform: Platform; size?: string }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full text-xs font-bold ${PLATFORM[platform].tone}`} title={PLATFORM[platform].label} aria-hidden>
      {PLATFORM[platform].icon}
    </span>
  );
}

function StatusPill({ status }: { status: ChatStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[status].tone}`}>{STATUS[status].label}</span>;
}

// ---- Chats ----

function DraftCard({ draft, conversation, canReplyHere, onDone }: { draft: Draft; conversation: Conversation; canReplyHere: boolean; onDone: () => void }) {
  const [text, setText] = useState(draft.text);
  useEffect(() => {
    setText(draft.text);
  }, [draft.id, draft.text]);
  const approve = useMutation({
    mutationFn: () => api<{ sent: boolean; queuedForExtension: boolean }>(`/inbox/drafts/${draft.id}/approve`, { method: "POST", body: { text } }),
    onSettled: onDone,
  });
  const dismiss = useMutation({ mutationFn: () => api(`/inbox/drafts/${draft.id}/dismiss`, { method: "POST" }), onSettled: onDone });
  const isLinkedIn = conversation.platform === "linkedin";
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-700/40 dark:bg-brand-700/10">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-brand-700 dark:text-brand-100">✦ AI draft</span>
        {draft.confidence !== null && <span className="text-slate-500">confidence {Math.round(draft.confidence * 100)}%</span>}
        {draft.intent && <span className="rounded bg-white px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{draft.intent}</span>}
        {draft.language && <span className="text-slate-500">{draft.language}</span>}
      </div>
      {draft.decision && <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{draft.decision}</p>}
      <textarea className="input min-h-24 text-sm" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} aria-label="Reply text" />
      {(approve.error || dismiss.error) && <div className="mt-2"><ErrorBox error={approve.error ?? dismiss.error} /></div>}
      {approve.data?.queuedForExtension && <p className="mt-2 text-xs text-emerald-700">Saved. The LinkedIn Messenger extension will type it into the chat for you to send.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={approve.isPending || !text.trim() || (!isLinkedIn && !canReplyHere)} onClick={() => approve.mutate()}>
          {approve.isPending ? "Sending…" : isLinkedIn ? "Approve for LinkedIn" : text.trim() !== draft.text ? "Send edited reply" : "Send"}
        </button>
        <button className="btn" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
          Dismiss
        </button>
      </div>
      {!isLinkedIn && !canReplyHere && <p className="mt-2 text-xs text-slate-500">Facebook/Instagram only allow replies within 24 hours of their last message. Reply in the app.</p>}
    </div>
  );
}

function ChatView({ id }: { id: string }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ["inbox", "conversation", id], queryFn: () => api<Detail>(`/inbox/conversations/${id}`), refetchInterval: 20_000 });
  const refresh = () => client.invalidateQueries({ queryKey: ["inbox"] });
  const [reply, setReply] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const write = useMutation({ mutationFn: () => api(`/inbox/conversations/${id}/ai-reply`, { method: "POST" }), onSettled: refresh });
  const sendManual = useMutation({
    mutationFn: () => api<{ sent: boolean; queuedForExtension: boolean }>(`/inbox/conversations/${id}/send`, { method: "POST", body: { text: reply } }),
    onSuccess: () => setReply(""),
    onSettled: refresh,
  });
  const handled = useMutation({ mutationFn: () => api(`/inbox/conversations/${id}/handled`, { method: "POST" }), onSettled: refresh });
  const setMode = useMutation({ mutationFn: (mode: Mode | null) => api(`/inbox/conversations/${id}/mode`, { method: "PATCH", body: { mode } }), onSettled: refresh });

  // Braces matter: newer browsers return a Promise from scrollIntoView, and React would take it as the cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [detail.data?.messages.length]);

  if (detail.isPending) return <Spinner />;
  if (detail.error) return <div className="p-4"><ErrorBox error={detail.error} /></div>;
  const { conversation: c, messages, drafts, effectiveMode, canReplyHere } = detail.data;
  const pending = drafts.find((d) => d.status === "pending");
  const lastFailed = drafts[0]?.status === "failed" ? drafts[0] : null;
  const isLinkedIn = c.platform === "linkedin";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (reply.trim()) sendManual.mutate();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-start gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <PlatformIcon platform={c.platform} size="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {c.participantName}
            {c.participantUsername && <span className="ml-2 text-sm font-normal text-slate-500">@{c.participantUsername}</span>}
          </p>
          {c.summary && <p className="text-sm text-slate-600 dark:text-slate-300">✦ {c.summary}</p>}
          <p className="text-xs text-slate-500">
            {PLATFORM[c.platform].label}
            {c.lastIntent && ` · ${c.lastIntent}`} · <StatusPill status={c.status} />
          </p>
        </div>
        <label className="text-xs">
          <span className="label block">AI for this chat</span>
          <select className="input mt-1 w-auto py-1 text-xs" value={c.replyMode ?? ""} onChange={(e) => setMode.mutate((e.target.value || null) as Mode | null)}>
            <option value="">Default ({effectiveMode})</option>
            {(["smart", "auto", "draft", "off"] as Mode[]).map((m) => (
              <option key={m} value={m} disabled={isLinkedIn && m === "auto"}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950/40">
        {messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                m.direction === "out" ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              <p className={`mt-1 text-[10px] ${m.direction === "out" ? "text-white/70" : "text-slate-400"}`}>
                {formatDate(m.sentAt)}
                {AUTHOR_LABEL[m.author] && ` · ${AUTHOR_LABEL[m.author]}`}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800">
        {pending && <DraftCard draft={pending} conversation={c} canReplyHere={canReplyHere} onDone={refresh} />}
        {lastFailed && !pending && (
          <p className="text-xs text-red-600 dark:text-red-400">
            The AI could not write a reply: {lastFailed.error}
          </p>
        )}
        {write.error && <ErrorBox error={write.error} />}
        {sendManual.error && <ErrorBox error={sendManual.error} />}
        {sendManual.data?.queuedForExtension && <p className="text-xs text-emerald-700">Saved. The LinkedIn Messenger extension will type it for you to send.</p>}
        <form onSubmit={submit} className="flex gap-2">
          <input
            className="input flex-1"
            placeholder={isLinkedIn ? "Write a reply (the extension types it on LinkedIn)…" : canReplyHere ? "Write your own reply…" : "Over 24 hours: reply in the app"}
            value={reply}
            maxLength={4000}
            onChange={(e) => setReply(e.target.value)}
            disabled={!isLinkedIn && !canReplyHere}
          />
          <button className="btn btn-primary" disabled={sendManual.isPending || !reply.trim()}>
            Send
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={write.isPending} onClick={() => write.mutate()}>
            {write.isPending ? "AI is writing…" : pending ? "✦ Rewrite with AI" : "✦ Write reply with AI"}
          </button>
          {c.status !== "handled" && (
            <button className="btn" onClick={() => handled.mutate()}>
              Mark as done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatsTab() {
  const client = useQueryClient();
  const params = useSearchParams();
  const selected = params.get("chat");
  const platform = (params.get("platform") ?? "") as Platform | "";
  const status = (params.get("status") ?? "") as ChatStatus | "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const list = useQuery({
    queryKey: ["inbox", "list", platform, status, params.get("q")],
    queryFn: () => api<{ items: ListItem[]; total: number }>(`/inbox/conversations${qs({ platform, status, q: params.get("q"), pageSize: 100 })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });
  const refresh = useMutation({ mutationFn: () => api("/inbox/refresh", { method: "POST" }), onSettled: () => client.invalidateQueries({ queryKey: ["inbox"] }) });

  return (
    <div className="card grid min-h-[70vh] overflow-hidden lg:grid-cols-[22rem_1fr]">
      <aside className="flex min-h-0 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r dark:border-slate-800">
        <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearchParams({ q });
            }}
          >
            <input className="input" placeholder="Search name or summary" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
            <button className="btn" type="button" title="Check for new messages now" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? "…" : "⟳"}
            </button>
          </form>
          <div className="flex gap-2">
            <select className="input py-1 text-xs" value={platform} onChange={(e) => setSearchParams({ platform: e.target.value })} aria-label="Platform">
              <option value="">All apps</option>
              {(Object.keys(PLATFORM) as Platform[]).map((p) => (
                <option key={p} value={p}>
                  {PLATFORM[p].label}
                </option>
              ))}
            </select>
            <select className="input py-1 text-xs" value={status} onChange={(e) => setSearchParams({ status: e.target.value })} aria-label="Status">
              <option value="">Any status</option>
              {(Object.keys(STATUS) as ChatStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {list.isPending && <Spinner />}
          {list.error && <div className="p-3"><ErrorBox error={list.error} /></div>}
          {list.data?.items.length === 0 && <EmptyState title="No chats yet">New messages appear here once an app is connected (see Setup).</EmptyState>}
          {list.data?.items.map((c) => (
            <li key={c.id}>
              <button
                className={`flex w-full gap-3 px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 ${selected === c.id ? "bg-brand-50/70 dark:bg-brand-700/10" : ""}`}
                onClick={() => setSearchParams({ chat: c.id })}
              >
                <PlatformIcon platform={c.platform} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.participantName}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{formatRelative(c.lastMessageAt)}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {c.lastMessage ? `${c.lastMessage.direction === "out" ? "You: " : ""}${c.lastMessage.text}` : "—"}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <StatusPill status={c.status} />
                    {c.pendingDraft?.needsHuman && <span className="text-[11px] text-amber-600">needs you</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="min-h-[60vh]">{selected ? <ChatView key={selected} id={selected} /> : <EmptyState title="Pick a chat">Chats needing you are marked "Needs reply" or "Draft ready".</EmptyState>}</section>
    </div>
  );
}

// ---- AI instructions ----

function Area({ label, hint, value, onChange, rows = 6, placeholder }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <textarea className="input text-sm" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function InstructionsTab() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["inbox", "settings"], queryFn: () => api<{ settings: Settings }>("/inbox/settings").then((r) => r.settings) });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (s: Settings) => api<{ settings: Settings }>("/inbox/settings", { method: "PUT", body: s }),
    onSuccess: (r) => {
      setForm(r.settings);
      client.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
  if (settings.isPending || !form) return <Spinner />;
  if (settings.error) return <ErrorBox error={settings.error} />;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });

  return (
    <form
      className="grid gap-6 xl:grid-cols-[1fr_22rem]"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
    >
      <div className="card space-y-4 p-5">
        <h2 className="font-medium">What the AI knows</h2>
        <Area
          label="About your business"
          rows={7}
          value={form.businessProfile}
          onChange={(v) => set("businessProfile", v)}
          placeholder={"Who you are, what you sell or do, prices, location, timings, delivery, website, how to order or book.\ne.g. Acme Bakery, Gomti Nagar, Lucknow. Open 10am–7pm, closed Monday. Custom cakes from ₹900/kg…"}
        />
        <Area
          label="FAQs (questions and answers)"
          rows={8}
          value={form.faqs}
          onChange={(v) => set("faqs", v)}
          placeholder={"Q: Do you deliver?\nA: Yes, free delivery above ₹500 within 5 km.\n\nQ: Eggless?\nA: All cakes can be made eggless."}
          hint="The AI only states facts written here or above. Anything else it leaves for you."
        />
        <Area
          label="Style"
          rows={3}
          value={form.style}
          onChange={(v) => set("style", v)}
          placeholder={"Friendly, short. Reply in the customer's language (Hindi, English or Hinglish). Sign as Team Acme."}
        />
        <Area
          label="Never answer yourself (leave for me)"
          rows={3}
          value={form.neverSay}
          onChange={(v) => set("neverSay", v)}
          placeholder={"Discounts, refunds, bulk/corporate orders, anything about payments."}
        />
      </div>

      <div className="space-y-6">
        <div className="card space-y-4 p-5">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="font-medium">AI replies</span>
              <span className="block text-xs text-slate-500">Off: nothing is written or sent.</span>
            </span>
            <input type="checkbox" className="h-5 w-5" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          </label>
          {(Object.keys(PLATFORM) as Platform[]).map((p) => (
            <label key={p} className="block space-y-1">
              <span className="label flex items-center gap-2">
                <PlatformIcon platform={p} size="h-5 w-5" /> {PLATFORM[p].label}
              </span>
              <select className="input text-sm" value={form.modes[p]} onChange={(e) => set("modes", { ...form.modes, [p]: e.target.value as Mode })}>
                {(["smart", "auto", "draft", "off"] as Mode[]).map((m) => (
                  <option key={m} value={m} disabled={p === "linkedin" && m === "auto"}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="text-xs text-slate-500">LinkedIn is always typed for you to send (LinkedIn does not allow automated messages).</p>
        </div>
        <div className="card space-y-4 p-5">
          <label className="block space-y-1">
            <span className="label">Smart mode: send on its own from {Math.round(form.minConfidence * 100)}% confidence</span>
            <input type="range" min={0.5} max={1} step={0.05} value={form.minConfidence} onChange={(e) => set("minConfidence", Number(e.target.value))} className="w-full" />
          </label>
          <label className="block space-y-1">
            <span className="label">Most automatic replies per chat per day</span>
            <input className="input" type="number" min={1} max={50} value={form.maxAutoPerChatPerDay} onChange={(e) => set("maxAutoPerChatPerDay", Number(e.target.value))} />
          </label>
          <p className="text-xs text-slate-500">
            Never sent automatically, whatever the confidence: complaints, orders, partnerships, job requests, anything the AI marks "needs you", and Facebook/Instagram
            chats older than 24 hours.
          </p>
        </div>
        {save.error && <ErrorBox error={save.error} />}
        {save.isSuccess && <p className="text-sm text-emerald-700">Saved.</p>}
        <button className="btn btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save AI settings"}
        </button>
      </div>
    </form>
  );
}

// ---- Setup ----

function Step({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 px-5 py-4">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200"}`}>
        {ok ? "✓" : "•"}
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-medium">{title}</p>
        <div className="mt-1 space-y-1 text-slate-600 dark:text-slate-300">{children}</div>
      </div>
    </li>
  );
}

function SetupTab() {
  const status = useQuery({ queryKey: ["inbox", "status"], queryFn: () => api<Status>("/inbox/status") });
  if (status.isPending) return <Spinner />;
  if (status.error) return <ErrorBox error={status.error} />;
  const s = status.data;
  const fbOk = s.facebook.accounts.some((a) => a.status === "connected");
  const igOk = s.instagram.accounts.some((a) => a.status === "connected");
  const problems = [...s.facebook.accounts, ...s.instagram.accounts].filter((a) => a.lastError);
  return (
    <div className="card">
      <ol className="divide-y divide-slate-100 dark:divide-slate-800">
        <Step ok={s.ai.configured} title={s.ai.configured ? `AI: Claude (${s.ai.model})` : "AI: add your Claude API key"}>
          <p>
            Put <code>ANTHROPIC_API_KEY</code> in <code>backend/.env</code> (from console.anthropic.com → API keys) and restart the backend. Optional: <code>INBOX_AI_MODEL</code>{" "}
            (default <code>claude-opus-5-5</code>), <code>INBOX_AI_EFFORT</code> (low / medium / high).
          </p>
        </Step>
        <Step ok={s.telegram.configured} title="Telegram bot">
          <p>
            In Telegram, open <strong>@BotFather</strong> → <code>/newbot</code> → copy the token into <code>TELEGRAM_BOT_TOKEN</code> in <code>backend/.env</code>, and restart. Share
            your bot link (t.me/your_bot) with customers. The AI replies in private chats only, never in groups.
          </p>
        </Step>
        <Step ok={fbOk} title="Facebook Page messages">
          <p>
            Connect your Page under <Link to="/social" className="text-brand-600 hover:underline">Social Accounts</Link>, allowing the messaging permissions. New messages are
            checked every minute. Facebook allows replies within 24 hours of the person&apos;s last message.
          </p>
        </Step>
        <Step ok={igOk} title="Instagram DMs">
          <p>
            Your Instagram must be a Business or Creator account linked to the Facebook Page. In the Instagram app, turn on <em>Settings → Messages and story replies → Message
            controls → Allow access to messages</em> (Connected tools). Same 24-hour rule.
          </p>
        </Step>
        <Step ok={false} title="LinkedIn messages (through the extension)">
          <p>
            In the <strong>LinkedIn Messenger</strong> extension&apos;s side panel, open <em>Inbox (AI replies)</em> → <em>Watch my LinkedIn messages</em>. Keep the side panel open
            while you work. The AI&apos;s replies are typed into the chat, and you press Send.
          </p>
        </Step>
        <Step ok={false} title="Write what the AI knows, then turn AI replies on">
          <p>Fill in AI instructions (about your business, FAQs, style), then tick “AI replies”. Start with Drafts only for a day to check the answers, then switch to Smart.</p>
        </Step>
      </ol>
      {problems.length > 0 && (
        <div className="border-t border-slate-200 p-5 text-sm dark:border-slate-800">
          <p className="font-medium text-red-600">Problems reading messages</p>
          <ul className="mt-1 list-inside list-disc text-red-600">
            {problems.map((a) => (
              <li key={a.id}>
                {a.name}: {a.lastError}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- Page ----

const TABS = [
  { id: "chats", label: "Chats" },
  { id: "instructions", label: "✦ AI instructions" },
  { id: "setup", label: "Setup" },
] as const;

export function InboxPage() {
  const params = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "chats";
  const status = useQuery({ queryKey: ["inbox", "status"], queryFn: () => api<Status>("/inbox/status"), refetchInterval: 30_000 });
  const settings = useQuery({ queryKey: ["inbox", "settings"], queryFn: () => api<{ settings: Settings }>("/inbox/settings").then((r) => r.settings) });
  const counts = status.data?.counts ?? {};
  return (
    <>
      <PageHeader
        title="AI Inbox"
        subtitle="Telegram, Facebook, Instagram and LinkedIn chats in one place. The AI reads each chat's history and replies, or leaves a draft for you."
        actions={
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${settings.data?.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
            AI replies {settings.data?.enabled ? "on" : "off"}
          </span>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800" aria-label="AI Inbox">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setSearchParams({ tab: t.id === "chats" ? null : t.id, chat: null })}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.id ? "border-brand-600 text-brand-600" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="text-xs text-slate-500">
          {counts.needs_reply ?? 0} need a reply · {counts.draft_ready ?? 0} drafts waiting · {counts.replied ?? 0} replied
        </span>
      </div>
      {tab === "chats" && <ChatsTab />}
      {tab === "instructions" && <InstructionsTab />}
      {tab === "setup" && <SetupTab />}
    </>
  );
}
