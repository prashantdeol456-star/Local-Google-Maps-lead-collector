import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmButton, EmptyState, ErrorBox, PageHeader, Pagination, Spinner, StatCard } from "../components/ui";
import { api, qs, withViewOwner } from "../lib/api";
import { formatDate, formatRelative, safeHref } from "../lib/format";
import { useIsSuperAdmin } from "../lib/me";
import { Link, setSearchParams, useSearchParams } from "../lib/router";
import type { Page } from "../lib/types";

// Social Engagement: who commented, reacted or shared on your own Facebook Page and Instagram
// posts (read with the accounts connected under Social Accounts), as a live feed, a people list
// and a list of posts. Reply to comments from here.

type Platform = "facebook" | "instagram";

interface Account {
  id: string;
  platform: Platform;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  status: string;
  syncedAt: string | null;
  error: string | null;
  realtime: boolean;
  posts: number;
}

interface PersonRef {
  id: string;
  name: string;
  username: string | null;
  profileUrl: string | null;
  pictureUrl: string | null;
  status: string;
}

interface Engagement {
  id: string;
  platform: Platform;
  kind: "comment" | "reaction" | "share";
  reactionType: string | null;
  text: string | null;
  parentExternalId: string | null;
  permalink: string | null;
  leadSignal: boolean;
  repliedAt: string | null;
  replyText: string | null;
  privateReplyAt: string | null;
  occurredAt: string;
  person: PersonRef | null;
  post: { id: string; message: string | null; permalink: string | null; imageUrl: string | null } | null;
}

interface Person {
  id: string;
  platform: Platform;
  externalId: string;
  name: string;
  username: string | null;
  profileUrl: string | null;
  pictureUrl: string | null;
  comments: number;
  reactions: number;
  shares: number;
  leadSignal: boolean;
  status: "new" | "lead" | "customer" | "ignore";
  notes: string | null;
  contactId: string | null;
  lastComment: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface Post {
  id: string;
  platform: Platform;
  message: string | null;
  permalink: string | null;
  imageUrl: string | null;
  postedAt: string;
  commentCount: number;
  reactionCount: number;
  shareCount: number | null;
  saved: { comments: number; reactions: number; shares: number; people: number };
}

interface Summary {
  people: number;
  leads: number;
  comments: number;
  reactions: number;
  shares: number;
  today: number;
  unreplied: number;
}

const PAGE_SIZE = 50;
const REACTION: Record<string, string> = { LIKE: "👍", LOVE: "❤️", HAHA: "😆", WOW: "😮", SAD: "😢", ANGRY: "😡", CARE: "🤗", THANKFUL: "🌸", PRIDE: "🌈" };
const STATUS_LABEL: Record<Person["status"], string> = { new: "New", lead: "Lead", customer: "Customer", ignore: "Ignore" };
const platformIcon = (p: Platform) => (p === "instagram" ? "◎ Instagram" : "f Facebook");

function Avatar({ name, url }: { name: string; url: string | null }) {
  return url ? (
    <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function PersonName({ p, platform }: { p: PersonRef | Person; platform: Platform }) {
  const href = p.profileUrl ?? (platform === "instagram" && p.username ? `https://www.instagram.com/${p.username}/` : null);
  return href ? (
    <a href={safeHref(href)} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-600 hover:underline">
      {p.name}
    </a>
  ) : (
    <span className="font-medium">{p.name}</span>
  );
}

function Accounts() {
  const client = useQueryClient();
  const accounts = useQuery({ queryKey: ["engagement", "accounts"], queryFn: () => api<{ items: Account[] }>("/engagement/accounts").then((r) => r.items) });
  const sync = useMutation({
    mutationFn: (id: string) => api<{ posts: number; added: number }>(`/engagement/accounts/${id}/sync`, { method: "POST" }),
    onSettled: () => client.invalidateQueries({ queryKey: ["engagement"] }),
  });
  if (accounts.isPending) return <Spinner />;
  if (accounts.error) return <ErrorBox error={accounts.error} />;
  if (!accounts.data.length)
    return (
      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        Connect your Facebook Page (and the Instagram Business account linked to it) under{" "}
        <Link to="/social" className="font-medium underline">
          Social Accounts
        </Link>{" "}
        first. Comments, likes and shares on your posts then come here by themselves.
      </div>
    );
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2">
      {accounts.data.map((a) => (
        <div key={a.id} className="card flex items-start gap-3 p-4">
          <Avatar name={a.name} url={a.pictureUrl} />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">
              {a.name} <span className="text-xs font-normal text-slate-500">{platformIcon(a.platform)}</span>
            </p>
            <p className="text-xs text-slate-500">
              {a.syncedAt ? `Checked ${formatRelative(a.syncedAt)} · ${a.posts} post${a.posts === 1 ? "" : "s"}` : "Not read yet"}
              {a.realtime && " · real-time on"}
            </p>
            {a.error && <p className="mt-1 text-xs text-red-600">{a.error}</p>}
            {sync.variables === a.id && sync.data && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">{sync.data.added} new from {sync.data.posts} posts</p>}
            {sync.variables === a.id && sync.error && (
              <div className="mt-1">
                <ErrorBox error={sync.error} />
              </div>
            )}
          </div>
          <button className="btn px-3 py-1 text-xs" disabled={sync.isPending} onClick={() => sync.mutate(a.id)}>
            {sync.isPending && sync.variables === a.id ? "Reading…" : "Sync now"}
          </button>
        </div>
      ))}
    </div>
  );
}

function ReplyBox({ e, onDone }: { e: Engagement; onDone: () => void }) {
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => api(`/engagement/comments/${e.id}/reply`, { method: "POST", body: { text } }),
    onSuccess: () => {
      setText("");
      onDone();
    },
  });
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (text.trim()) send.mutate();
      }}
    >
      <input className="input py-1 text-sm" placeholder={`Reply as your ${e.platform === "instagram" ? "Instagram account" : "Page"}…`} value={text} maxLength={2000} onChange={(ev) => setText(ev.target.value)} aria-label="Reply" />
      <button className="btn btn-primary px-3 py-1 text-sm" disabled={send.isPending || !text.trim()}>
        {send.isPending ? "Sending…" : "Reply"}
      </button>
      {send.error && <ErrorBox error={send.error} />}
    </form>
  );
}

