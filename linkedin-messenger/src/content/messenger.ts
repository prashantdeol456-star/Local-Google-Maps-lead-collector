// Sends one message from an open LinkedIn profile page, the way a person would: click
// "Message", type the text, then either press Send (auto mode) or wait for the user to press
// it (assisted mode). Never solves security checks or works around LinkedIn's limits: when
// LinkedIn asks for a login, a check or shows a limit, it stops and reports "blocked".
//
// LinkedIn changes its markup often, so elements are found by role, label and visible text
// first, and by LinkedIn's class names only as a fallback.

export type SendOutcome =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "blocked"; reason: string };

export interface SendJob {
  body: string;
  mode: "assisted" | "auto";
  contactName: string;
}

export interface Timing {
  pageLoadMs: number;
  findMs: number;
  sendConfirmMs: number;
  assistedMs: number;
  pollMs: number;
}

export const DEFAULT_TIMING: Timing = { pageLoadMs: 20_000, findMs: 12_000, sendConfirmMs: 15_000, assistedMs: 10 * 60_000, pollMs: 400 };

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

/**
 * Elements matching `selector`, including inside open shadow roots. LinkedIn renders its chat
 * pop-ups inside a shadow root, where document.querySelectorAll does not look.
 */
export function deepQueryAll<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  const out: T[] = [...root.querySelectorAll<T>(selector)];
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) out.push(...deepQueryAll<T>(el.shadowRoot, selector));
  }
  return out;
}

/** In a real browser: actually rendered (no hidden ancestor, not display:none). */
const hasLayout = () => typeof navigator !== "undefined" && !/HappyDOM/i.test(navigator.userAgent);

/** Rendered and not hidden (the test DOM has no layout, so only explicit hiding counts there). */
export function isVisible(node: Element): boolean {
  // Not `instanceof HTMLElement`: LinkedIn builds its chat pop-up with elements from another
  // frame, which fail that check although they are ordinary, visible elements.
  if (node.nodeType !== 1 || typeof (node as HTMLElement).focus !== "function") return false;
  const el = node as HTMLElement;
  if (el.hidden || el.closest("[hidden], [aria-hidden='true']")) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  if (hasLayout()) {
    // Catches hidden ancestors too (e.g. a minimized or stale chat editor).
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true })) return false;
    if (el.getClientRects().length === 0) return false;
  }
  return true;
}

const BLOCK_PATHS = /^\/(login|authwall|checkpoint|uas\/login|signup)/i;
const BLOCK_TEXTS: [RegExp, string][] = [
  [/let.s do a quick security check|security verification|verify you.re (a )?human/i, "LinkedIn is showing a security check. Complete it yourself in the LinkedIn tab, then resume the campaign."],
  [/you.ve reached the (weekly|monthly|daily) .*limit|you.ve reached the limit/i, "LinkedIn says a sending limit was reached. Wait before resuming the campaign."],
  [/your account (has been|is) (temporarily )?restricted/i, "LinkedIn says your account is restricted."],
  [/sign in to (linkedin|view)|join linkedin|new to linkedin\? join now/i, "LinkedIn is not logged in in this browser. Log in, then resume the campaign."],
];

/** Something that stops every following message too. */
export function detectBlock(doc: Document, url: string): string | null {
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep "/" */
  }
  if (BLOCK_PATHS.test(path)) return "LinkedIn is asking you to log in or pass a check. Do it yourself in the LinkedIn tab, then resume the campaign.";
  if (doc.querySelector("iframe[src*='captcha' i], iframe[title*='captcha' i], #captcha-internal")) {
    return "LinkedIn is showing a security check. Complete it yourself in the LinkedIn tab, then resume the campaign.";
  }
  const text = norm(doc.body?.innerText ?? doc.body?.textContent).slice(0, 20_000);
  for (const [pattern, reason] of BLOCK_TEXTS) {
    // A login prompt only counts when there is no logged-in navigation on the page.
    if (reason.includes("not logged in") && doc.querySelector("#global-nav, .global-nav, nav[aria-label*='Primary' i]")) continue;
    if (pattern.test(text)) return reason;
  }
  return null;
}

export function profileMissing(doc: Document): boolean {
  return /this page doesn.t exist|profile (is )?not available|page not found/i.test(norm(doc.querySelector("main")?.textContent ?? doc.body?.textContent).slice(0, 3000));
}

/** Containers of the chat pop-ups, which also contain "Message"-like buttons. */
const OVERLAY = ".msg-overlay-container, .msg-overlay-list-bubble, .msg-overlay-conversation-bubble, aside.msg-overlay-container, [data-view-name*='messaging-overlay' i]";

function actionCandidates(doc: Document): HTMLElement[] {
  const main = doc.querySelector("main") ?? doc.body;
  if (!main) return [];
  return [...main.querySelectorAll<HTMLElement>("button, a[role='button'], a[href*='/messaging/']")].filter((el) => !el.closest(OVERLAY) && isVisible(el));
}

const label = (el: Element) => norm(el.getAttribute("aria-label")) || norm(el.textContent);

