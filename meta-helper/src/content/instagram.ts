// Instagram, in the user's own logged-in tab:
// - reading accounts from the search panel and from an open profile (public details only);
// - sending one message from a profile: click "Message", paste the text into the chat pop-up,
//   then press Send (automatic mode) or wait for the user to press it (assisted mode).
// Never works around Instagram's checks or limits: a login page, a challenge or an
// "action blocked" notice stops the run ("blocked").
//
// Instagram builds its chat pop-up with elements from another frame, so element checks use
// nodeType instead of `instanceof HTMLElement`.

import { instagramUsername, normalizeInstagramUrl, parseCount } from "@platform/shared";
import { textChunks } from "./text";

export type SendOutcome =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "blocked"; reason: string };

export interface SendJob {
  body: string;
  mode: "assisted" | "auto";
  contactName: string;
  profileUrl: string;
}

export interface Timing {
  pageLoadMs: number;
  findMs: number;
  sendConfirmMs: number;
  assistedMs: number;
  pollMs: number;
}

export const DEFAULT_TIMING: Timing = { pageLoadMs: 20_000, findMs: 12_000, sendConfirmMs: 15_000, assistedMs: 10 * 60_000, pollMs: 400 };

export interface InstagramLead {
  platform: "instagram";
  kind: "profile";
  url: string;
  handle: string;
  name: string;
  bio: string | null;
  category: string | null;
  followers: number | null;
  audienceText: string | null;
  website: string | null;
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs: number, pollMs: number, signal?: AbortSignal): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return null;
    const v = fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(pollMs);
  }
}

const hasLayout = () => typeof navigator !== "undefined" && !/HappyDOM/i.test(navigator.userAgent);

export function isVisible(node: Element): boolean {
  if (node.nodeType !== 1 || typeof (node as HTMLElement).focus !== "function") return false;
  const el = node as HTMLElement;
  if (el.hidden || el.closest("[hidden], [aria-hidden='true']")) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  if (hasLayout()) {
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true })) return false;
    if (el.getClientRects().length === 0) return false;
  }
  return true;
}

const lines = (el: Element | null | undefined) => (el ? textChunks(el) : []);

const textOf = (el: Element) => norm(el.getAttribute("aria-label")) || norm(el.textContent);

// ---- Blocks ----

const BLOCK_PATHS = /^\/(accounts\/login|challenge|accounts\/suspended|accounts\/disabled)/i;
const BLOCK_TEXTS: [RegExp, string][] = [
  [/try again later|we restrict certain activity|action blocked|you.re temporarily blocked/i, "Instagram is limiting your activity (\"Try again later\"). Wait a day before resuming."],
  [/confirm it.s you|suspicious login|help us confirm|enter the code we sent/i, "Instagram is asking you to confirm your account. Do it yourself in the Instagram tab, then resume."],
  [/your account has been (suspended|disabled)/i, "Instagram says your account is suspended or disabled."],
];

export function detectBlock(doc: Document, url: string): string | null {
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep "/" */
  }
  if (BLOCK_PATHS.test(path)) return "Instagram is asking you to log in or pass a check. Do it yourself in the Instagram tab, then resume the campaign.";
  if (doc.querySelector("input[name='username'][type='text'], input[name='username']:not([type])") && doc.querySelector("input[name='password']")) {
    return "Instagram is not logged in in this browser. Log in, then resume the campaign.";
  }
  const dialogs = [...doc.querySelectorAll("[role='dialog'], [role='alert']")].map((d) => norm(d.textContent)).join(" ").slice(0, 5000);
  for (const [pattern, reason] of BLOCK_TEXTS) if (pattern.test(dialogs)) return reason;
  return null;
}

export function profileMissing(doc: Document): boolean {
  return /sorry, this page isn.t available|the link you followed may be broken/i.test(norm(doc.body?.textContent).slice(0, 3000));
}

// ---- Sending ----

/** The profile's own "Message" button in its header. */
export function findMessageButton(doc: Document): HTMLElement | null {
  const header = doc.querySelector("header") ?? doc.querySelector("main");
  if (!header) return null;
  return [...header.querySelectorAll<HTMLElement>("div[role='button'], button, a[role='link']")].find((el) => /^message$/i.test(textOf(el)) && isVisible(el)) ?? null;
}

