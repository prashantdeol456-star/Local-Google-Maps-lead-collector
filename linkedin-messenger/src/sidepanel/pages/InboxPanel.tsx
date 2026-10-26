import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentEvent, ContentRequest, InboxDraft, OpenThread, UnreadThread } from "../../messages";
import type { ReplyOutcome } from "../../content/inbox";
import { send } from "../services/backendClient";

// LinkedIn inbox assist. While this panel is open and "Watch" is on, it checks your LinkedIn
// messages, sends new chats to the AI Inbox, and types the AI's reply into the chat for you to
// read and send. It never presses Send.

const MESSAGING = "https://www.linkedin.com/messaging/";
const CYCLE_MS = 45_000;
const DRAFT_WAIT_MS = 45_000;
const REPLY_TIMEOUT_MS = 11 * 60_000;
const WATCH_KEY = "inboxWatch";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function workTab(): Promise<chrome.tabs.Tab> {
  const [existing] = await chrome.tabs.query({ url: "https://www.linkedin.com/messaging/*" });
  if (existing?.id !== undefined) return existing;
  return chrome.tabs.create({ url: MESSAGING, active: false });
}

function waitLoaded(tabId: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function open(tabId: number, url: string) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.split("?")[0] === url.split("?")[0]) return;
  const loaded = waitLoaded(tabId);
  await chrome.tabs.update(tabId, { url });
  await loaded;
  await sleep(2500); // LinkedIn renders the chat after the page load
}

async function ask<T>(tabId: number, request: ContentRequest, tries = 4): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, request)) as { ok: boolean; data?: T } | undefined;
      if (res?.ok) return (res.data ?? (null as T)) as T;
    } catch {
      /* content script not ready yet */
    }
    await sleep(1500);
  }
  return null;
}

