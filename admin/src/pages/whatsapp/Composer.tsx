import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ErrorBox } from "../../components/ui";
import { api } from "../../lib/api";
import { PREVIEW, readAsBase64, type Interactive, type Message, type QuickReply } from "./types";

// The message box of an open chat (only while the 24-hour window is open): text with quick
// replies ("/"), quoted replies, files, voice notes, locations, contact cards, buttons, lists,
// link buttons and location requests. Tells the person "typing…" while you write.

const MAX_FILE = 5 * 1024 * 1024;
const TYPING_EVERY_MS = 20_000;

type Panel = null | "location" | "contact" | "buttons" | "list" | "link" | "ask";

function parseCoords(input: string): { latitude: number; longitude: number } | null {
  // "28.6667, 77.1220" or a Google Maps link with @lat,lng or ?q=lat,lng
  const m = input.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

function useRecorder(onDone: (blob: Blob, mime: string) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  async function start() {
    setError(null);
    try {
      // WhatsApp voice notes are mono Opus.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const mime = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime) throw new Error("This browser cannot record voice notes; use Chrome, Edge or Firefox");
      const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (!cancelled.current && chunks.length) onDone(new Blob(chunks, { type: mime }), mime);
      };
      cancelled.current = false;
      rec.current = r;
      r.start();
      setSeconds(0);
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? (e.name === "NotAllowedError" ? "Allow the microphone for this site to record" : e.message) : String(e));
    }
  }

  function stop(cancel = false) {
    cancelled.current = cancel;
    rec.current?.stop();
  }

  return { recording, seconds, error, start, stop };
}

