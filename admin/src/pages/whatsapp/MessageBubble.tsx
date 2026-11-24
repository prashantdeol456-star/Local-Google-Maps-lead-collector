import { useState } from "react";

import { PREVIEW, QUICK_EMOJIS, time, type Message } from "./types";

// One chat bubble, with the app's message actions: reply, react, star, forward, copy, delete for me.

function Ticks({ m }: { m: Message }) {
  if (m.direction === "in") return null;
  if (m.status === "failed") return <span className="text-red-600" title={m.error ?? "Not delivered"}>⚠</span>;
  if (m.status === "sending") return <span title="Sending">🕓</span>;
  if (m.status === "sent") return <span title="Sent">✓</span>;
  if (m.status === "delivered") return <span title="Delivered">✓✓</span>;
  if (m.status === "played") return <span className="text-sky-500" title="Played">✓✓ 🎧</span>;
  return <span className="text-sky-500" title="Read">✓✓</span>;
}

function Media({ m }: { m: Message }) {
  if (!m.mediaMime && !m.mediaId) return null;
  if (!m.mediaId) return <p className="text-xs italic text-slate-500">{m.error ?? "Saving the file…"}</p>;
  const src = `/api/whatsapp/media/${m.mediaId}`;
  if (m.type === "image" || m.type === "sticker")
    return (
      <a href={src} target="_blank" rel="noreferrer">
        <img src={src} alt={m.body ?? "Photo"} className={`${m.type === "sticker" ? "h-32 w-32 object-contain" : "max-h-72"} rounded`} loading="lazy" />
      </a>
    );
  if (m.type === "audio")
    return (
      <div className="flex items-center gap-2">
        {m.payload?.voice !== false && <span aria-hidden>🎤</span>}
        <audio controls src={src} className="max-w-full" preload="none" />
      </div>
    );
  if (m.type === "video") return <video controls src={src} className="max-h-72 rounded" preload="none" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded bg-black/5 px-3 py-2 text-sm hover:underline dark:bg-white/10">
      📄 {m.mediaName ?? "Document"}
      {m.mediaSize != null && <span className="text-xs text-slate-500">({Math.ceil(m.mediaSize / 1024)} KB)</span>}
    </a>
  );
}

