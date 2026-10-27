// LinkedIn inbox assist: reads the chats you have open in linkedin.com/messaging (in your own
// logged-in browser), and types the AI's draft into the reply box for you to send. It never
// presses Send itself: LinkedIn does not allow automated messaging.

import { composerText, findComposer, isVisible, textStays, typeInto, waitFor, type Timing } from "./messenger";

export interface UnreadThread {
  url: string;
  name: string;
}

export interface ThreadMessage {
  key: string;
  fromMe: boolean;
  text: string;
}

export interface OpenThread {
  threadId: string;
  participantName: string;
  profileUrl: string | null;
  messages: ThreadMessage[];
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function threadIdOf(url: string): string | null {
  const m = /\/messaging\/thread\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Small stable hash for messages without an id on the page. */
export function hashKey(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Chats in the left-hand list that LinkedIn marks as unread. */
export function listUnreadThreads(doc: Document): UnreadThread[] {
  const items = [...doc.querySelectorAll<HTMLElement>("li.msg-conversation-listitem, li[class*='conversation-listitem'], [data-view-name*='conversation-list-item' i]")];
  const out: UnreadThread[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isVisible(item)) continue;
    const link = item.querySelector<HTMLAnchorElement>("a[href*='/messaging/thread/']");
    if (!link) continue;
    const unread =
      !!item.querySelector(".msg-conversation-card__unread-count, [class*='unread-count'], .notification-badge") ||
      /\bunread\b/i.test(item.className) ||
      /unread/i.test(item.getAttribute("aria-label") ?? "") ||
      !!item.querySelector("[aria-label*='unread' i]");
    if (!unread) continue;
    const url = new URL(link.getAttribute("href")!, doc.location?.href ?? "https://www.linkedin.com").href;
    if (seen.has(url)) continue;
    seen.add(url);
    const name = norm(item.querySelector(".msg-conversation-listitem__participant-names, [class*='participant-names'], h3")?.textContent) || "LinkedIn member";
    out.push({ url, name });
  }
  return out;
}

/** The conversation open on the right: who it is with and its messages, oldest first. */
export function readOpenThread(doc: Document, url: string): OpenThread | null {
  const threadId = threadIdOf(url);
  if (!threadId) return null;
  const header = doc.querySelector<HTMLElement>(".msg-thread, .msg-convo-wrapper, main") ?? doc.body;
  const participantName =
    norm(header.querySelector("#thread-detail-jump-target, .msg-entity-lockup__entity-title, .msg-thread__link-to-profile, h2")?.textContent) || "LinkedIn member";
  const profileLink = header.querySelector<HTMLAnchorElement>(".msg-thread__link-to-profile, .msg-entity-lockup a[href*='/in/'], a.msg-thread__link-to-profile, header a[href*='/in/']");
  const profileUrl = profileLink?.href && /\/in\//.test(profileLink.href) ? profileLink.href.split("?")[0]! : null;

  const events = [...doc.querySelectorAll<HTMLElement>("li.msg-s-message-list__event, [class*='message-list__event']")];
  const hasOtherMarker = events.some((e) => e.querySelector(".msg-s-event-listitem--other, [class*='listitem--other']"));
  const first = participantName.split(" ")[0]!.toLowerCase();
  let currentSender: string | null = null;
  const messages: ThreadMessage[] = [];
  for (const ev of events) {
    const groupName = norm(ev.querySelector(".msg-s-message-group__name, [class*='message-group__name']")?.textContent);
    if (groupName) currentSender = groupName;
    for (const item of ev.querySelectorAll<HTMLElement>(".msg-s-event-listitem, [class*='event-listitem']:not([class*='__'])")) {
      const text = norm(item.querySelector(".msg-s-event-listitem__body, [class*='event-listitem__body']")?.textContent);
      if (!text) continue;
      const fromOther = hasOtherMarker
        ? item.matches(".msg-s-event-listitem--other, [class*='listitem--other']")
        : !!currentSender && currentSender.toLowerCase().includes(first);
      const urn = item.getAttribute("data-event-urn") ?? ev.getAttribute("data-event-urn");
      messages.push({ key: urn ?? hashKey(`${fromOther ? "in" : "out"}|${text}`), fromMe: !fromOther, text });
    }
  }
  return { threadId, participantName, profileUrl, messages };
}

export type ReplyOutcome = { status: "sent"; text: string } | { status: "skipped"; reason: string };

/**
 * Types the draft into the open chat's reply box and waits for you to press Send (or Enter).
 * You can edit the text first; the text actually sent is reported back.
 */
export async function typeReplyAndWait(doc: Document, text: string, participantName: string, timing: Timing, signal?: AbortSignal): Promise<ReplyOutcome> {
  const composer = await waitFor(() => findComposer(doc, participantName), timing.findMs, timing.pollMs, signal);
  if (signal?.aborted) return { status: "skipped", reason: "Skipped by you" };
  if (!composer) return { status: "skipped", reason: "The reply box was not found" };
  if (composerText(composer.box)) return { status: "skipped", reason: "The reply box already has text you typed; not overwritten" };
  if (!typeInto(composer.box, text) || !(await textStays(composer.box, text, Math.min(600, timing.findMs)))) {
    return { status: "skipped", reason: "Could not type into LinkedIn's reply box (its editor did not accept the text)" };
  }

  let lastText = composerText(composer.box);
  let userSent = false;
  const onClick = (e: Event) => {
    const b = (e.target as Element | null)?.closest("button");
    if (b && (b === composer.send || /^send( now)?$/i.test(norm(b.getAttribute("aria-label")) || norm(b.textContent)) || b.classList.contains("msg-form__send-button"))) {
      lastText = composerText(composer.box) || lastText;
      userSent = true;
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && composer.box.contains(e.target as Node)) {
      lastText = composerText(composer.box) || lastText;
      userSent = true;
    }
  };
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKey, true);
  try {
    const outcome = await waitFor<ReplyOutcome>(() => {
      if (!userSent) {
        const now = composerText(composer.box);
        if (now) lastText = now;
      }
      if (userSent && (!composer.box.isConnected || composerText(composer.box) === "")) return { status: "sent", text: lastText };
      if (!composer.box.isConnected && !userSent) return { status: "skipped", reason: "Chat closed without sending" };
      return null;
    }, timing.assistedMs, Math.max(timing.pollMs, 250), signal);
    if (signal?.aborted) return { status: "skipped", reason: "Skipped by you" };
    return outcome ?? { status: "skipped", reason: `Not sent within ${Math.round(timing.assistedMs / 60_000)} minutes` };
  } finally {
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKey, true);
  }
}