export function profileState(doc: Document): "own" | "no_message" | null {
  const header = doc.querySelector("header");
  if (!header) return null;
  const labels = [...header.querySelectorAll("div[role='button'], button, a")].map((el) => textOf(el).toLowerCase());
  if (labels.includes("edit profile")) return "own";
  return "no_message";
}

const BOX = "[contenteditable='true'][role='textbox'], div[contenteditable='true'][aria-label*='message' i], textarea[placeholder*='message' i]";

export interface Composer {
  box: HTMLElement;
  /** The chat pop-up (or page area) the box belongs to */
  container: HTMLElement;
}

/** The chat box for this person: the newest visible one, preferring a pop-up named after them. */
export function findComposer(doc: Document, names: string[]): Composer | null {
  const boxes = [...doc.querySelectorAll<HTMLElement>(BOX)].filter(isVisible);
  if (boxes.length === 0) return null;
  const wanted = names.map((n) => norm(n).toLowerCase()).filter(Boolean);
  const withContainer = boxes.map((box) => {
    const container = (box.closest("div[aria-label]") as HTMLElement | null) ?? (box.closest("[role='dialog'], main, section") as HTMLElement | null) ?? box.parentElement!;
    return { box, container, label: norm(container.getAttribute("aria-label")).toLowerCase() };
  });
  const named = withContainer.filter((c) => wanted.some((w) => c.label.includes(w) || norm(c.container.textContent).toLowerCase().includes(w)));
  const pick = (named.length ? named : withContainer).at(-1)!;
  return { box: pick.box, container: pick.container };
}

/** The Send button that appears next to the box once there is text. */
export function findSendButton(composer: Composer): HTMLElement | null {
  // Walk up from the box: the button sits in the same row or a few levels up.
  let el: HTMLElement | null = composer.box;
  for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
    const send = [...el.querySelectorAll<HTMLElement>("div[role='button'], button")].find((b) => /^send$/i.test(textOf(b)));
    if (send) return send;
  }
  return null;
}

export const composerText = (box: HTMLElement) => norm(box.innerText ?? box.textContent);

/** Types through Instagram's editor (Lexical): execCommand goes through its own input handling. */
export function typeInto(box: HTMLElement, text: string): boolean {
  const doc = box.ownerDocument;
  box.focus();
  const selection = doc.getSelection();
  if (selection) {
    const range = doc.createRange();
    range.selectNodeContents(box);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  let inserted = false;
  try {
    inserted = typeof doc.execCommand === "function" && doc.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }
  const expected = norm(text).slice(0, 40);
  if (!inserted || !composerText(box).includes(expected)) {
    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
    } catch {
      /* no paste support */
    }
  }
  if (!composerText(box).includes(expected) && box.tagName === "TEXTAREA") {
    const area = box as unknown as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(area), "value")?.set;
    setter?.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    return area.value.includes(text.slice(0, 40));
  }
  if (!composerText(box).includes(expected)) {
    // Last resort for editors that ignore both: write paragraphs and announce the input.
    box.replaceChildren(
      ...text.split("\n").map((line) => {
        const p = doc.createElement("p");
        if (line) p.textContent = line;
        else p.appendChild(doc.createElement("br"));
        return p;
      }),
    );
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }
  return composerText(box).includes(expected);
}

function sendError(doc: Document): string | null {
  const texts = [...doc.querySelectorAll("[role='alert'], [role='dialog']")].map((e) => norm(e.textContent));
  return texts.find((t) => /couldn.t send|failed to send|not delivered|message wasn.t sent/i.test(t)) ?? null;
}