/** One private message (Messenger / Instagram Direct) to the person who wrote the comment. */
function PrivateReply({ e, onDone }: { e: Engagement; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => api(`/engagement/comments/${e.id}/private-reply`, { method: "POST", body: { text } }),
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
  });
  if (e.privateReplyAt) return <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">✓ Private message sent {formatRelative(e.privateReplyAt)}</p>;
  if (Date.now() - new Date(e.occurredAt).getTime() > 7 * 24 * 3600_000) return null;
  if (!open)
    return (
      <button className="mt-1 ml-3 text-xs text-brand-600 hover:underline" onClick={() => setOpen(true)} title="Meta allows one private message per comment, within 7 days">
        Message privately
      </button>
    );
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (text.trim()) send.mutate();
      }}
    >
      <input className="input py-1 text-sm" placeholder={`Private ${e.platform === "instagram" ? "Instagram" : "Messenger"} message (one allowed)…`} value={text} maxLength={1000} onChange={(ev) => setText(ev.target.value)} aria-label="Private message" />
      <button className="btn btn-primary px-3 py-1 text-sm" disabled={send.isPending || !text.trim()}>
        {send.isPending ? "Sending…" : "Send"}
      </button>
      {send.error && <ErrorBox error={send.error} />}
    </form>
  );
}

