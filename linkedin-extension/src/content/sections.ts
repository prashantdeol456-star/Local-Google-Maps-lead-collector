// The profile page loads Experience and Education only when they scroll into view. Before
// reading, the open profile is scrolled down once (inside the page the user opened, nothing
// else is clicked or opened) and then put back where it was.

import { findSection } from "./parse";

const STEP_PX = 1200;
const STEP_MS = 400;
const MAX_MS = 7000;

let loadedFor: string | null = null;

function scroller(doc: Document): Element {
  const main = doc.querySelector("main");
  return main && main.scrollHeight > main.clientHeight + 50 ? main : (doc.scrollingElement ?? doc.documentElement);
}

export async function loadProfileSections(doc: Document, pageKey: string): Promise<void> {
  if (loadedFor === pageKey) return;
  const el = scroller(doc);
  const start = el.scrollTop;
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < MAX_MS) {
    if (findSection(doc, "Experience") && findSection(doc, "Education")) break;
    if (el.scrollTop === last && Date.now() - t0 > 1500) break; // reached the end
    last = el.scrollTop;
    el.scrollBy(0, STEP_PX);
    await new Promise((r) => setTimeout(r, STEP_MS));
  }
  el.scrollTo(0, start);
  loadedFor = pageKey;
}
