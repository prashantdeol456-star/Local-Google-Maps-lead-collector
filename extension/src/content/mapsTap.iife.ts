// Runs inside the Google Maps page itself (MAIN world, from document_start) so it can see the
// search data Maps loads. It only passes copies of those responses to the extension's own
// content script on the same tab: it changes nothing on the page and sends nothing anywhere.
// Kept dependency-free: it is bundled on its own (IIFE).

(() => {
  const TAG = "maps-collector-tap";
  const MAX_BUFFER = 40;
  const buffer: string[] = [];
  const w = window as unknown as { __mapsCollectorTap?: boolean; APP_INITIALIZATION_STATE?: unknown };
  if (w.__mapsCollectorTap) return;
  w.__mapsCollectorTap = true;

  const isSearch = (url: string) => /\/search\?/.test(url) && /[?&]tbm=map\b/.test(url);

  function publish(text: string) {
    if (!text.startsWith(")]}'")) return;
    buffer.push(text);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    window.postMessage({ source: TAG, kind: "search", text }, location.origin);
  }

  /** The first page of results is embedded in the page as a ")]}'"-prefixed string. */
  function embedded(): string[] {
    const out: string[] = [];
    const walk = (v: unknown, depth: number) => {
      if (depth > 6 || v == null) return;
      if (typeof v === "string") {
        if (v.length > 2000 && v.startsWith(")]}'") && v.includes('"0x')) out.push(v);
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
      else if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
    };
    walk(w.APP_INITIALIZATION_STATE, 0);
    return out;
  }

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __mcUrl?: string }, ...args: unknown[]) {
    this.__mcUrl = String(args[1]);
    return (open as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __mcUrl?: string }, ...args: unknown[]) {
    if (this.__mcUrl && isSearch(this.__mcUrl)) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") publish(this.responseText);
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
      if (isSearch(url)) res.clone().text().then(publish, () => {});
    } catch {
      /* ignore */
    }
    return res;
  };

  // The extension's content script loads later and asks for everything seen so far.
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== TAG || e.data.kind !== "replay") return;
    for (const text of [...embedded(), ...buffer]) window.postMessage({ source: TAG, kind: "search", text }, location.origin);
  });
})();