export async function sendFromProfile(doc: Document, getUrl: () => string, job: SendJob, timing: Timing = DEFAULT_TIMING, signal?: AbortSignal): Promise<SendOutcome> {
  const aborted = (): SendOutcome => ({ status: "skipped", reason: "Skipped by you" });
  const username = instagramUsername(normalizeInstagramUrl(job.profileUrl) ?? "") ?? "";

  const loaded = await waitFor(() => detectBlock(doc, getUrl()) || profileMissing(doc) || doc.querySelector("header"), timing.pageLoadMs, timing.pollMs, signal);
  if (signal?.aborted) return aborted();
  const block = detectBlock(doc, getUrl());
  if (block) return { status: "blocked", reason: block };
  if (profileMissing(doc)) return { status: "skipped", reason: "Profile not found on Instagram" };
  if (!loaded) return { status: "failed", reason: "The Instagram profile did not load" };

  const button = await waitFor(() => findMessageButton(doc), timing.findMs, timing.pollMs, signal);
  if (signal?.aborted) return aborted();
  if (!button) {
    if (profileState(doc) === "own") return { status: "skipped", reason: "This is your own account" };
    return { status: "skipped", reason: "No Message button on this profile (the account may not accept messages)" };
  }
  button.click();

  const names = [job.contactName, username];
  const composer = await waitFor(() => findComposer(doc, names), timing.findMs, timing.pollMs, signal);
  if (signal?.aborted) return aborted();
  if (!composer) {
    const late = detectBlock(doc, getUrl());
    if (late) return { status: "blocked", reason: late };
    return { status: "failed", reason: "The message box did not open" };
  }
  if (composerText(composer.box)) return { status: "skipped", reason: "The message box already has text; not overwritten" };
  if (!typeInto(composer.box, job.body)) return { status: "failed", reason: "Could not type into Instagram's message box" };
  await sleep(Math.min(600, timing.findMs));
  if (!composerText(composer.box).includes(norm(job.body).slice(0, 40))) return { status: "failed", reason: "Instagram cleared the typed message (its editor did not accept it)" };

  if (job.mode === "auto") {
    const send = await waitFor(() => findSendButton(composer), timing.findMs, timing.pollMs, signal);
    if (signal?.aborted) return aborted();
    if (!send) return { status: "failed", reason: "Send button did not appear" };
    send.click();
    const outcome = await waitFor<SendOutcome>(() => {
      const err = sendError(doc);
      if (err) return { status: "failed", reason: err };
      const b = detectBlock(doc, getUrl());
      if (b) return { status: "blocked", reason: b };
      if (!composer.box.isConnected || composerText(composer.box) === "") return { status: "sent" };
      return null;
    }, timing.sendConfirmMs, timing.pollMs);
    return outcome ?? { status: "failed", reason: "Instagram did not confirm the message was sent; check the chat" };
  }

  // Assisted: you read it and press Send (or Enter).
  let userSent = false;
  const onClick = (e: Event) => {
    const b = (e.target as Element | null)?.closest("div[role='button'], button");
    if (b && /^send$/i.test(textOf(b))) userSent = true;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && composer.box.contains(e.target as Node)) userSent = true;
  };
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKey, true);
  try {
    const outcome = await waitFor<SendOutcome>(() => {
      if (userSent && (!composer.box.isConnected || composerText(composer.box) === "")) return { status: "sent" };
      if (!composer.box.isConnected && !userSent) return { status: "skipped", reason: "Chat closed without sending" };
      return null;
    }, timing.assistedMs, Math.max(timing.pollMs, 250), signal);
    if (signal?.aborted) return aborted();
    return outcome ?? { status: "skipped", reason: `Not sent within ${Math.round(timing.assistedMs / 60_000)} minutes` };
  } finally {
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKey, true);
  }
}

// ---- Collecting ----

const NOT_PROFILES = new Set(["/explore/", "/reels/", "/direct/inbox/", "/popular/", "/accounts/", "/"]);
const MENU_LABELS = new Set(["profile", "home", "search", "explore", "reels", "messages", "notifications", "create", "more", "threads", "meta ai", "also from meta"]);

/** Accounts listed in the search panel (username, name, followers as shown). */
export function readSearchResults(doc: Document): InstagramLead[] {
  const seen = new Map<string, InstagramLead>();
  for (const a of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (!/^\/[A-Za-z0-9._]+\/$/.test(href) || NOT_PROFILES.has(href) || a.closest("nav, header")) continue;
    const url = normalizeInstagramUrl(`https://www.instagram.com${href}`);
    if (!url) continue;
    const ls = lines(a);
    if (ls.length === 0) continue; // the avatar link next to the text link
    // Instagram's own menu (Home, Search, Profile…) also links to profile-like paths.
    if (ls.length === 1 && MENU_LABELS.has(ls[0]!.toLowerCase())) continue;
    const handle = instagramUsername(url)!;
    const [first, second] = ls;
    // Line 2 looks like "CAKESMAKES | LUCKNOW BAKERY • 21.7K followers" (or just the name).
    const parts = (second ?? "").split("•").map(norm);
    const followersPart = parts.find((p) => /followers?$/i.test(p)) ?? null;
    const name = parts.filter((p) => p !== followersPart).join(" • ") || (first && first !== handle ? first : handle);
    if (!seen.has(url)) {
      seen.set(url, { platform: "instagram", kind: "profile", url, handle, name, bio: null, category: null, followers: parseCount(followersPart), audienceText: followersPart, website: null });
    }
  }
  return [...seen.values()];
}