function Activity({ platform }: { platform: string }) {
  const client = useQueryClient();
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const kind = params.get("kind") ?? "";
  const filter = params.get("filter") ?? "";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [replying, setReplying] = useState<string | null>(null);
  const query = { platform, kind, q, leadOnly: filter === "leads" ? "true" : "", unreplied: filter === "unreplied" ? "true" : "" };
  const list = useQuery({
    queryKey: ["engagement", "activity", page, query],
    queryFn: () => api<Page<Engagement>>(`/engagement/activity${qs({ page, pageSize: PAGE_SIZE, ...query })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <div className="flex flex-wrap gap-1">
          {[
            ["", "Everything"],
            ["comment", "Comments"],
            ["reaction", "Likes & reactions"],
            ["share", "Shares"],
          ].map(([id, label]) => (
            <button key={id || "all"} className={`btn px-3 py-1 text-sm ${kind === id ? "btn-primary" : ""}`} onClick={() => setSearchParams({ kind: id, page: null })}>
              {label}
            </button>
          ))}
        </div>
        <select className="input w-auto" value={filter} onChange={(e) => setSearchParams({ filter: e.target.value, page: null })} aria-label="Show">
          <option value="">All</option>
          <option value="leads">Looks like a lead</option>
          <option value="unreplied">Comments not answered</option>
        </select>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearchParams({ q: search, page: null });
          }}
        >
          <input className="input" placeholder="Search comment text…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search comments" />
          <button className="btn">Search</button>
        </form>
      </div>
      {list.isPending && <Spinner />}
      {list.error && (
        <div className="p-4">
          <ErrorBox error={list.error} />
        </div>
      )}
      {list.data?.total === 0 && <EmptyState title="Nothing here yet">Comments, likes and shares on your posts show up here after the first sync.</EmptyState>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {list.data?.items.map((e) => (
          <li key={e.id} className="flex gap-3 px-4 py-3 text-sm">
            <Avatar name={e.person?.name ?? "?"} url={e.person?.pictureUrl ?? null} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2">
                {e.person && <PersonName p={e.person} platform={e.platform} />}
                <span className="text-slate-500">
                  {e.kind === "comment" ? (e.parentExternalId ? "replied to a comment" : "commented") : e.kind === "share" ? "shared your post" : `reacted ${REACTION[e.reactionType ?? "LIKE"] ?? e.reactionType}`}
                </span>
                <span className="text-xs text-slate-400">
                  {platformIcon(e.platform)} · {formatRelative(e.occurredAt)}
                </span>
                {e.leadSignal && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Looks like a lead</span>}
              </p>
              {e.text && <p className="mt-1 whitespace-pre-wrap break-words">{e.text}</p>}
              {e.post && (
                <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                  on{" "}
                  {e.post.permalink ? (
                    <a href={safeHref(e.post.permalink)} target="_blank" rel="noreferrer noopener" className="hover:underline">
                      “{e.post.message ?? "your post"}”
                    </a>
                  ) : (
                    `“${e.post.message ?? "your post"}”`
                  )}
                </p>
              )}
              {e.kind === "comment" && e.repliedAt && (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">✓ Answered{e.replyText ? `: ${e.replyText}` : ""}</p>
              )}
              {e.kind === "comment" && !e.repliedAt && replying !== e.id && (
                <button className="mt-1 text-xs text-brand-600 hover:underline" onClick={() => setReplying(e.id)}>
                  Reply
                </button>
              )}
              {e.kind === "comment" && <PrivateReply e={e} onDone={() => void client.invalidateQueries({ queryKey: ["engagement"] })} />}
              {replying === e.id && (
                <ReplyBox
                  e={e}
                  onDone={() => {
                    setReplying(null);
                    void client.invalidateQueries({ queryKey: ["engagement"] });
                  }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setSearchParams({ page: p })} />}
    </>
  );
}

function PersonRow({ p }: { p: Person }) {
  const client = useQueryClient();
  const [notes, setNotes] = useState(p.notes ?? "");
  const refresh = () => client.invalidateQueries({ queryKey: ["engagement"] });
  const patch = useMutation({ mutationFn: (body: Partial<Pick<Person, "status" | "notes">>) => api(`/engagement/people/${p.id}`, { method: "PATCH", body }), onSuccess: refresh });
  const contact = useMutation({ mutationFn: () => api(`/engagement/people/${p.id}/contact`, { method: "POST" }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api(`/engagement/people/${p.id}`, { method: "DELETE" }), onSuccess: refresh });
  return (
    <tr className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <Avatar name={p.name} url={p.pictureUrl} />
          <div>
            <PersonName p={p} platform={p.platform} />
            <p className="text-xs text-slate-500">
              {p.username ? `@${p.username} · ` : ""}
              {platformIcon(p.platform)}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-2 whitespace-nowrap tabular-nums">
        💬 {p.comments} · 👍 {p.reactions} · ↗ {p.shares}
      </td>
      <td className="max-w-xs px-4 py-2 text-xs">
        {p.leadSignal && <span className="mb-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Looks like a lead</span>}
        {p.lastComment && <p className="line-clamp-2 text-slate-600 dark:text-slate-300">“{p.lastComment}”</p>}
      </td>
      <td className="px-4 py-2">
        <select className="input w-auto py-1 text-sm" value={p.status} onChange={(e) => patch.mutate({ status: e.target.value as Person["status"] })} aria-label={`Status of ${p.name}`}>
          {Object.entries(STATUS_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input mt-1 py-1 text-xs"
          placeholder="Notes"
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (p.notes ?? "") && patch.mutate({ notes: notes || null })}
          aria-label={`Notes on ${p.name}`}
        />
      </td>
      <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-500">{formatDate(p.lastSeenAt)}</td>
      <td className="px-4 py-2 text-xs">
        <div className="flex flex-col items-start gap-1">
          {p.platform === "instagram" &&
            (p.contactId ? (
              <span className="text-emerald-700 dark:text-emerald-400">✓ In Contacts</span>
            ) : (
              <button className="text-brand-600 hover:underline" disabled={contact.isPending} onClick={() => contact.mutate()}>
                Add to contacts
              </button>
            ))}
          <ConfirmButton label="Forget" confirmLabel="Delete all data?" className="text-red-600 hover:underline" onConfirm={() => remove.mutate()} />
        </div>
        {(patch.error || contact.error) && <ErrorBox error={patch.error ?? contact.error} />}
      </td>
    </tr>
  );
}

function People({ platform }: { platform: string }) {
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "recent";
  const leads = params.get("leads") === "1";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const query = { platform, status, sort, q, leadOnly: leads ? "true" : "" };
  const list = useQuery({
    queryKey: ["engagement", "people", page, query],
    queryFn: () => api<Page<Person>>(`/engagement/people${qs({ page, pageSize: PAGE_SIZE, ...query })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <select className="input w-auto" value={sort} onChange={(e) => setSearchParams({ sort: e.target.value, page: null })} aria-label="Sort">
          <option value="recent">Latest activity first</option>
          <option value="active">Most active first</option>
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setSearchParams({ status: e.target.value, page: null })} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={leads} onChange={(e) => setSearchParams({ leads: e.target.checked ? "1" : null, page: null })} />
          Looks like a lead
        </label>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearchParams({ q: search, page: null });
          }}
        >
          <input className="input" placeholder="Name, username or comment…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
          <button className="btn">Search</button>
        </form>
        <a className="btn" href={withViewOwner(`/api/engagement/people/export.csv${qs({ platform, status, leadOnly: leads ? "true" : "" })}`)} download>
          ⬇ Export CSV
        </a>
      </div>
      {list.isPending && <Spinner />}
      {list.error && (
        <div className="p-4">
          <ErrorBox error={list.error} />
        </div>
      )}
      {list.data?.total === 0 && <EmptyState title="No people yet">Everyone who comments, likes or shares your posts is listed here, with how often.</EmptyState>}
      {!!list.data?.items.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2">Person</th>
                <th className="px-4 py-2">Comments · likes · shares</th>
                <th className="px-4 py-2">Last comment</th>
                <th className="px-4 py-2">Status & notes</th>
                <th className="px-4 py-2">Last seen</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.data.items.map((p) => (
                <PersonRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setSearchParams({ page: p })} />}
    </>
  );
}

function Posts({ platform }: { platform: string }) {
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1) || 1;
  const list = useQuery({
    queryKey: ["engagement", "posts", page, platform],
    queryFn: () => api<Page<Post>>(`/engagement/posts${qs({ page, pageSize: 24, platform })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      {list.isPending && <Spinner />}
      {list.error && (
        <div className="p-4">
          <ErrorBox error={list.error} />
        </div>
      )}
      {list.data?.total === 0 && <EmptyState title="No posts read yet">Press “Sync now” on an account above.</EmptyState>}
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.items.map((p) => (
          <div key={p.id} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            {p.imageUrl && <img src={p.imageUrl} alt="" className="h-40 w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />}
            <div className="space-y-2 p-3 text-sm">
              <p className="text-xs text-slate-500">
                {platformIcon(p.platform)} · {formatDate(p.postedAt)}
              </p>
              <p className="line-clamp-3">{p.message ?? <span className="italic text-slate-500">No caption</span>}</p>
              <p className="tabular-nums text-xs text-slate-600 dark:text-slate-300">
                💬 {p.commentCount} · 👍 {p.reactionCount}
                {p.shareCount !== null && ` · ↗ ${p.shareCount}`} · 👤 {p.saved.people} people saved
              </p>
              <div className="flex gap-3 text-xs">
                <button className="text-brand-600 hover:underline" onClick={() => setSearchParams({ tab: "activity", postId: p.id, page: null })}>
                  Who engaged
                </button>
                {p.permalink && (
                  <a href={safeHref(p.permalink)} target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:underline">
                    Open post ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {list.data && list.data.total > 24 && <Pagination page={page} pageSize={24} total={list.data.total} onPage={(n) => setSearchParams({ page: n })} />}
    </>
  );
}

function PostActivity({ postId }: { postId: string }) {
  const list = useQuery({
    queryKey: ["engagement", "activity", "post", postId],
    queryFn: () => api<Page<Engagement>>(`/engagement/activity${qs({ postId, pageSize: 100 })}`),
  });
  const by = (kind: string) => list.data?.items.filter((e) => e.kind === kind) ?? [];
  return (
    <div className="p-4">
      <button className="btn mb-4 px-3 py-1 text-sm" onClick={() => setSearchParams({ postId: null, tab: "posts" })}>
        ← All posts
      </button>
      {list.isPending && <Spinner />}
      {list.data && (
        <div className="grid gap-4 md:grid-cols-3">
          {(
            [
              ["comment", "Commented"],
              ["reaction", "Liked / reacted"],
              ["share", "Shared"],
            ] as const
          ).map(([kind, title]) => (
            <div key={kind}>
              <h3 className="mb-2 text-sm font-semibold">
                {title} ({by(kind).length})
              </h3>
              <ul className="space-y-2 text-sm">
                {by(kind).map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <Avatar name={e.person?.name ?? "?"} url={e.person?.pictureUrl ?? null} />
                    <div>
                      {e.person && <PersonName p={e.person} platform={e.platform} />} {kind === "reaction" && (REACTION[e.reactionType ?? "LIKE"] ?? e.reactionType)}
                      {e.text && <p className="text-xs text-slate-600 dark:text-slate-300">{e.text}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Setup() {
  const setup = useQuery({
    queryKey: ["engagement", "setup"],
    queryFn: () => api<{ metaConfigured: boolean; callbackUrl: string | null; verifyToken: string; fields: { page: string[]; instagram: string[] } }>("/engagement/setup"),
  });
  if (!setup.data) return null;
  const s = setup.data;
  return (
    <details className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      <summary className="cursor-pointer font-medium">Real-time setup (super admin, once for the whole platform)</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          In the Meta app (developers.facebook.com) → <strong>Webhooks</strong>, for <strong>Page</strong> subscribe to <code>{s.fields.page.join(", ")}</code>, and for{" "}
          <strong>Instagram</strong> to <code>{s.fields.instagram.join(", ")}</code>. The same webhook brings new Messenger and Instagram messages to All messages within seconds.
        </li>
        <li>
          Callback URL: <code className="break-all">{s.callbackUrl ?? "set PUBLIC_BASE_URL in the backend settings first"}</code>
        </li>
        <li>
          Verify token: <code className="break-all">{s.verifyToken}</code>
        </li>
        <li>Each customer's Page is subscribed by itself on its first sync. Without webhooks, everything still arrives with the check every 15 minutes.</li>
        <li>
          Permissions (Meta App Review for customers' accounts): <code>pages_read_engagement</code>, <code>pages_read_user_content</code>, <code>pages_manage_engagement</code>,{" "}
          <code>pages_manage_metadata</code>, <code>instagram_basic</code>, <code>instagram_manage_comments</code>.
        </li>
      </ol>
      {!s.metaConfigured && <p className="mt-2 text-amber-700 dark:text-amber-300">The Meta app is not set up yet (Integrations page).</p>}
    </details>
  );
}

export function EngagementPage() {
  const params = useSearchParams();
  const tab = params.get("tab") ?? "activity";
  const platform = params.get("platform") ?? "";
  const postId = params.get("postId");
  const superAdmin = useIsSuperAdmin();
  const summary = useQuery({ queryKey: ["engagement", "summary"], queryFn: () => api<Summary>("/engagement/summary") });
  const s = summary.data;

  return (
    <>
      <PageHeader
        title="Social Engagement"
        subtitle="Everyone who comments, likes or shares your Facebook Page and Instagram posts, saved by itself with their name and ID."
      />
      {superAdmin && <Setup />}
      <Accounts />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="People" value={s?.people} icon="☺" />
        <StatCard label="Look like leads" value={s?.leads} icon="★" tone="amber" />
        <StatCard label="Comments not answered" value={s?.unreplied} icon="💬" tone="red" />
        <StatCard label="Last 24 hours" value={s?.today} hint={s ? `${s.comments} comments · ${s.reactions} reactions · ${s.shares} shares in all` : undefined} icon="↻" tone="green" />
      </div>
      <div className="card">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 p-3 dark:border-slate-800">
          {[
            ["activity", "Activity"],
            ["people", "People"],
            ["posts", "Posts"],
          ].map(([id, label]) => (
            <button key={id} className={`btn px-3 py-1 text-sm ${tab === id ? "btn-primary" : ""}`} onClick={() => setSearchParams({ tab: id, page: null, postId: null, kind: null, filter: null, q: null })}>
              {label}
            </button>
          ))}
          <select className="input ml-auto w-auto py-1 text-sm" value={platform} onChange={(e) => setSearchParams({ platform: e.target.value, page: null })} aria-label="Platform">
            <option value="">Facebook + Instagram</option>
            <option value="facebook">Facebook only</option>
            <option value="instagram">Instagram only</option>
          </select>
        </div>
        {postId ? <PostActivity postId={postId} /> : tab === "people" ? <People platform={platform} /> : tab === "posts" ? <Posts platform={platform} /> : <Activity platform={platform} />}
      </div>
    </>
  );
}