/** The profile's own "Message" button (top card), not a "Message" link elsewhere on the page. */
export function findMessageButton(doc: Document, contactName?: string): HTMLElement | null {
  const first = norm(contactName).split(" ")[0]?.toLowerCase();
  const matches = actionCandidates(doc).filter((el) => {
    const l = label(el).toLowerCase();
    if (l === "message") return true;
    if (!l.startsWith("message ")) return false;
    // "Message Priya Sharma": must be this person, not a "People also viewed" card.
    return !first || l.includes(first);
  });
  if (matches.length === 0) return null;
  // The top card comes first in the page; prefer an exact "Message <name>" label.
  return matches.find((el) => first && label(el).toLowerCase().includes(first)) ?? matches[0]!;
}

/** Why there is no Message button, when the page says so. */
export function connectionState(doc: Document): "pending" | "not_connected" | null {
  const labels = actionCandidates(doc).map((el) => label(el).toLowerCase());
  if (labels.some((l) => l === "pending" || l.startsWith("pending,") || l.startsWith("withdraw"))) return "pending";
  if (labels.some((l) => l === "connect" || l.startsWith("invite ") || l === "follow")) return "not_connected";
  return null;
}

export interface Composer {
  box: HTMLElement;
  form: HTMLElement;
  send: HTMLButtonElement | null;
  /** InMail (paid message to a non-connection) has a subject field. */
  isInMail: boolean;
}

const BOX = "[contenteditable='true'][role='textbox'], .msg-form__contenteditable[contenteditable='true'], div[contenteditable='true'][aria-label*='message' i]";

function sendButtonIn(form: HTMLElement): HTMLButtonElement | null {
  const explicit = form.querySelector<HTMLButtonElement>("button.msg-form__send-button, button.msg-form__send-btn");
  if (explicit) return explicit;
  const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")];
  return buttons.find((b) => /^send( now)?$/i.test(label(b))) ?? buttons.find((b) => b.type === "submit") ?? null;
}

/** How many message boxes the page has, for an explanation when none can be used. */
export function composerDiagnostics(doc: Document): string {
  const all = deepQueryAll<HTMLElement>(doc, BOX);
  const visible = all.filter(isVisible).length;
  const inShadow = all.filter((b) => b.getRootNode() !== doc).length;
  return `${all.length} message box(es) on the page, ${visible} visible, ${inShadow} inside LinkedIn's chat pop-up`;
}

/** The newest message box for this person (several chat bubbles can be open). */
export function findComposer(doc: Document, contactName?: string): Composer | null {
  const boxes = deepQueryAll<HTMLElement>(doc, BOX).filter(isVisible);
  if (boxes.length === 0) return null;
  const first = norm(contactName).split(" ")[0]?.toLowerCase();
  const withContainer = boxes.map((box) => {
    const form = (box.closest("form, .msg-form") as HTMLElement | null) ?? box.parentElement!;
    const bubble = (box.closest(".msg-overlay-conversation-bubble, .msg-convo-wrapper, [role='dialog'], section") as HTMLElement | null) ?? form;
    return { box, form, bubble };
  });
  const forPerson = first ? withContainer.filter((c) => norm(c.bubble.textContent).toLowerCase().includes(first)) : [];
  const pick = (forPerson.length ? forPerson : withContainer).at(-1)!;
  const subject = pick.bubble.querySelector("input[name='subject' i], input[placeholder*='subject' i]");
  return { box: pick.box, form: pick.form, send: sendButtonIn(pick.form), isInMail: !!subject };
}

export const composerText = (box: HTMLElement) => norm(box.innerText ?? box.textContent);

/**
 * Types the text into LinkedIn's editor. execCommand("insertText") goes through the editor's
 * own input handling (so its Send button enables); the paragraph fallback is for editors that
 * ignore it.
 */
