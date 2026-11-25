// Runs inside Justdial pages (MAIN world, from document_start) so it can see the result lists
// Justdial loads for a search (/api/resultsPageListing, by XMLHttpRequest). It only passes copies of those answers
// to the extension's own content script on the same tab; it changes nothing on the page and
// sends nothing anywhere. Bundled on its own (IIFE).

(() => {
  const TAG = "jd-collector-tap";
  // Answers kept only until the extension's content script has started (it then says "ack");
  // after that each answer is passed on and forgotten, so a long scroll does not pile up memory.
  const MAX_BUFFER = 10;
  const buffer: string[] = [];
  let acked = false;
  const w = window as unknown as { __jdCollectorTap?: boolean };
  if (w.__jdCollectorTap) return;
  w.__jdCollectorTap = true;

  const isListing = (url: string) => /\/api\/resultsPageListing\b/.test(url);

  function publish(text: string) {
    if (!text || text[0] !== "{") return;
    if (!acked) {
      buffer.push(text);
      if (buffer.length > MAX_BUFFER) buffer.shift();
    }
    window.postMessage({ source: TAG, kind: "listing", text }, location.origin);
  }

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __jdUrl?: string }, ...args: unknown[]) {
    this.__jdUrl = String(args[1]);
    return (open as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __jdUrl?: string }, ...args: unknown[]) {
    if (this.__jdUrl && isListing(this.__jdUrl)) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") publish(this.responseText);
          else if (this.responseType === "json") publish(JSON.stringify(this.response));
        } catch {
          /* ignore */
        }
      });
    }
    return (send as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.send;

  // Justdial loads its result lists with XMLHttpRequest (checked 2026-11-25), so fetch() is left
  // alone: wrapping it made Chrome list Justdial's own failed requests (ads, trackers) as this
  // extension's errors.

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== TAG) return;
    if (e.data.kind === "replay") for (const text of buffer) window.postMessage({ source: TAG, kind: "listing", text }, location.origin);
    if (e.data.kind === "ack") {
      acked = true;
      buffer.length = 0;
    }
  });
})();
