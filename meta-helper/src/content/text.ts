// Visible text of an element as separate pieces, one per element that carries its own text.
// innerText cannot be split on line breaks reliably: inline elements next to each other
// (<span>Acme</span><span>Page · Bakery</span>) come out on one line.

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const SKIP = new Set(["SCRIPT", "STYLE", "SVG", "NOSCRIPT", "TEMPLATE"]);

export function textChunks(root: Element): string[] {
  const out: string[] = [];
  const walk = (el: Element) => {
    if (SKIP.has(el.tagName.toUpperCase())) return;
    if ((el as HTMLElement).hidden || el.getAttribute("aria-hidden") === "true") return;
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && norm(n.textContent));
    if (ownText || el.children.length === 0) {
      const t = norm(el.textContent);
      if (t) out.push(t);
      return;
    }
    for (const child of el.children) walk(child);
  };
  walk(root);
  return out;
}
