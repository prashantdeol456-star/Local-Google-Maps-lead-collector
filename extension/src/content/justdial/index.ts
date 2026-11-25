// Content script on justdial.com: answers the background's questions about the open page.
// The background drives the job (opens the list and each profile in the job's tab), so this
// script only reads: the result list Justdial loaded (passed on by justdialTap.iife.ts), or
// the profile on screen. On the list it scrolls down when asked, like a person would, so
// Justdial loads the next businesses (10 per scroll). It presses "Show Number" only when the
// job asks for it.
//
// Memory: only small business records are kept (not Justdial's answers), and each answer to the
// background carries only the businesses it has not had yet.

import { parseListingResponse, type JdListing } from "./listing";
import { between, loadJdSpeed, paceOf } from "../../utils/jdSpeed";
import { detectBlock, readProfile, revealNumber } from "./profile";

const TAG = "jd-collector-tap";
const listings = new Map<string, JdListing>();
/** docids in the order Justdial showed them (the background asks "from number N on"). */
const order: string[] = [];
let version = 0;

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || e.data?.source !== TAG || e.data.kind !== "listing" || typeof e.data.text !== "string") return;
  for (const l of parseListingResponse(e.data.text)) {
    if (listings.has(l.docid)) continue;
    listings.set(l.docid, l);
    order.push(l.docid);
  }
  version++;
});
// Answers that came before this script started, then the tap may forget them.
window.postMessage({ source: TAG, kind: "replay" }, location.origin);
window.postMessage({ source: TAG, kind: "ack" }, location.origin);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(250);
  }
  return check();
}

const since = (n: number) => order.slice(Math.max(0, n)).map((id) => listings.get(id)!);
const nextUrl = () => document.querySelector<HTMLLinkElement>('link[rel="next"]')?.href ?? null;

/** Rounds without anything new before the list counts as finished. */
const IDLE_ROUNDS = 3;
/** How long to wait for Justdial's next 10 businesses after reaching the bottom (slow networks). */
const LOAD_WAIT_MS = 15_000;
/** Rounds in a row that brought nothing (kept between the background's calls). */
let idle = 0;

/** Presses a visible "Load more" / "View more results" button, if the list shows one. */
function pressLoadMore() {
  const button = [...document.querySelectorAll<HTMLElement>("button, a, [role='button']")].find(
    (e) => /^\s*(load|view|show|see) more( results| listings)?\s*$/i.test(e.textContent ?? "") && e.offsetWidth > 0 && e.offsetHeight > 0 && !(e as HTMLAnchorElement).href?.startsWith("tel:"),
  );
  button?.click();
}

/** Waits until the page height stops changing for a moment (cards and images placed). */
async function settled(ms = 800, maxMs = 5_000) {
  const end = Date.now() + maxMs;
  let last = document.documentElement.scrollHeight;
  let stableSince = Date.now();
  while (Date.now() < end) {
    await sleep(200);
    const h = document.documentElement.scrollHeight;
    if (h !== last) {
      last = h;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= ms) return;
  }
}

/**
 * Scrolls down at a calm pace until `want` businesses are loaded, the list stops growing, a
 * security check shows, or `maxMs` passed (the background calls again for more: short calls keep
 * it awake). Each round: scroll down in small steps to the bottom, wait for Justdial's next answer
 * to arrive and its cards to show, pause, then the next round. Never scrolls again while a load
 * is still under way. The pace comes from the Slow ↔ Fast slider, read again every round.
 */
export async function scrollForMore(want: number, maxMs: number): Promise<{ ended: boolean }> {
  const end = Date.now() + maxMs;
  while (order.length < want && Date.now() < end && idle < IDLE_ROUNDS) {
    if (detectBlock(document)) break;
    const before = order.length;
    const pace = paceOf(await loadJdSpeed().catch(() => undefined));
    // Small steps down to the bottom, like a person scrolling.
    for (let i = 0; i < 12 && window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 50; i++) {
      window.scrollBy({ top: Math.round(window.innerHeight * pace.step), behavior: "smooth" });
      await sleep(between(pace.stepPause));
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    const grew = await waitFor(() => order.length > before, LOAD_WAIT_MS);
    if (grew) {
      idle = 0;
      await settled();
      await sleep(between(pace.afterLoad));
    } else {
      idle++;
      // Some lists end with a "Load more" / "View more" button instead of loading by themselves.
      pressLoadMore();
      // Up a little and down again, in case the loader missed the first time.
      window.scrollBy(0, -1200);
      await sleep(Math.max(1_500, pace.afterLoad[0] / 2));
    }
  }
  return { ended: idle >= IDLE_ROUNDS };
}

export type JdCommand = { type: "JD_PAGE" } | { type: "JD_SCROLL"; since: number; want: number; maxMs: number } | { type: "JD_PROFILE"; reveal: boolean };

async function handle(cmd: JdCommand) {
  if (cmd.type === "JD_PAGE") {
    await waitFor(() => listings.size > 0 || !!detectBlock(document), 10_000);
    // A second answer can follow the first one shortly after.
    const seen = version;
    await waitFor(() => version > seen, 1_500);
    return { listings: since(0), total: order.length, nextUrl: nextUrl(), block: detectBlock(document), title: document.title };
  }
  if (cmd.type === "JD_SCROLL") {
    const { ended } = await scrollForMore(cmd.want, Math.min(cmd.maxMs, 25_000));
    return { listings: since(cmd.since), total: order.length, ended, nextUrl: nextUrl(), block: detectBlock(document) };
  }
  await waitFor(() => !!document.querySelector("h1") || !!detectBlock(document), 10_000);
  await sleep(800); // contact rows render after the heading
  const block = detectBlock(document);
  if (block) return { profile: null, block };
  const profile = readProfile(document);
  if (cmd.reveal && !profile.phone) {
    const revealed = await revealNumber(document);
    return { profile: { ...profile, phone: revealed.phone }, block: revealed.block };
  }
  return { profile, block: null };
}

chrome.runtime.onMessage.addListener((message: JdCommand, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (message?.type !== "JD_PAGE" && message?.type !== "JD_SCROLL" && message?.type !== "JD_PROFILE") return false;
  handle(message).then(
    (data) => sendResponse({ ok: true, data }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
