// Content script on grotal.com: answers the background's questions about the open page. The
// background drives the job (opens each list page and business page in the job's tab), so this
// script only reads what is on screen. It never fills in forms, writes reviews or logs in.

import { detectBlock, findCity, hasNextPage, parseCities, readListings, readProfile } from "./listing";

export type GrCommand = { type: "GR_CITY"; city: string } | { type: "GR_PAGE" } | { type: "GR_PROFILE" };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(250);
  }
  return check();
}

async function handle(cmd: GrCommand) {
  if (cmd.type === "GR_CITY") {
    // The same list Grotal's own city box uses.
    const res = await fetch("/Handler/ajax.ashx?CountryId=1", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Grotal's city list did not load (${res.status})`);
    return { city: findCity(parseCities(await res.text()), cmd.city) };
  }
  if (cmd.type === "GR_PAGE") {
    await waitFor(() => !!document.querySelector(".result-row .glListingHeader") || !!detectBlock(document), 8_000);
    const block = detectBlock(document);
    if (block) return { listings: [], hasNext: false, block };
    return { listings: readListings(document), hasNext: hasNextPage(document, location.href), block: null };
  }
  await waitFor(() => /Phone No|Address/i.test(document.body?.innerText ?? "") || !!detectBlock(document), 8_000);
  const block = detectBlock(document);
  return block ? { profile: null, block } : { profile: readProfile(document), block: null };
}

chrome.runtime.onMessage.addListener((message: GrCommand, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (message?.type !== "GR_CITY" && message?.type !== "GR_PAGE" && message?.type !== "GR_PROFILE") return false;
  handle(message).then(
    (data) => sendResponse({ ok: true, data }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