export function InboxPanel({ busyWithCampaign }: { busyWithCampaign: boolean }) {
  const [watch, setWatch] = useState(false);
  const [status, setStatus] = useState("Off");
  const [waiting, setWaiting] = useState<InboxDraft | null>(null);
  const [log, setLog] = useState<{ at: number; text: string; level: "ok" | "warn" | "info" }[]>([]);
  const running = useRef(false);
  const abortCurrent = useRef<(() => void) | null>(null);
  const handled = useRef(new Set<string>());

  const note = useCallback((text: string, level: "ok" | "warn" | "info" = "info") => setLog((l) => [{ at: Date.now(), text, level }, ...l].slice(0, 40)), []);

  useEffect(() => {
    chrome.storage.local.get(WATCH_KEY).then((v) => setWatch(!!v[WATCH_KEY]));
  }, []);

  /** Types one draft into its chat and waits for you; reports the outcome to the AI Inbox. */
  const typeDraft = useCallback(
    async (tabId: number, draft: InboxDraft) => {
      handled.current.add(draft.id);
      await open(tabId, `${MESSAGING}thread/${encodeURIComponent(draft.threadId)}/`);
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      setWaiting(draft);
      setStatus(`Your turn: check the reply to ${draft.participantName} and press Send`);
      const result = new Promise<ReplyOutcome>((resolve) => {
        const timer = setTimeout(() => finish({ status: "skipped", reason: "No answer from the LinkedIn tab" }), REPLY_TIMEOUT_MS);
        const listener = (msg: ContentEvent) => {
          if (msg.type === "LI_REPLY_RESULT" && msg.draftId === draft.id) finish(msg.outcome);
        };
        function finish(outcome: ReplyOutcome) {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(listener);
          abortCurrent.current = null;
          resolve(outcome);
        }
        chrome.runtime.onMessage.addListener(listener);
        abortCurrent.current = () => {
          void ask(tabId, { type: "LI_ABORT_REPLY", draftId: draft.id }, 1);
        };
      });
      const accepted = await ask<null>(tabId, { type: "LI_TYPE_REPLY", draftId: draft.id, text: draft.text, participantName: draft.participantName });
      const outcome: ReplyOutcome = accepted === null ? { status: "skipped", reason: "Could not reach the LinkedIn tab" } : await result;
      setWaiting(null);
      const res = await send<null>({ type: "INBOX_RESULT", draftId: draft.id, status: outcome.status, text: outcome.status === "sent" ? outcome.text : undefined });
      if (outcome.status === "sent") note(`Sent to ${draft.participantName}`, "ok");
      else note(`Skipped ${draft.participantName}: ${outcome.reason}`, "warn");
      if (!res.ok) note(`Could not record it in the AI Inbox: ${res.error}`, "warn");
    },
    [note],
  );

  const cycle = useCallback(async () => {
    if (running.current || busyWithCampaign) return;
    running.current = true;
    try {
      const tab = await workTab();
      const tabId = tab.id!;
      if (!tab.url?.startsWith(MESSAGING)) await open(tabId, MESSAGING);
      setStatus("Checking LinkedIn messages…");

      const unread = (await ask<UnreadThread[]>(tabId, { type: "LI_INBOX_SCAN" })) ?? [];
      for (const u of unread.slice(0, 3)) {
        await open(tabId, u.url);
        let thread: OpenThread | null = null;
        for (let i = 0; i < 6 && !thread?.messages.length; i++) {
          thread = await ask<OpenThread>(tabId, { type: "LI_READ_THREAD" }, 1);
          if (!thread?.messages.length) await sleep(1500);
        }
        if (!thread?.messages.length) continue;
        const synced = await send<InboxDraft[]>({ type: "INBOX_SYNC", threads: [thread] });
        if (!synced.ok) {
          note(`AI Inbox: ${synced.error}`, "warn");
          continue;
        }
        note(`Read new message from ${thread.participantName}`);
        // The AI waits a few seconds (people send several messages), then writes a draft.
        if (thread.messages.at(-1)?.fromMe) continue;
        setStatus(`AI is writing a reply to ${thread.participantName}…`);
        const until = Date.now() + DRAFT_WAIT_MS;
        while (Date.now() < until) {
          const drafts = await send<InboxDraft[]>({ type: "INBOX_DRAFTS", threadId: thread.threadId });
          const draft = drafts.ok ? drafts.data.find((d) => !handled.current.has(d.id)) : undefined;
          if (draft) {
            await typeDraft(tabId, draft);
            break;
          }
          await sleep(4000);
        }
      }

      // Replies you approved or wrote in the admin panel's AI Inbox.
      const queued = await send<InboxDraft[]>({ type: "INBOX_DRAFTS" });
      if (queued.ok) {
        for (const d of queued.data.filter((x) => !handled.current.has(x.id)).slice(0, 3)) await typeDraft(tabId, d);
      }
      setStatus(`Watching · last check ${time(Date.now())}`);
    } catch (err) {
      setStatus(`Problem: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running.current = false;
    }
  }, [busyWithCampaign, note, typeDraft]);

  useEffect(() => {
    if (!watch) {
      setStatus("Off");
      return;
    }
    void cycle();
    const id = setInterval(() => void cycle(), CYCLE_MS);
    return () => clearInterval(id);
  }, [watch, cycle]);

  function toggle(on: boolean) {
    setWatch(on);
    void chrome.storage.local.set({ [WATCH_KEY]: on });
    note(on ? "Watching LinkedIn messages" : "Stopped watching");
  }

  return (
    <>
      <section className="card">
        <p className="form__title">LinkedIn inbox (AI replies)</p>
        <p className="hint">
          While this panel is open, new LinkedIn messages go to the AI Inbox in your admin panel. The AI writes a reply and the extension types it into the
          chat. You read it, edit it if you like, and press Send yourself. Set what the AI knows under AI Inbox → AI instructions.
        </p>
        <div className="controls">
          {watch ? (
            <button className="btn" onClick={() => toggle(false)}>
              ■ Stop watching
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => toggle(true)}>
              ▶ Watch my LinkedIn messages
            </button>
          )}
        </div>
        <p className="hint">{busyWithCampaign ? "Paused while a campaign message is open." : status}</p>
      </section>

      {waiting && (
        <section className="card">
          <p className="form__title">Reply to {waiting.participantName}</p>
          <pre className="msg" style={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto" }}>
            {waiting.text}
          </pre>
          {waiting.decision && <p className="hint">{waiting.decision}</p>}
          <div className="controls">
            <button className="btn btn--ghost" onClick={() => abortCurrent.current?.()}>
              Skip this reply
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <p className="form__title">Inbox activity</p>
        {log.length === 0 && <p className="hint">Nothing yet.</p>}
        <ul className="list">
          {log.map((l, i) => (
            <li key={`${l.at}-${i}`} className={`list__item ${l.level === "ok" ? "list__item--saved" : l.level === "warn" ? "list__item--skipped" : ""}`}>
              <span className="list__text">
                {time(l.at)} {l.text}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