export function Composer({
  chatId,
  replyTo,
  onClearReply,
  draft,
  onSent,
  quickReplies,
}: {
  chatId: string;
  replyTo: Message | null;
  onClearReply: () => void;
  draft: string | null;
  onSent: () => void;
  quickReplies: QuickReply[];
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  // Panel fields
  const [where, setWhere] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [buttons, setButtons] = useState(["", "", ""]);
  const [listButton, setListButton] = useState("Options");
  const [rows, setRows] = useState([{ title: "", description: "" }]);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  useEffect(() => {
    setText("");
    setPanel(null);
    setLocalError(null);
  }, [chatId]);

  useEffect(() => {
    if (draft !== null) setText(draft);
  }, [draft]);

  const done = () => {
    setText("");
    setPanel(null);
    setMenu(false);
    onClearReply();
    onSent();
  };
  const replyId = replyTo?.id ?? null;
  const post = (path: string, body: Record<string, unknown>) => api(`/whatsapp/chats/${chatId}/${path}`, { method: "POST", body: { ...body, replyTo: replyId } });

  const sendText = useMutation({ mutationFn: () => post("text", { text }), onSuccess: done });
  const sendFile = useMutation({
    mutationFn: async (file: File) =>
      post("file", { fileName: file.name, mime: file.type || "application/octet-stream", data: await readAsBase64(file), caption: text.trim() || null }),
    onSuccess: done,
  });
  const sendVoice = useMutation({
    mutationFn: async ({ blob, mime }: { blob: Blob; mime: string }) => post("voice", { mime, data: await readAsBase64(blob) }),
    onSuccess: done,
  });
  const sendOther = useMutation({ mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) => post(path, body), onSuccess: done });
  const recorder = useRecorder((blob, mime) => {
    if (blob.size > MAX_FILE) return setLocalError("Voice notes up to 5 MB (about 20 minutes)");
    sendVoice.mutate({ blob, mime });
  });

  const busy = sendText.isPending || sendFile.isPending || sendVoice.isPending || sendOther.isPending;
  const error = sendText.error ?? sendFile.error ?? sendVoice.error ?? sendOther.error;

  // "/fees" → saved reply
  const slash = text.startsWith("/") && !text.includes(" ") ? text.slice(1).toLowerCase() : null;
  const suggestions = slash !== null ? quickReplies.filter((q) => q.shortcut.startsWith(slash)).slice(0, 6) : [];

  function typing(value: string) {
    setText(value);
    const now = Date.now();
    if (value.trim() && now - lastTyping.current > TYPING_EVERY_MS) {
      lastTyping.current = now;
      void api(`/whatsapp/chats/${chatId}/typing`, { method: "POST" }).catch(() => {});
    }
  }

  function interactive(message: Interactive) {
    sendOther.mutate({ path: "interactive", body: { message } });
  }

  function submitPanel(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (panel === "location") {
      const c = parseCoords(where);
      if (!c) return setLocalError("Paste a Google Maps link or coordinates like 28.6667, 77.1220");
      sendOther.mutate({ path: "location", body: { ...c, name: placeName || null, address: placeAddress || null } });
    } else if (panel === "contact") {
      sendOther.mutate({ path: "contacts", body: { contacts: [{ name: contactName, phone: contactPhone }] } });
    } else if (panel === "buttons") {
      const list = buttons.map((b) => b.trim()).filter(Boolean);
      if (!text.trim() || !list.length) return setLocalError("Write the message in the box below and at least one button");
      interactive({ type: "buttons", body: text.trim(), buttons: list.map((title, i) => ({ id: `btn_${i + 1}`, title })) });
    } else if (panel === "list") {
      const items = rows.filter((r) => r.title.trim());
      if (!text.trim() || !items.length) return setLocalError("Write the message in the box below and at least one option");
      interactive({
        type: "list",
        body: text.trim(),
        button: listButton.trim() || "Options",
        sections: [{ title: listButton.trim().slice(0, 24) || "Options", rows: items.map((r, i) => ({ id: `opt_${i + 1}`, title: r.title.trim(), description: r.description.trim() || null })) }],
      });
    } else if (panel === "link") {
      if (!text.trim()) return setLocalError("Write the message in the box below");
      interactive({ type: "cta_url", body: text.trim(), displayText: linkText.trim(), url: linkUrl.trim() });
    } else if (panel === "ask") {
      interactive({ type: "location_request", body: text.trim() || "Please share your location so we can help you better." });
    }
  }

  const MENU: { id: Panel | "file"; label: string }[] = [
    { id: "file", label: "📎 Photo, video or document" },
    { id: "location", label: "📍 Location" },
    { id: "contact", label: "👤 Contact card" },
    { id: "buttons", label: "🔘 Quick-reply buttons (up to 3)" },
    { id: "list", label: "☰ List of options (up to 10)" },
    { id: "link", label: "↗ Link button" },
    { id: "ask", label: "📍 Ask for their location" },
  ];

  return (
    <div className="border-t border-slate-200 p-3 dark:border-slate-800">
      {(error || localError || recorder.error) && (
        <div className="mb-2">{localError || recorder.error ? <p className="text-sm text-red-600">{localError ?? recorder.error}</p> : <ErrorBox error={error} />}</div>
      )}

      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded border-l-4 border-emerald-500 bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">Replying to {replyTo.direction === "out" ? "yourself" : "them"}</p>
            <p className="truncate text-slate-600 dark:text-slate-300">{replyTo.body ?? PREVIEW[replyTo.type] ?? replyTo.type}</p>
          </div>
          <button className="text-slate-500" onClick={onClearReply} aria-label="Cancel reply">
            ✕
          </button>
        </div>
      )}

      {panel && (
        <form className="mb-2 space-y-2 rounded border border-slate-200 p-3 text-sm dark:border-slate-700" onSubmit={submitPanel}>
          <div className="flex items-center justify-between">
            <p className="font-medium">{MENU.find((m) => m.id === panel)?.label}</p>
            <button type="button" className="text-slate-500" onClick={() => setPanel(null)} aria-label="Close">
              ✕
            </button>
          </div>
          {panel === "location" && (
            <>
              <input className="input" id="wa-loc" placeholder="Google Maps link, or 28.6667, 77.1220" value={where} onChange={(e) => setWhere(e.target.value)} required />
              <button
                type="button"
                className="btn px-2 py-1 text-xs"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) => setWhere(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`),
                    () => setLocalError("Allow location for this site, or paste a Maps link"),
                  )
                }
              >
                Use my current location
              </button>
              <input className="input" id="wa-loc-name" placeholder="Place name (optional)" value={placeName} onChange={(e) => setPlaceName(e.target.value)} maxLength={100} />
              <input className="input" id="wa-loc-address" placeholder="Address (optional)" value={placeAddress} onChange={(e) => setPlaceAddress(e.target.value)} maxLength={200} />
            </>
          )}
          {panel === "contact" && (
            <>
              <input className="input" id="wa-contact-name" placeholder="Name" value={contactName} onChange={(e) => setContactName(e.target.value)} required maxLength={100} />
              <input className="input" id="wa-contact-phone" placeholder="+91 98765 43210" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} required />
            </>
          )}
          {panel === "buttons" && (
            <>
              <p className="text-xs text-slate-500">Write the message in the box below; the person taps one button to answer.</p>
              {buttons.map((b, i) => (
                <input
                  key={i}
                  className="input"
                  id={`wa-btn-${i}`}
                  placeholder={`Button ${i + 1}${i ? " (optional)" : ""}`}
                  value={b}
                  maxLength={20}
                  onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? e.target.value : x)))}
                />
              ))}
            </>
          )}
          {panel === "list" && (
            <>
              <p className="text-xs text-slate-500">Write the message in the box below; the person opens the list and picks one option.</p>
              <input className="input" id="wa-list-button" placeholder="List button text" value={listButton} maxLength={20} onChange={(e) => setListButton(e.target.value)} />
              {rows.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input" id={`wa-row-${i}`} placeholder={`Option ${i + 1}`} value={r.title} maxLength={24} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  <input
                    className="input"
                    id={`wa-row-desc-${i}`}
                    placeholder="Description (optional)"
                    value={r.description}
                    maxLength={72}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  />
                </div>
              ))}
              {rows.length < 10 && (
                <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setRows([...rows, { title: "", description: "" }])}>
                  + Option
                </button>
              )}
            </>
          )}
          {panel === "link" && (
            <>
              <p className="text-xs text-slate-500">Write the message in the box below; the button opens the link.</p>
              <input className="input" id="wa-link-text" placeholder="Button text, e.g. See fees" value={linkText} maxLength={20} onChange={(e) => setLinkText(e.target.value)} required />
              <input className="input" id="wa-link-url" type="url" placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} required />
            </>
          )}
          {panel === "ask" && <p className="text-xs text-slate-500">The person gets a “Send location” button. Write your own message in the box below, or leave it empty.</p>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        </form>
      )}

      {suggestions.length > 0 && (
        <ul className="mb-2 overflow-hidden rounded border border-slate-200 text-sm dark:border-slate-700">
          {suggestions.map((q) => (
            <li key={q.id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => setText(q.text)}>
                <span className="font-medium">/{q.shortcut}</span> <span className="text-slate-500">{q.text.slice(0, 80)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {recorder.recording ? (
        <div className="flex items-center gap-3">
          <span className="animate-pulse text-red-600">●</span>
          <span className="tabular-nums">
            {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, "0")}
          </span>
          <span className="flex-1 text-sm text-slate-500">Recording a voice note…</span>
          <button className="btn" onClick={() => recorder.stop(true)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => recorder.stop(false)}>
            Send
          </button>
        </div>
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (panel) return submitPanel(e);
            if (text.trim()) sendText.mutate();
          }}
        >
          <input
            ref={fileInput}
            type="file"
            id="wa-file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,application/pdf,audio/*,video/mp4,video/3gpp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > MAX_FILE) return setLocalError("Files up to 5 MB can be sent");
              setLocalError(null);
              sendFile.mutate(file);
            }}
          />
          <div className="relative">
            <button type="button" className="btn px-3" title="Attach" onClick={() => setMenu((v) => !v)} disabled={busy}>
              ＋
            </button>
            {menu && (
              <ul className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-md border border-slate-200 bg-white text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {MENU.map((m) => (
                  <li key={m.label}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                      onClick={() => {
                        setMenu(false);
                        if (m.id === "file") fileInput.current?.click();
                        else setPanel(m.id);
                      }}
                    >
                      {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <textarea
            id="wa-text"
            className="input min-h-[2.75rem] flex-1 resize-y"
            rows={1}
            placeholder={panel ? "Message shown with the buttons / list / link" : 'Type a message, or "/" for quick replies'}
            value={text}
            maxLength={4096}
            onChange={(e) => typing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !panel) {
                e.preventDefault();
                if (suggestions.length === 1) setText(suggestions[0]!.text);
                else if (text.trim()) sendText.mutate();
              }
            }}
          />
          {text.trim() || panel ? (
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          ) : (
            <button type="button" className="btn px-3" title="Record a voice note" onClick={() => void recorder.start()} disabled={busy}>
              🎤
            </button>
          )}
        </form>
      )}
    </div>
  );
}
