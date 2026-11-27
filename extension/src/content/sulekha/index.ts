// Content script on sulekha.com: answers the background's questions about the open page. The
// background drives the job (opens each list page and business page in the job's tab), so this
// script only reads. It never sends enquiries, asks for quotes, writes reviews or logs in.

import { chooseCategory, detectBlock, jsonLdObjects, readListings, readProfile, relatedCategories, suggestUrl } from "./listing";

export type SuCommand = { type: "SU_SEARCH"; keyword: string; city: string } | { type: "SU_PAGE" } | { type: "SU_PROFILE" };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(250);
  }
  return check();
}

const hasData = () => jsonLdObjects(document).some((o) => o["@type"] === "ItemList" || o["@type"] === "LocalBusiness");

async function handle(cmd: SuCommand) {
  if (cmd.type === "SU_SEARCH") {
    // The same suggestions Sulekha's own search box shows.
    const res = await fetch(suggestUrl(cmd.keyword, cmd.city));
    if (!res.ok) throw new Error(`Sulekha's search did not answer (${res.status})`);
    return chooseCategory(await res.text(), cmd.keyword, cmd.city);
  }
  await waitFor(() => hasData() || !!detectBlock(document), 8_000);
  const block = detectBlock(document);
  if (cmd.type === "SU_PAGE") {
    if (block) return { listings: [], related: [], landedUrl: location.href, block };
    return { listings: readListings(document), related: relatedCategories(document, location.href), landedUrl: location.href, block: null };
  }
  if (block) return { profile: null, block };
  await sleep(500); // "Contact Person" renders after the heading
  return { profile: readProfile(document), block: null };
}

chrome.runtime.onMessage.addListener((message: SuCommand, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (message?.type !== "SU_SEARCH" && message?.type !== "SU_PAGE" && message?.type !== "SU_PROFILE") return false;
  handle(message).then(
    (data) => sendResponse({ ok: true, data }),
    (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
