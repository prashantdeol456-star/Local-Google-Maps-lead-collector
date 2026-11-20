// Runs inside Justdial pages (MAIN world, from document_start) so it can see the result lists
// Justdial loads for a search (/api/resultsPageListing). It only passes copies of those answers
// to the extension's own content script on the same tab; it changes nothing on the page and
// sends nothing anywhere. Bundled on its own (IIFE).

(() => {
  const TAG = "jd-collector-tap";
  const MAX_BUFFER = 60;
  const buffer: string[] = [];
  const w = window as unknown as { __jdCollectorTap?: boolean };
  if (w.__jdCollectorTap) return;
  w.__jdCollectorTap = true;

  const isListing = (url: string) => /\/api\/resultsPageListing\b/.test(url);

  function publish(text: string) {
    if (!text || text[0] !== "{") return;
    buffer.push(text);
    if (buffer.length > MAX_BUFFER) buffer.shift();
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

  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const res = await originalFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (isListing(url)) res.clone().text().then(publish, () => {});
    } catch {
      /* ignore */
    }
    return res;
  };

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== TAG || e.data.kind !== "replay") return;
    for (const text of buffer) window.postMessage({ source: TAG, kind: "listing", text }, location.origin);
  });
})();