export function typeInto(box: HTMLElement, text: string): boolean {
  const doc = box.ownerDocument;
  box.focus();
  // Inside a shadow root the selection belongs to that root (Chrome).
  const root = box.getRootNode() as Document | (ShadowRoot & { getSelection?: () => Selection | null });
  const selection = (root !== doc && "getSelection" in root && typeof root.getSelection === "function" ? root.getSelection() : null) ?? doc.getSelection();
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
  if (!inserted || !composerText(box).includes(expected)) inserted = pasteInto(box, text) && composerText(box).includes(expected);
  if (!inserted || !composerText(box).includes(expected)) {
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

/** LinkedIn's editor handles a paste reliably when it ignores insertText. */
function pasteInto(box: HTMLElement, text: string): boolean {
  try {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
    return true;
  } catch {
    return false;
  }
}

/** The text is still there a moment later (some editors re-render and drop programmatic input). */
export async function textStays(box: HTMLElement, text: string, ms: number): Promise<boolean> {
  const expected = norm(text).slice(0, 40);
  await sleep(ms);
  return box.isConnected && composerText(box).includes(expected);
}

const isEnabled = (b: HTMLButtonElement | null): b is HTMLButtonElement => !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true";

/** Error toast shown by LinkedIn when a message did not go out. */
function sendError(doc: Document): string | null {
  const alerts = deepQueryAll(doc, "[role='alert'], .artdeco-toast-item, .msg-s-event-listitem--error").map((e) => norm(e.textContent));
  return alerts.find((t) => /couldn.t send|failed to send|not sent|try again/i.test(t)) ?? null;
}

export async function sendFromProfile(doc: Document, getUrl: () => string, job: SendJob, timing: Timing = DEFAULT_TIMING, signal?: AbortSignal): Promise<SendOutcome> {
  const aborted = (): SendOutcome => ({ status: "skipped", reason: "Skipped by you" });

  const loaded = await waitFor(() => detectBlock(doc, getUrl()) || doc.querySelector("main"), timing.pageLoadMs, timing.pollMs, signal);
  if (signal?.aborted) return aborted();
  const block = detectBlock(doc, getUrl());
  if (block) return { status: "blocked", reason: block };
  if (!loaded) return { status: "failed", reason: "The LinkedIn profile did not load" };
  if (profileMissing(doc)) return { status: "skipped", reason: "Profile not found on LinkedIn" };

  const button = await waitFor(() => findMessageButton(doc, job.contactName), timing.findMs, timing.pollMs, signal);
  if (signal?.aborted) return aborted();
  if (!button) {
    const state = connectionState(doc);
    if (state === "pending") return { status: "skipped", reason: "Connection request still pending (no Message button)" };
    if (state === "not_connected") return { status: "skipped", reason: "Not a 1st-degree connection (no Message button)" };
    const late = detectBlock(doc, getUrl());
    if (late) return { status: "blocked", reason: late };
    return { status: "failed", reason: "Message button not found (LinkedIn's page may have changed)" };
  }
  button.click();

  const composer = await waitFor(() => findComposer(doc, job.contactName), timing.findMs, timing.pollMs, signal);
  if (signal?.aborted) return aborted();
  if (!composer) {
    const late = detectBlock(doc, getUrl());
    if (late) return { status: "blocked", reason: late };
    return { status: "failed", reason: `The message box did not open (${composerDiagnostics(doc)})` };
  }
  if (composer.isInMail) return { status: "skipped", reason: "Would be an InMail (paid message to a non-connection); not sent" };

  if (!typeInto(composer.box, job.body)) return { status: "failed", reason: `Could not type into LinkedIn's message box (${composerDiagnostics(doc)})` };
  // LinkedIn's editor can drop text it did not see typed: check, and try once more.
  if (!(await textStays(composer.box, job.body, Math.min(600, timing.findMs)))) {
    typeInto(composer.box, job.body);
    if (!(await textStays(composer.box, job.body, Math.min(600, timing.findMs)))) {
      return { status: "failed", reason: "LinkedIn cleared the typed message (its editor did not accept it)" };
    }
  }

  if (job.mode === "auto") {
    const send = await waitFor(() => {
      const b = findComposer(doc, job.contactName)?.send ?? composer.send;
      return isEnabled(b) ? b : null;
    }, timing.findMs, timing.pollMs, signal);
    if (signal?.aborted) return aborted();
    if (!send) return { status: "failed", reason: "Send button not found or not enabled" };
    send.click();
    const outcome = await waitFor<SendOutcome>(() => {
      const err = sendError(doc);
      if (err) return { status: "failed", reason: err };
      const block = detectBlock(doc, getUrl());
      if (block) return { status: "blocked", reason: block };
      if (!composer.box.isConnected || composerText(composer.box) === "") return { status: "sent" };
      return null;
    }, timing.sendConfirmMs, timing.pollMs);
    return outcome ?? { status: "failed", reason: "LinkedIn did not confirm the message was sent; check the conversation" };
  }

  // Assisted: the user reads the message and presses Send (or Enter) themselves.
  let userSent = false;
  const markClick = (e: Event) => {
    const target = e.target as Element | null;
    const b = target?.closest("button");
    if (b && (b === composer.send || /^send( now)?$/i.test(label(b)) || b.classList.contains("msg-form__send-button"))) userSent = true;
  };
  const markKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && composer.box.contains(e.target as Node)) userSent = true;
  };
  doc.addEventListener("click", markClick, true);
  doc.addEventListener("keydown", markKey, true);
  try {
    const outcome = await waitFor<SendOutcome>(() => {
      const err = sendError(doc);
      if (err && userSent) return { status: "failed", reason: err };
      if (userSent && (!composer.box.isConnected || composerText(composer.box) === "")) return { status: "sent" };
      if (!composer.box.isConnected && !userSent) return { status: "skipped", reason: "Message box closed without sending" };
      return null;
    }, timing.assistedMs, Math.max(timing.pollMs, 250), signal);
    if (signal?.aborted) return aborted();
    return outcome ?? { status: "skipped", reason: `Not sent within ${Math.round(timing.assistedMs / 60_000)} minutes` };
  } finally {
    doc.removeEventListener("click", markClick, true);
    doc.removeEventListener("keydown", markKey, true);
  }
}