/** Instagram wraps outside links as l.instagram.com/?u=<real link>. */
function unwrapLink(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname === "l.instagram.com") {
      const real = u.searchParams.get("u");
      if (real) {
        const r = new URL(real);
        for (const k of [...r.searchParams.keys()]) if (/^utm_|^fbclid$/i.test(k)) r.searchParams.delete(k);
        return r.toString();
      }
    }
  } catch {
    /* keep as is */
  }
  return href;
}

const BUTTON_LABELS = new Set(["follow", "following", "message", "options", "similar accounts", "edit profile", "view archive", "contact", "email", "call", "directions", "subscribe"]);

/**
 * The open profile's public details. The header reads, in order: username, name, posts,
 * followers, following, category (business accounts), bio, "… more", link, then buttons and
 * story highlights (which are not part of the profile).
 */
export function readProfile(doc: Document, pageUrl: string): InstagramLead | null {
  const url = normalizeInstagramUrl(pageUrl);
  const header = doc.querySelector("header");
  if (!url || !header) return null;
  const handle = instagramUsername(url)!;
  const all = lines(header);
  // Everything after the first button is highlights and suggestions.
  const firstButton = all.findIndex((l) => BUTTON_LABELS.has(l.toLowerCase()));
  const ls = firstButton >= 0 ? all.slice(0, firstButton) : all;
  const followersLine = ls.find((l) => /followers?$/i.test(l)) ?? null;
  const countIdx = ls.findIndex((l) => /^[\d.,]+[KkMm]?\s+(posts?|followers?|following)$/i.test(l));
  const before = (countIdx >= 0 ? ls.slice(0, countIdx) : ls).filter((l) => l !== handle && !/^note\b/i.test(l));
  const name = before[0] ?? handle;
  const lastCount = ls.reduce((idx, l, i) => (/^[\d.,]+[KkMm]?\s+(posts?|followers?|following)$/i.test(l) ? i : idx), -1);
  let rest = ls.slice(lastCount + 1).filter((l) => l !== name && l !== handle && !/^followed by /i.test(l) && !/^(\.\.\.|…)?\s*more$/i.test(l) && !/^threads/i.test(l));
  const linkAnchor = [...header.querySelectorAll<HTMLAnchorElement>("a[href^='http']")].find((a) => !/instagram\.com\/(?!$)|threads\.(net|com)|facebook\.com/i.test(unwrapLink(a.href)) || /^https?:\/\/l\.instagram\.com/.test(a.href));
  const website = linkAnchor ? unwrapLink(linkAnchor.href) : null;
  const linkText = linkAnchor ? norm(linkAnchor.textContent).replace(/^link icon/i, "") : null;
  rest = rest.filter((l) => l !== linkText && !/^link icon/i.test(l) && !/ and \d+ more$/i.test(l));
  // A short first line after the counts, before a longer bio, is the account's category.
  const category = rest.length > 1 && rest[0]!.length <= 40 && !/[.!?]$/.test(rest[0]!) ? rest[0]! : null;
  const bio = (category ? rest.slice(1) : rest).join("\n").slice(0, 2000) || null;
  return { platform: "instagram", kind: "profile", url, handle, name, bio, category, followers: parseCount(followersLine), audienceText: followersLine, website };
}

/** Types the keyword into Instagram's search box so the results panel opens. */
export function typeSearch(doc: Document, keyword: string): boolean {
  const input = doc.querySelector<HTMLInputElement>("input[aria-label='Search input'], input[placeholder='Search']");
  if (!input) return false;
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, keyword);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