function Special({ m, onMessageNumber }: { m: Message; onMessageNumber: (phone: string, name: string) => void }) {
  const p = m.payload;
  if (p?.location) {
    const l = p.location;
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}`}
        target="_blank"
        rel="noreferrer"
        className="block rounded bg-black/5 px-3 py-2 text-sm hover:underline dark:bg-white/10"
      >
        📍 {l.name ?? "Location"}
        {l.address && <span className="block text-xs text-slate-500">{l.address}</span>}
        <span className="block text-xs text-brand-600">Open in Google Maps</span>
      </a>
    );
  }
  if (p?.contacts) {
    return (
      <div className="space-y-1">
        {p.contacts.map((c, i) => (
          <div key={i} className="rounded bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
            <p className="font-medium">👤 {c.name}</p>
            {c.org && <p className="text-xs text-slate-500">{c.org}</p>}
            {c.phones.map((ph) => (
              <p key={ph.phone} className="flex items-center gap-2 text-xs">
                <span className="tabular-nums">{ph.phone}</span>
                {m.direction === "in" && (
                  <button className="text-brand-600 hover:underline" onClick={() => onMessageNumber(ph.phone, c.name)}>
                    Message
                  </button>
                )}
              </p>
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (p?.choice) {
    return <p className="text-xs text-emerald-700 dark:text-emerald-300">Tapped {p.choice.kind === "list" ? "in the list" : "a button"}:</p>;
  }
  if (p?.interactive) {
    const i = p.interactive;
    return (
      <div className="space-y-1">
        {"header" in i && i.header && <p className="font-medium">{i.header}</p>}
        <p className="whitespace-pre-wrap break-words">{i.body}</p>
        {"footer" in i && i.footer && <p className="text-xs text-slate-500">{i.footer}</p>}
        <div className="flex flex-wrap gap-1 pt-1">
          {i.type === "buttons" && i.buttons.map((b) => <span key={b.id} className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">{b.title}</span>)}
          {i.type === "list" && <span className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">☰ {i.button}</span>}
          {i.type === "cta_url" && <span className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">↗ {i.displayText}</span>}
          {i.type === "location_request" && <span className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">📍 Send location</span>}
        </div>
      </div>
    );
  }
  return null;
}

export function MessageBubble({
  m,
  canSend,
  onReply,
  onReact,
  onStar,
  onForward,
  onHide,
  onMessageNumber,
}: {
  m: Message;
  canSend: boolean;
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onStar: (m: Message) => void;
  onForward: (m: Message) => void;
  onHide: (m: Message) => void;
  onMessageNumber: (phone: string, name: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  const out = m.direction === "out";
  const deleted = !!m.revokedAt;
  const showBody = m.body && !m.payload?.interactive && !m.payload?.location && !m.payload?.contacts;
  const reactions = [m.reactions.in, m.reactions.out].filter(Boolean);

  return (
    <div className={`group flex ${out ? "justify-end" : "justify-start"}`}>
      <div className="relative max-w-[80%]">
        <div
          className={`space-y-1 rounded-lg px-3 py-2 text-sm shadow-sm ${
            out ? "bg-emerald-100 text-slate-900 dark:bg-emerald-900/60 dark:text-emerald-50" : "bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100"
          }`}
        >
          {m.forwarded && <p className="text-xs italic text-slate-500">{m.forwarded === "frequently_forwarded" ? "⇉ Forwarded many times" : "→ Forwarded"}</p>}
          {m.quoted && (
            <div className="rounded border-l-4 border-emerald-500 bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
              <p className="font-medium text-emerald-700 dark:text-emerald-300">{m.quoted.direction === "out" ? "You" : m.quoted.direction === "in" ? "Them" : "Message"}</p>
              <p className="line-clamp-2 text-slate-600 dark:text-slate-300">{m.quoted.body ?? PREVIEW[m.quoted.type] ?? "Message not available"}</p>
            </div>
          )}
          {m.templateName && <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Template: {m.templateName}</p>}
          {deleted ? (
            <p className="italic text-slate-500">🚫 This message was deleted</p>
          ) : (
            <>
              <Media m={m} />
              <Special m={m} onMessageNumber={onMessageNumber} />
              {showBody && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              {!m.body && !m.mediaMime && !m.payload && <p className="italic text-slate-500">[{m.type}]</p>}
            </>
          )}
          <p className="flex items-center justify-end gap-1 text-[11px] text-slate-500">
            {m.starred && <span title="Starred">★</span>}
            {m.editedAt && <span>Edited ·</span>}
            {time(m.createdAt)} <Ticks m={m} />
          </p>
          {m.status === "failed" && m.error && <p className="text-xs text-red-600">{m.error}</p>}
        </div>
        {reactions.length > 0 && (
          <div className={`-mt-2 flex ${out ? "justify-end pr-2" : "justify-start pl-2"}`}>
            <span className="rounded-full bg-white px-1.5 text-sm shadow dark:bg-slate-700" title={[m.reactions.in && "Them", m.reactions.out && "You"].filter(Boolean).join(", ")}>
              {reactions.join("")}
            </span>
          </div>
        )}

        {!deleted && (
          <div
            className={`absolute top-0 z-10 hidden gap-0.5 rounded-md bg-white p-0.5 text-xs shadow group-hover:flex group-focus-within:flex dark:bg-slate-700 ${out ? "right-full mr-1" : "left-full ml-1"}`}
          >
            {canSend && m.wamid && (
              <button className="rounded px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-600" title="Reply" onClick={() => onReply(m)}>
                ↩
              </button>
            )}
            {canSend && !out && m.wamid && (
              <button className="rounded px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-600" title="React" onClick={() => setPicker((v) => !v)}>
                🙂
              </button>
            )}
            <button className="rounded px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-600" title={m.starred ? "Unstar" : "Star"} onClick={() => onStar(m)}>
              {m.starred ? "★" : "☆"}
            </button>
            <button className="rounded px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-600" title="Forward" onClick={() => onForward(m)}>
              ➦
            </button>
            {m.body && (
              <button className="rounded px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-600" title="Copy" onClick={() => void navigator.clipboard?.writeText(m.body ?? "").catch(() => {})}>
                ⧉
              </button>
            )}
            <button className="rounded px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-600" title="Delete for me (stays on their phone)" onClick={() => onHide(m)}>
              🗑
            </button>
          </div>
        )}
        {picker && (
          <div className={`absolute z-20 mt-1 flex gap-1 rounded-full bg-white px-2 py-1 shadow-lg dark:bg-slate-700 ${out ? "right-0" : "left-0"}`}>
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                className={`rounded-full px-1 text-lg hover:scale-125 ${m.reactions.out === e ? "bg-emerald-100 dark:bg-emerald-900" : ""}`}
                onClick={() => {
                  setPicker(false);
                  onReact(m, m.reactions.out === e ? "" : e);
                }}
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

