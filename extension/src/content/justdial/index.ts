// Content script on justdial.com: answers the background's questions about the open page.
// The background drives the job (opens each list page and profile in the job's tab), so this
// script only reads: the result list Justdial loaded (passed on by justdialTap.iife.ts), or
// the profile on screen. It presses "Show Number" only when the job asks for it.

import { parseListingResponse, type JdListing } from "./listing";
import { detectBlock, readProfile, revealNumber } from "./profile";

const TAG = "jd-collector-tap";
const listings = new Map<string, JdListing>();
let version = 0;

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || e.data?.source !== TAG || e.data.kind !== "listing" || typeof e.data.text !== "string") return;
  for (const l of parseListingResponse(e.data.text)) if (!listings.has(l.docid)) listings.set(l.docid, l);
  version++;
});
window.postMessage({ source: TAG, kind: "replay" }, location.origin);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(250);
  }
  return check();
}

export type JdCommand = { type: "JD_PAGE" } | { type: "JD_PROFILE"; reveal: boolean };

async function handle(cmd: JdCommand) {
  if (cmd.type === "JD_PAGE") {
    await waitFor(() => listings.size > 0 || !!detectBlock(document), 10_000);
    // A second answer can follow the first one shortly after.
    const seen = version;
    await waitFor(() => version > seen, 1_500);
    const next = document.querySelector<HTMLLinkElement>('link[rel="next"]')?.href ?? null;
    return { listings: [...listings.values()], nextUrl: next, block: detectBlock(document), title: document.title };
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
  if (message?.type !== "JD_PAGE" && message?.type !== "JD_PROFILE") return false;
  handle(message).then(
    (data) => sendResponse({ ok: true, data }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
